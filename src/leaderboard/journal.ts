import type { LeaderboardService, RankedRun, ReplayAction, ReplayBatch, ReplayCommand } from './contracts';
import { MAX_BATCH_COMMANDS, MAX_BATCH_TICKS } from './contracts';
export interface JournalStorage { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void>; removeItem(key: string): Promise<void> }
interface SavedJournal { run: RankedRun; elapsed: number; sequence: number; from: number; commands: ReplayCommand[]; batches: ReplayBatch[]; snapshot: string; verified: number; disabled?: string; pendingTool?: { action: Extract<ReplayAction, { type: 'tool' }>; before: string; after: string } }
export const ACTIVE_RANKED_KEY = 'pullthread.weekly.active.v1';
const QUEUE_KEY = 'pullthread.weekly.queue.v1';
let queueWrite: Promise<void> = Promise.resolve();
export class RankedJournal {
  private data: SavedJournal;
  private write: Promise<void> = Promise.resolve();
  private flight?: Promise<void>;
  status = 'Pending verification';
  private failed = false;
  private aiming = false;
  private durableSequence = 0;
  constructor(readonly run: RankedRun, private storage: JournalStorage, private service: LeaderboardService, saved?: SavedJournal) {
    this.durableSequence = saved?.sequence ?? 0;
    this.data = saved ?? { run, elapsed: 0, sequence: 0, from: 0, commands: [], batches: [], snapshot: '', verified: 0 };
    if (saved?.disabled) { this.failed = true; this.status = saved.disabled; }
  }
  static async recover(storage: JournalStorage, service: LeaderboardService): Promise<RankedJournal | null> {
    const key = await storage.getItem(ACTIVE_RANKED_KEY);
    const raw = key ? await storage.getItem(key) : null;
    if (!raw) return null;
    try {
      const data = JSON.parse(raw) as SavedJournal;
      if (!data.run || !Array.isArray(data.batches) || !Array.isArray(data.commands) || !Number.isSafeInteger(data.elapsed) || typeof data.snapshot !== 'string') return null;
      if (data.run.uid !== await service.getAccountId()) return null;
      if (Date.now() >= data.run.deadline) data.disabled = 'Week ended · last verified score saved';
      return new RankedJournal(data.run, storage, service, data);
    } catch { return null; }
  }
  private get key() { return `pullthread.weekly.run.${this.run.environment}.${this.run.uid}.${this.run.id}`; }
  async activate(): Promise<void> {
    queueWrite = queueWrite.catch(() => undefined).then(async () => {
      const keys = JSON.parse(await this.storage.getItem(QUEUE_KEY) ?? '[]') as string[];
      if (!keys.includes(this.key)) keys.push(this.key);
      if (keys.length > 32) { this.invalidate(); return; }
      await this.storage.setItem(QUEUE_KEY, JSON.stringify(keys));
      await this.storage.setItem(ACTIVE_RANKED_KEY, this.key);
    });
    await queueWrite;
  }
  static async retryPending(storage: JournalStorage, service: LeaderboardService, activeId?: string): Promise<void> {
    const uid = await service.getAccountId();
    const keys = JSON.parse(await storage.getItem(QUEUE_KEY) ?? '[]') as string[];
    for (const key of keys) {
      const raw = await storage.getItem(key);
      if (!raw) continue;
      const data = JSON.parse(raw) as SavedJournal;
      if (data.run.uid !== uid || data.run.id === activeId) continue;
      const journal = new RankedJournal(data.run, storage, service, data);
      await journal.flush();
      if (Date.now() >= data.run.deadline || !journal.data.batches.length) {
        await storage.removeItem(key);
        queueWrite = queueWrite.catch(() => undefined).then(async () => {
          const current = JSON.parse(await storage.getItem(QUEUE_KEY) ?? '[]') as string[];
          await storage.setItem(QUEUE_KEY, JSON.stringify(current.filter(item => item !== key)));
        });
        await queueWrite;
      }
    }
  }
  async prepareTool(action: Extract<ReplayAction, { type: 'tool' }>, before: string, after: string): Promise<void> {
    this.data.pendingTool = { action, before, after };
    await this.checkpoint(before);
  }
  reconcileTool(snapshot: string): boolean {
    const pending = this.data.pendingTool;
    if (pending && snapshot === pending.after) { this.action(pending.action); this.data.pendingTool = undefined; return true; }
    if (pending && snapshot === pending.before) { this.data.pendingTool = undefined; return true; }
    if (snapshot === this.data.snapshot) return true;
    this.invalidate(); return false;
  }
  get hasPendingTool() { return !!this.data.pendingTool; }
  get snapshot() { return this.data.snapshot; }
  get verifiedScore() { return this.data.verified; }
  action(action: ReplayAction): void {
    if (this.failed) return;
    if (this.data.commands.length >= MAX_BATCH_COMMANDS || (action.type === 'tool' && action.operationId && this.data.commands.filter(command => command.type === 'tool' && command.operationId).length >= 8)) this.seal();
    this.aiming = action.type === 'aim' ? true : action.type === 'cancel' || action.type === 'launch' || action.type === 'tool' ? false : this.aiming;
    this.data.commands.push({ ...action, at: this.data.elapsed });
  }
  cancelActiveAim(): void { if (this.aiming) this.action({ type: 'cancel' }); }
  tick(): void { if (!this.failed) { this.data.elapsed++; if (this.data.elapsed - this.data.from >= MAX_BATCH_TICKS) this.seal(); } }
  private seal(): void {
    if (this.data.elapsed === this.data.from && !this.data.commands.length) return;
    this.data.batches.push({ sequence: this.data.sequence++, from: this.data.from, to: this.data.elapsed, commands: this.data.commands });
    this.data.commands = []; this.data.from = this.data.elapsed;
    if (this.data.batches.length > 1800) this.invalidate();
  }
  invalidate(): void { this.failed = true; this.status = 'Local run · replay unavailable'; this.data.disabled = this.status; }
  /** Snapshot and command cursor are persisted together before any network acknowledgement. */
  checkpoint(snapshot: string): Promise<void> {
    this.data.snapshot = snapshot;
    this.seal();
    const value = JSON.stringify(this.data);
    const sequence = this.data.sequence;
    this.write = this.write.catch(() => undefined).then(() => this.storage.setItem(this.key, value)).then(() => { this.durableSequence = sequence; });
    return this.write.catch(() => { this.invalidate(); });
  }
  flush(): Promise<void> {
    if (this.flight) return this.flight;
    this.flight = (async () => {
      await this.write;
      if (this.failed) return;
      try {
        while (this.data.batches.length && this.data.batches[0].sequence < this.durableSequence) {
          if (Date.now() >= this.run.deadline) { this.status = 'Week ended · last verified score saved'; return; }
          const batch = this.data.batches[0];
          const response = await this.service.upload(this.run.id, batch);
          this.data.batches.shift(); this.data.verified = response.score;
          // Persist only a consistent checkpoint. A crash can resend accepted batches safely.
          this.status = `Verified · ${response.score} pockets`;
        }
      } catch { this.status = 'Pending · reconnect before the deadline'; }
    })().finally(() => { this.flight = undefined; });
    return this.flight;
  }
}
