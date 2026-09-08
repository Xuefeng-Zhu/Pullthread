import { partById, type CosmeticPurchase, type CosmeticAccount } from '../../src/cosmetics/catalog';
import type { CommerceEnvironment, CommerceWallet, RedeemToolRequest, RedemptionResult, ResolveToolAction, ToolReceipt } from '../../src/commerce/contracts';
import { CommerceError, identifier, packPoints, parseRedemption, sameRequest, transactionKey, type VerifiedPurchase } from '../../functions/src/commerce/domain';

interface WalletData { points: number; revision: number }
interface Lot { tx_key: string; remaining: number; purchased_at: number; active: number; revoked: number }
interface Allocation { lotId: string; points: number; source?: 'reward' | 'purchase' }
interface ReceiptRow { operation_id: string; run_id: string; tool: ToolReceipt['tool']; expected_cost: number; context_key: string; status: ToolReceipt['status']; allocations: string }
interface TransactionRow { uid: string; environment: CommerceEnvironment; transaction_id: string; product_id: string; store: VerifiedPurchase['store']; quantity: number; purchased_at: number; refunded: number; points: number }
export interface StoredTransaction extends VerifiedPurchase { readonly uid: string; readonly points: number }

function wallet(data: WalletData | undefined, environment: CommerceEnvironment): CommerceWallet {
  if (data && (!Number.isSafeInteger(data.points) || data.points < 0 || !Number.isSafeInteger(data.revision) || data.revision < 0)) throw new CommerceError('unavailable', 'Wallet requires reconciliation.');
  return { points: data?.points ?? 0, revision: data?.revision ?? 0, environment };
}
function receipt(row: ReceiptRow): ToolReceipt {
  return { operationId: row.operation_id, runId: row.run_id, tool: row.tool, expectedCost: row.expected_cost, contextKey: row.context_key, status: row.status };
}
function storedTransaction(row: TransactionRow): StoredTransaction {
  return { uid: row.uid, environment: row.environment, transactionId: row.transaction_id, productId: row.product_id, store: row.store, quantity: row.quantity, purchasedAt: row.purchased_at, refunded: row.refunded === 1, points: row.points };
}
function retryable(error: unknown): boolean {
  const message = error instanceof Error ? `${error.message} ${String(error.cause ?? '')}` : String(error);
  return message.includes('commerce_revision_conflict') || message.includes('UNIQUE constraint failed: commerce_transactions.tx_key');
}

/**
 * Reads are a consistent D1 batch; writes are a second atomic batch that first
 * compares the wallet revision. The assertion trigger aborts ALL statements if
 * another request changed the wallet between those batches. Global transaction
 * uniqueness also serializes first purchases racing across different accounts.
 * No debit, grant, receipt, allocation, or revive reservation can commit alone.
 */
export class D1CommerceWallet {
  constructor(private readonly database: D1Database) {}

  private statement(sql: string, ...values: (string | number | null)[]): D1PreparedStatement {
    return this.database.prepare(sql).bind(...values);
  }

  private async read(uid: string, environment: CommerceEnvironment, statements: D1PreparedStatement[]) {
    const result = await this.database.batch<unknown>([
      this.statement('SELECT points, revision FROM commerce_wallets WHERE uid = ? AND environment = ?', uid, environment),
      ...statements,
    ]);
    return { current: wallet(result[0].results[0] as WalletData | undefined, environment), rows: result.slice(1).map((item) => item.results) };
  }

  private async commit(uid: string, current: CommerceWallet, points: number, statements: D1PreparedStatement[]): Promise<CommerceWallet> {
    const next = { ...current, points, revision: current.revision + 1 };
    if (!Number.isSafeInteger(next.points) || next.points < 0 || !Number.isSafeInteger(next.revision)) throw new CommerceError('unavailable', 'Wallet reconciliation failed.');
    await this.database.batch([
      this.statement('INSERT OR IGNORE INTO commerce_wallets(uid, environment, points, revision) VALUES (?, ?, 0, 0)', uid, current.environment),
      this.statement('UPDATE commerce_wallets SET points = ?, revision = ? WHERE uid = ? AND environment = ? AND revision = ?', next.points, next.revision, uid, current.environment, current.revision),
      this.statement('INSERT INTO commerce_revision_assertions(matched) SELECT changes() WHERE changes() != 1'),
      ...statements,
    ]);
    return next;
  }

  private async optimistic<T>(attempt: () => Promise<T>): Promise<T> {
    for (let retries = 0; retries < 64; retries += 1) {
      try { return await attempt(); }
      catch (error) {
        if (!retryable(error)) throw error;
      }
    }
    throw new CommerceError('unavailable', 'Wallet is busy. Retry this operation.');
  }

  async bindCustomer(uid: string): Promise<void> {
    await this.statement('INSERT INTO commerce_customers(revenue_cat_id, uid) VALUES (?, ?) ON CONFLICT(revenue_cat_id) DO UPDATE SET uid = excluded.uid', uid, uid).run();
  }

  async findCustomer(id: string): Promise<{ uid: string; revenueCatAppUserId: string } | null> {
    return this.statement('SELECT uid, revenue_cat_id AS revenueCatAppUserId FROM commerce_customers WHERE revenue_cat_id = ?', id).first();
  }

  async findTransaction(key: string): Promise<StoredTransaction | null> {
    const row = await this.statement('SELECT * FROM commerce_transactions WHERE tx_key = ?', key).first<TransactionRow>();
    return row ? storedTransaction(row) : null;
  }

  async findTransactions(keys: readonly string[]): Promise<Map<string, StoredTransaction>> {
    const unique = [...new Set(keys)];
    const found = new Map<string, StoredTransaction>();
    if (!unique.length) return found;
    // One JSON binding avoids D1's 100-parameter limit and uses one query per
    // 1,000 keys. A single read batch keeps ownership/refunds consistent across chunks.
    const statements: D1PreparedStatement[] = [];
    for (let offset = 0; offset < unique.length; offset += 1000) {
      const chunk = unique.slice(offset, offset + 1000);
      statements.push(this.statement('SELECT * FROM commerce_transactions WHERE tx_key IN (SELECT value FROM json_each(?))', JSON.stringify(chunk)));
    }
    const result = await this.database.batch<TransactionRow & { tx_key: string }>(statements);
    for (const group of result) for (const row of group.results) found.set(row.tx_key, storedTransaction(row));
    return found;
  }

  async getWallet(uid: string, environment: CommerceEnvironment): Promise<CommerceWallet> {
    const row = await this.statement('SELECT points, revision FROM commerce_wallets WHERE uid = ? AND environment = ?', uid, environment).first<WalletData>();
    return wallet(row ?? undefined, environment);
  }

  async applyVerifiedPurchase(uid: string, purchase: VerifiedPurchase): Promise<CommerceWallet> {
    const points = packPoints(purchase);
    const key = transactionKey(purchase);
    return this.optimistic(async () => {
      const { current, rows } = await this.read(uid, purchase.environment, [
        this.statement('SELECT * FROM commerce_transactions WHERE tx_key = ?', key),
        this.statement('SELECT * FROM commerce_lots WHERE uid = ? AND environment = ? AND tx_key = ?', uid, purchase.environment, key),
      ]);
      const prior = rows[0][0] as TransactionRow | undefined;
      const lot = rows[1][0] as Lot | undefined;
      if (prior && (prior.uid !== uid || prior.product_id !== purchase.productId || (!prior.refunded && !purchase.refunded && prior.quantity !== purchase.quantity))) {
        throw new CommerceError('permission-denied', 'The store transaction is already bound to another purchase identity.');
      }
      // Store refund tombstones always win over later purchases and stale provider snapshots.
      if (prior?.refunded || (prior && !purchase.refunded)) return current;
      const transactionValues = [uid, purchase.environment, purchase.transactionId, purchase.productId, purchase.store, prior?.quantity ?? purchase.quantity, purchase.purchasedAt, Number(purchase.refunded), prior?.points ?? points] as const;
      const transactionStatement = prior
        ? this.statement('UPDATE commerce_transactions SET uid = ?, environment = ?, transaction_id = ?, product_id = ?, store = ?, quantity = ?, purchased_at = ?, refunded = ?, points = ?, updated_at = CURRENT_TIMESTAMP WHERE tx_key = ?', ...transactionValues, key)
        : this.statement('INSERT INTO commerce_transactions(uid, environment, transaction_id, product_id, store, quantity, purchased_at, refunded, points, tx_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', ...transactionValues, key);
      return this.commit(uid, current, current.points + (purchase.refunded ? -(lot?.remaining ?? 0) : points), [
        transactionStatement,
        this.statement('INSERT INTO commerce_lots(uid, environment, tx_key, remaining, purchased_at, active, revoked) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(uid, environment, tx_key) DO UPDATE SET remaining = excluded.remaining, purchased_at = excluded.purchased_at, active = excluded.active, revoked = excluded.revoked', uid, purchase.environment, key, purchase.refunded ? 0 : points, purchase.purchasedAt, Number(!purchase.refunded), Number(purchase.refunded)),
      ]);
    });
  }

  /** Only frozen winners can receive a reward; wallet, lot and award commit together. */
  async awardWeekly(uid: string, environment: CommerceEnvironment, week: number): Promise<CommerceWallet> {
    return this.optimistic(async () => {
      const { current, rows } = await this.read(uid, environment, [
        this.statement('SELECT rank FROM weekly_winners WHERE uid = ? AND environment = ? AND week = ?', uid, environment, week),
        this.statement('SELECT points FROM weekly_awards WHERE uid = ? AND environment = ? AND week = ?', uid, environment, week),
      ]);
      if (rows[1].length) return current;
      const rank = (rows[0][0] as { rank: number } | undefined)?.rank;
      if (!rank || rank > 3) throw new CommerceError('failed-precondition', 'No weekly award.');
      const points = [100, 50, 25][rank - 1];
      return this.commit(uid, current, current.points + points, [
        this.statement('INSERT INTO weekly_awards(environment,week,uid,rank,points) VALUES (?,?,?,?,?)', environment, week, uid, rank, points),
        this.statement('INSERT INTO commerce_reward_lots(uid,environment,tx_key,remaining,purchased_at,active) VALUES (?,?,?,?,?,1)', uid, environment, `weekly:${week}`, points, week + 604800000),
      ]);
    });
  }

  async cosmeticAccount(uid: string, environment: CommerceEnvironment): Promise<CosmeticAccount> {
    const { current, rows } = await this.read(uid, environment, [this.statement('SELECT item_id FROM cosmetic_ownership WHERE uid = ? AND environment = ?', uid, environment)]);
    return { uid, environment, wallet: current, owned: (rows[0] as { item_id: string }[]).map(row => row.item_id) };
  }

  async purchaseCosmetic(uid: string, environment: CommerceEnvironment, request: CosmeticPurchase): Promise<CosmeticAccount> {
    identifier(request.operationId, 'operation ID');
    const part = partById(request.itemId);
    if (!part || !part.price || request.expectedPrice !== part.price) throw new CommerceError('invalid-argument', 'This part or price is unavailable.');
    await this.optimistic(async () => {
      const { current, rows } = await this.read(uid, environment, [
        this.statement('SELECT * FROM cosmetic_purchases WHERE uid = ? AND environment = ? AND operation_id = ?', uid, environment, request.operationId),
        this.statement('SELECT item_id FROM cosmetic_ownership WHERE uid = ? AND environment = ? AND item_id = ?', uid, environment, part.id),
        this.statement("SELECT *, 'purchase' AS source FROM commerce_lots WHERE uid = ? AND environment = ? AND active = 1 UNION ALL SELECT *, 'reward' AS source FROM commerce_reward_lots WHERE uid = ? AND environment = ? AND active = 1 ORDER BY purchased_at, tx_key LIMIT 50", uid, environment, uid, environment),
      ]);
      const prior = rows[0][0] as { item_id: string; expected_price: number } | undefined;
      if (prior) {
        if (prior.item_id !== part.id || prior.expected_price !== part.price) throw new CommerceError('already-exists', 'Operation belongs to another purchase.');
        return;
      }
      const cost = rows[1].length ? 0 : part.price;
      if (current.points < cost) throw new CommerceError('resource-exhausted', 'Not enough points.', { reason: 'insufficient_points', operationId: request.operationId });
      let remaining = cost;
      const allocations: Allocation[] = [];
      const updates: D1PreparedStatement[] = [];
      for (const lot of rows[2] as (Lot & { source: 'purchase' | 'reward' })[]) {
        if (!remaining) break;
        if (!Number.isSafeInteger(lot.remaining) || lot.remaining <= 0 || lot.revoked) throw new CommerceError('unavailable', 'Invalid wallet lot.');
        const spent = Math.min(remaining, lot.remaining);
        allocations.push({ lotId: lot.tx_key, points: spent, source: lot.source });
        updates.push(this.statement(`UPDATE ${lot.source === 'reward' ? 'commerce_reward_lots' : 'commerce_lots'} SET remaining = ?, active = ? WHERE uid = ? AND environment = ? AND tx_key = ?`, lot.remaining - spent, Number(lot.remaining > spent), uid, environment, lot.tx_key));
        remaining -= spent;
      }
      if (remaining) throw new CommerceError('unavailable', 'Wallet lots do not match its balance.');
      updates.push(this.statement('INSERT OR IGNORE INTO cosmetic_ownership(uid,environment,item_id) VALUES (?,?,?)', uid, environment, part.id));
      updates.push(this.statement('INSERT INTO cosmetic_purchases(uid,environment,operation_id,item_id,expected_price,charged,allocations) VALUES (?,?,?,?,?,?,?)', uid, environment, request.operationId, part.id, part.price, cost, JSON.stringify(allocations)));
      await this.commit(uid, current, current.points - cost, updates);
    });
    return this.cosmeticAccount(uid, environment);
  }

  async redeemTool(uid: string, environment: CommerceEnvironment, request: RedeemToolRequest): Promise<RedemptionResult> {
    request = parseRedemption(request);
    return this.optimistic(async () => {
      const { current, rows } = await this.read(uid, environment, [
        this.statement('SELECT * FROM commerce_redemptions WHERE uid = ? AND environment = ? AND operation_id = ?', uid, environment, request.operationId),
        this.statement('SELECT operation_id FROM commerce_revive_reservations WHERE uid = ? AND environment = ? AND run_id = ?', uid, environment, request.runId),
        this.statement("SELECT *, 'purchase' AS source FROM commerce_lots WHERE uid = ? AND environment = ? AND active = 1 UNION ALL SELECT *, 'reward' AS source FROM commerce_reward_lots WHERE uid = ? AND environment = ? AND active = 1 ORDER BY purchased_at, tx_key LIMIT 50", uid, environment, uid, environment),
      ]);
      const existing = rows[0][0] as ReceiptRow | undefined;
      if (existing) {
        const saved = receipt(existing);
        if (!sameRequest(saved, request)) throw new CommerceError('already-exists', 'This operation ID belongs to a different tool request.');
        return { wallet: current, receipt: saved };
      }
      if (request.tool === 'revive' && rows[1].length) throw new CommerceError('failed-precondition', 'This run already redeemed its paid revive.');
      if (current.points < request.expectedCost) throw new CommerceError('resource-exhausted', 'Not enough points.', { reason: 'insufficient_points', operationId: request.operationId });
      let remaining = request.expectedCost;
      const allocations: Allocation[] = [];
      const updates: D1PreparedStatement[] = [];
      for (const lot of rows[2] as (Lot & { source: 'purchase' | 'reward' })[]) {
        if (!Number.isSafeInteger(lot.remaining) || lot.remaining <= 0 || lot.revoked) throw new CommerceError('unavailable', 'Invalid wallet lot.');
        const spent = Math.min(remaining, lot.remaining);
        allocations.push({ lotId: lot.tx_key, points: spent, source: lot.source });
        updates.push(this.statement(`UPDATE ${lot.source === 'reward' ? 'commerce_reward_lots' : 'commerce_lots'} SET remaining = ?, active = ? WHERE uid = ? AND environment = ? AND tx_key = ?`, lot.remaining - spent, Number(lot.remaining > spent), uid, environment, lot.tx_key));
        remaining -= spent;
        if (!remaining) break;
      }
      if (remaining) throw new CommerceError('unavailable', 'Wallet lots do not match its balance.');
      const ready: ToolReceipt = { ...request, status: 'ready' };
      updates.push(this.statement('INSERT INTO commerce_redemptions(uid, environment, operation_id, run_id, tool, expected_cost, context_key, status, allocations) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', uid, environment, request.operationId, request.runId, request.tool, request.expectedCost, request.contextKey, ready.status, JSON.stringify(allocations)));
      if (request.tool === 'revive') updates.push(this.statement('INSERT INTO commerce_revive_reservations(uid, environment, run_id, operation_id) VALUES (?, ?, ?, ?)', uid, environment, request.runId, request.operationId));
      return { wallet: await this.commit(uid, current, current.points - request.expectedCost, updates), receipt: ready };
    });
  }

  async getRedemption(uid: string, environment: CommerceEnvironment, operationId: string): Promise<RedemptionResult | null> {
    identifier(operationId, 'operation ID');
    const { current, rows } = await this.read(uid, environment, [this.statement('SELECT * FROM commerce_redemptions WHERE uid = ? AND environment = ? AND operation_id = ?', uid, environment, operationId)]);
    const saved = rows[0][0] as ReceiptRow | undefined;
    return saved ? { wallet: current, receipt: receipt(saved) } : null;
  }

  async resolveTool(uid: string, environment: CommerceEnvironment, operationId: string, action: ResolveToolAction): Promise<RedemptionResult> {
    identifier(operationId, 'operation ID');
    if (action !== 'applied' && action !== 'refund') throw new CommerceError('invalid-argument', 'Invalid resolution.');
    return this.optimistic(async () => {
      // Read all allocation lots in the same snapshot as the wallet/receipt. JSON
      // extraction keeps the query bounded by that receipt's at most 50 allocations.
      const { current, rows } = await this.read(uid, environment, [
        this.statement('SELECT * FROM commerce_redemptions WHERE uid = ? AND environment = ? AND operation_id = ?', uid, environment, operationId),
        this.statement("SELECT * FROM commerce_lots WHERE uid = ? AND environment = ? AND tx_key IN (SELECT json_extract(value, '$.lotId') FROM commerce_redemptions, json_each(commerce_redemptions.allocations) WHERE uid = ? AND environment = ? AND operation_id = ?)", uid, environment, uid, environment, operationId),
        this.statement("SELECT * FROM commerce_reward_lots WHERE uid = ? AND environment = ? AND tx_key IN (SELECT json_extract(value, '$.lotId') FROM commerce_redemptions, json_each(commerce_redemptions.allocations) WHERE uid = ? AND environment = ? AND operation_id = ?)", uid, environment, uid, environment, operationId),
      ]);
      const saved = rows[0][0] as ReceiptRow | undefined;
      if (!saved) throw new CommerceError('not-found', 'Unknown tool operation.');
      const existing = receipt(saved);
      const status = action === 'applied' ? 'applied' : 'refunded';
      if (existing.status !== 'ready') {
        if (existing.status !== status) throw new CommerceError('failed-precondition', 'This tool operation was already resolved.');
        return { wallet: current, receipt: existing };
      }
      const updates: D1PreparedStatement[] = [];
      let restored = 0;
      if (action === 'refund') {
        const lots = new Map((rows[1] as Lot[]).map((lot) => [lot.tx_key, lot]));
        const allocations = JSON.parse(saved.allocations) as Allocation[];
        for (const allocation of allocations) {
          const lot = allocation.source === 'reward' ? (rows[2] as Lot[]).find((item) => item.tx_key === allocation.lotId) : lots.get(allocation.lotId);
          if (!lot) throw new CommerceError('unavailable', 'Missing purchase allocation.');
          // A tool refund cannot resurrect a store-refunded pack's spent points.
          if (!lot.revoked) {
            restored += allocation.points;
            updates.push(this.statement(`UPDATE ${allocation.source === 'reward' ? 'commerce_reward_lots' : 'commerce_lots'} SET remaining = ?, active = 1 WHERE uid = ? AND environment = ? AND tx_key = ?`, lot.remaining + allocation.points, uid, environment, allocation.lotId));
          }
        }
        if (existing.tool === 'revive') updates.push(this.statement('DELETE FROM commerce_revive_reservations WHERE uid = ? AND environment = ? AND run_id = ? AND operation_id = ?', uid, environment, existing.runId, operationId));
      }
      updates.push(this.statement('UPDATE commerce_redemptions SET status = ?, resolved_at = CURRENT_TIMESTAMP WHERE uid = ? AND environment = ? AND operation_id = ?', status, uid, environment, operationId));
      return { wallet: await this.commit(uid, current, current.points + restored, updates), receipt: { ...existing, status } };
    });
  }
}

export { D1CommerceWallet as D1Wallet };
