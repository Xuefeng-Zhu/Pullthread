import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import type { CommerceEnvironment, CommerceWallet, RedeemToolRequest, RedemptionResult, ResolveToolAction, ToolReceipt } from '../../../src/commerce/contracts';
import { CommerceError, hash, identifier, packPoints, parseRedemption, sameRequest, transactionKey, type VerifiedPurchase } from './domain';

interface WalletData { points: number; revision: number }
interface Lot { remaining: number; purchasedAt: number; active: boolean; revoked: boolean }
interface Allocation { lotId: string; points: number }
interface ReceiptData { receipt: ToolReceipt; allocations: Allocation[] }
export function walletRef(database: Firestore, uid: string, environment: CommerceEnvironment) {
  return database.collection('commerce_wallets').doc(hash(uid)).collection('environments').doc(environment);
}
function wallet(data: WalletData | undefined, environment: CommerceEnvironment): CommerceWallet {
  if (data && (!Number.isSafeInteger(data.points) || data.points < 0 || !Number.isSafeInteger(data.revision) || data.revision < 0)) throw new CommerceError('unavailable', 'Wallet requires reconciliation.');
  return { points: data?.points ?? 0, revision: data?.revision ?? 0, environment };
}
export async function bindCustomer(database: Firestore, uid: string): Promise<void> {
  await database.collection('commerce_customers').doc(hash(uid)).set({ uid, revenueCatAppUserId: uid }, { merge: true });
}
export async function getWallet(database: Firestore, uid: string, environment: CommerceEnvironment): Promise<CommerceWallet> {
  return wallet((await walletRef(database, uid, environment).get()).data() as WalletData | undefined, environment);
}
/** Transaction identity is global within store/environment, so RevenueCat aliases cannot mint a second grant. */
export async function applyVerifiedPurchase(database: Firestore, uid: string, purchase: VerifiedPurchase): Promise<CommerceWallet> {
  const points = packPoints(purchase);
  const key = transactionKey(purchase);
  const globalRef = database.collection('commerce_transactions').doc(key);
  const account = walletRef(database, uid, purchase.environment);
  const lotRef = account.collection('lots').doc(key);
  return database.runTransaction(async (transaction) => {
    const [existing, accountSnapshot, lotSnapshot] = await transaction.getAll(globalRef, account, lotRef);
    const current = wallet(accountSnapshot.data() as WalletData | undefined, purchase.environment);
    const prior = existing.data();
    if (prior && (prior.uid !== uid || prior.productId !== purchase.productId || (!prior.refunded && !purchase.refunded && prior.quantity !== purchase.quantity))) {
      throw new CommerceError('permission-denied', 'The store transaction is already bound to another purchase identity.');
    }
    // A refund tombstone wins forever over a late purchase delivery or stale reconciliation snapshot.
    if (prior?.refunded || (prior && !purchase.refunded)) return current;
    const lot = lotSnapshot.data() as Lot | undefined;
    const change = purchase.refunded ? -(lot?.remaining ?? 0) : points;
    const next = { ...current, points: current.points + change, revision: current.revision + 1 };
    if (next.points < 0 || !Number.isSafeInteger(next.points)) throw new CommerceError('unavailable', 'Wallet reconciliation failed.');
    transaction.set(globalRef, { uid, ...purchase, quantity: prior?.quantity ?? purchase.quantity, points: prior?.points ?? points, updatedAt: FieldValue.serverTimestamp() });
    transaction.set(lotRef, { remaining: purchase.refunded ? 0 : points, active: !purchase.refunded,
      revoked: purchase.refunded, purchasedAt: purchase.purchasedAt });
    transaction.set(account, { ...next, uid, updatedAt: FieldValue.serverTimestamp() });
    return next;
  });
}
export async function redeemTool(database: Firestore, uid: string, environment: CommerceEnvironment, request: RedeemToolRequest): Promise<RedemptionResult> {
  request = parseRedemption(request);
  const account = walletRef(database, uid, environment);
  const receiptRef = account.collection('redemptions').doc(request.operationId);
  const runRef = account.collection('runs').doc(request.runId);
  return database.runTransaction(async (transaction) => {
    const [accountSnapshot, receiptSnapshot, runSnapshot] = await transaction.getAll(account, receiptRef, runRef);
    const current = wallet(accountSnapshot.data() as WalletData | undefined, environment);
    const existing = receiptSnapshot.data() as ReceiptData | undefined;
    if (existing) {
      if (!sameRequest(existing.receipt, request)) throw new CommerceError('already-exists', 'This operation ID belongs to a different tool request.');
      return { wallet: current, receipt: existing.receipt };
    }
    if (request.tool === 'revive' && runSnapshot.exists) throw new CommerceError('failed-precondition', 'This run already redeemed its paid revive.');
    if (current.points < request.expectedCost) throw new CommerceError('resource-exhausted', 'Not enough points.', { reason: 'insufficient_points', operationId: request.operationId });
    // Each active lot contains at least one point; 50 FIFO lots cover the largest tool price.
    const lots = await transaction.get(account.collection('lots').where('active', '==', true).orderBy('purchasedAt').limit(50));
    let remaining = request.expectedCost;
    const allocations: Allocation[] = [];
    for (const snapshot of lots.docs) {
      const lot = snapshot.data() as Lot;
      if (!Number.isSafeInteger(lot.remaining) || lot.remaining <= 0 || lot.revoked) throw new CommerceError('unavailable', 'Invalid wallet lot.');
      const spent = Math.min(remaining, lot.remaining);
      if (spent > 0) {
        allocations.push({ lotId: snapshot.id, points: spent });
        transaction.update(snapshot.ref, { remaining: lot.remaining - spent, active: lot.remaining > spent });
        remaining -= spent;
      }
      if (!remaining) break;
    }
    if (remaining) throw new CommerceError('unavailable', 'Wallet lots do not match its balance.');
    const next = { ...current, points: current.points - request.expectedCost, revision: current.revision + 1 };
    const receipt: ToolReceipt = { ...request, status: 'ready' };
    transaction.set(account, { ...next, uid, updatedAt: FieldValue.serverTimestamp() });
    transaction.create(receiptRef, { receipt, allocations, createdAt: FieldValue.serverTimestamp() });
    if (request.tool === 'revive') transaction.create(runRef, { reviveOperationId: request.operationId });
    return { wallet: next, receipt };
  });
}
export async function getRedemption(database: Firestore, uid: string, environment: CommerceEnvironment, operationId: string): Promise<RedemptionResult | null> {
  identifier(operationId, 'operation ID');
  return database.runTransaction(async (transaction) => {
    const account = walletRef(database, uid, environment);
    const [accountSnapshot, receiptSnapshot] = await transaction.getAll(account, account.collection('redemptions').doc(operationId));
    if (!receiptSnapshot.exists) return null;
    return { wallet: wallet(accountSnapshot.data() as WalletData | undefined, environment), receipt: (receiptSnapshot.data() as ReceiptData).receipt };
  });
}
export async function resolveTool(database: Firestore, uid: string, environment: CommerceEnvironment, operationId: string, action: ResolveToolAction): Promise<RedemptionResult> {
  identifier(operationId, 'operation ID');
  if (action !== 'applied' && action !== 'refund') throw new CommerceError('invalid-argument', 'Invalid resolution.');
  const account = walletRef(database, uid, environment);
  const receiptRef = account.collection('redemptions').doc(operationId);
  return database.runTransaction(async (transaction) => {
    const [accountSnapshot, receiptSnapshot] = await transaction.getAll(account, receiptRef);
    if (!receiptSnapshot.exists) throw new CommerceError('not-found', 'Unknown tool operation.');
    const saved = receiptSnapshot.data() as ReceiptData;
    const current = wallet(accountSnapshot.data() as WalletData | undefined, environment);
    const status = action === 'applied' ? 'applied' : 'refunded';
    if (saved.receipt.status !== 'ready') {
      if (saved.receipt.status !== status) throw new CommerceError('failed-precondition', 'This tool operation was already resolved.');
      return { wallet: current, receipt: saved.receipt };
    }
    let restored = 0;
    const runRef = account.collection('runs').doc(saved.receipt.runId);
    const reviveReservation = action === 'refund' && saved.receipt.tool === 'revive' ? await transaction.get(runRef) : undefined;
    if (action === 'refund') {
      const refs = saved.allocations.map((allocation) => account.collection('lots').doc(allocation.lotId));
      const snapshots = refs.length ? await transaction.getAll(...refs) : [];
      snapshots.forEach((snapshot, index) => {
        const lot = snapshot.data() as Lot | undefined;
        if (!lot) throw new CommerceError('unavailable', 'Missing purchase allocation.');
        // Refunding an unused tool never resurrects points from a store-refunded pack.
        if (!lot.revoked) {
          const amount = saved.allocations[index].points;
          restored += amount;
          transaction.update(snapshot.ref, { remaining: lot.remaining + amount, active: true });
        }
      });
    }
    // Releasing the reservation is atomic with the refund. An idempotent old refund
    // returns above, so it cannot erase a later revive's reservation.
    if (reviveReservation?.get('reviveOperationId') === operationId) transaction.delete(runRef);
    const next = { ...current, points: current.points + restored, revision: current.revision + 1 };
    const receipt: ToolReceipt = { ...saved.receipt, status };
    transaction.update(receiptRef, { receipt, resolvedAt: FieldValue.serverTimestamp() });
    transaction.set(account, { ...next, uid, updatedAt: FieldValue.serverTimestamp() });
    return { wallet: next, receipt };
  });
}
