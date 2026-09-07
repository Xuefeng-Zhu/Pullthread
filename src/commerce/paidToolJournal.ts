import type { CommerceService, RedeemToolRequest, RedemptionResult } from './contracts';
import { isInsufficientPointsError } from '../services/commerce/errors';

export const PAID_TOOL_JOURNAL_KEY = 'pullthread.paid-tool-journal.v1';
export function paidToolJournalKey(service: Pick<CommerceService, 'mode' | 'environment'>): string {
  return `${PAID_TOOL_JOURNAL_KEY}.${service.mode}.${service.environment}`;
}

export interface JournalStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

interface Entry {
  version: 1;
  accountId: string;
  environment: CommerceService['environment'];
  mode: CommerceService['mode'];
  request: RedeemToolRequest;
  phase: 'prepared' | 'delivered' | 'cancelled';
  before: string;
  after: string;
}

export interface RecoveredTool {
  snapshot: string | null;
  result: RedemptionResult | null;
  refunded: boolean;
  cancelled?: boolean;
}

/**
 * Durable intent precedes every debit. Delivery is a saved run replacement,
 * never a second call to the gameplay effect. All I/O is ordered, including
 * background saves and restart, so older writes cannot resurrect a spent tool.
 */
export class PaidToolJournal {
  private tail: Promise<unknown> = Promise.resolve();
  private entry: Entry | null = null;
  private settling = 0;

  constructor(private storage: JournalStorage, private service: CommerceService,
    private validSnapshot: (snapshot: string) => boolean) {}

  private get key() { return paidToolJournalKey(this.service); }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work, work);
    this.tail = result.catch(() => undefined);
    return result;
  }

  private async write(entry: Entry) {
    await this.storage.setItem(this.key, JSON.stringify(entry));
    this.entry = entry;
  }

  private async read(): Promise<Entry | null> {
    const raw = await this.storage.getItem(this.key);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<Entry>;
    if (value.version !== 1 || !value.request?.operationId || !value.accountId
      || !['prepared', 'delivered', 'cancelled'].includes(value.phase ?? '')
      || typeof value.before !== 'string' || typeof value.after !== 'string') {
      throw new Error('The saved tool could not be read. Please keep this app installed and try again.');
    }
    return value as Entry;
  }

  private async checkAccount(entry: Entry) {
    if (entry.mode !== this.service.mode || entry.environment !== this.service.environment
      || entry.accountId !== await this.service.getAccountId()) {
      throw new Error('This saved tool belongs to a different points account. Your free tools still work.');
    }
  }

  private async deliver(entry: Entry, result: RedemptionResult): Promise<RecoveredTool> {
    if (result.receipt.status === 'refunded') {
      await this.storage.removeItem(this.key);
      this.entry = null;
      return { snapshot: this.validSnapshot(entry.before) ? entry.before : null, result, refunded: true };
    }
    if (!this.validSnapshot(entry.after)) {
      // An app/schema change cannot silently eat an unapplied redemption.
      if (result.receipt.status !== 'ready') throw new Error('Your saved run needs a compatible app update.');
      const refund = await this.service.resolveTool(entry.request.operationId, 'refund');
      await this.storage.removeItem(this.key);
      this.entry = null;
      return { snapshot: null, result: refund, refunded: true };
    }
    // The effect snapshot already exists on disk. A crash before/after the
    // acknowledgement recovers that same snapshot and the same operation ID.
    const resolved = result.receipt.status === 'applied' ? result
      : await this.service.resolveTool(entry.request.operationId, 'applied');
    if (resolved.receipt.status === 'refunded') return this.deliver(entry, resolved);
    await this.write({ ...entry, phase: 'delivered' });
    return { snapshot: entry.after, result: resolved, refunded: false };
  }

  recover(): Promise<RecoveredTool> {
    this.settling++;
    return this.serial(async () => {
      const entry = await this.read();
      this.entry = entry;
      if (!entry) return { snapshot: null, result: null, refunded: false };
      await this.checkAccount(entry);
      if (entry.phase !== 'prepared' && this.validSnapshot(entry.after)) {
        return { snapshot: entry.after, result: null, refunded: false, ...(entry.phase === 'cancelled' ? { cancelled: true } : {}) };
      }
      const receipt = await this.service.getRedemption(entry.request.operationId);
      if (!receipt && !this.validSnapshot(entry.after)) {
        // There is no charge to refund, and an invalid intent must not debit.
        await this.storage.removeItem(this.key);
        this.entry = null;
        return { snapshot: null, result: null, refunded: false };
      }
      try {
        return this.deliver(entry, receipt ?? await this.service.redeemTool(entry.request));
      } catch (error) {
        if (!isInsufficientPointsError(error, entry.request.operationId)) throw error;
        // The server explicitly refused this operation without a debit. Keep
        // the prior run (which may contain earlier paid tools) but never send
        // the refused operation again, including after another process death.
        const before = this.validSnapshot(entry.before) ? entry.before : null;
        if (before) await this.write({ ...entry, phase: 'cancelled', after: before });
        else { await this.storage.removeItem(this.key); this.entry = null; }
        return { snapshot: before, result: null, refunded: false, cancelled: true };
      }
    }).finally(() => { this.settling--; });
  }

  redeem(request: RedeemToolRequest, before: string, after: string): Promise<RecoveredTool> {
    if (this.settling > 0) return Promise.reject(new Error('A tool is already being checked.'));
    this.settling++;
    return this.serial(async () => {
      if (!this.validSnapshot(before) || !this.validSnapshot(after)) throw new Error('This tool cannot be used in the current run.');
      const existing = await this.read();
      if (existing?.phase === 'prepared') throw new Error('Finish recovering your previous tool first.');
      const entry: Entry = {
        version: 1, accountId: await this.service.getAccountId(),
        mode: this.service.mode, environment: this.service.environment,
        request, phase: 'prepared', before, after,
      };
      // Storage failure stops the request before any points can be spent.
      await this.write(entry);
      try {
        return this.deliver(entry, await this.service.redeemTool(request));
      } catch (error) {
        // Only a request-bound, authoritative nondebit response can discard an
        // intent. Network, timeout and generic quota errors remain recoverable.
        if (isInsufficientPointsError(error, request.operationId)) {
          if (existing) await this.write({ ...existing, after: before });
          else { await this.storage.removeItem(this.key); this.entry = null; }
        }
        throw error;
      }
    }).finally(() => { this.settling--; });
  }

  saveRun(snapshot: string): Promise<void> {
    // A background callback can capture the BEFORE run while a debit awaits its
    // server response. Never queue that stale snapshot behind the paid effect.
    if (this.settling > 0) return Promise.resolve();
    return this.serial(async () => {
      if (this.entry && this.entry.phase !== 'prepared') {
        if (!this.validSnapshot(snapshot)) throw new Error('Your run could not be saved.');
        await this.write({ ...this.entry, after: snapshot });
      }
    });
  }

  abandonRun(): Promise<void> {
    return this.serial(async () => {
      const entry = await this.read();
      if (entry?.phase === 'prepared') {
        await this.checkAccount(entry);
        const receipt = await this.service.getRedemption(entry.request.operationId);
        // Do not remove an uncertain request: the backend may still be handling
        // it. Recover it with its original ID before offering a new run.
        if (!receipt) throw new Error('Your tool is still being checked. Try recovering it before starting a new run.');
        if (receipt.receipt.status === 'ready') await this.service.resolveTool(entry.request.operationId, 'refund');
      }
      await this.storage.removeItem(this.key);
      this.entry = null;
    });
  }
}
