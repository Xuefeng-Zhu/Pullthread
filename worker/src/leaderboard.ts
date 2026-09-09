import { readTrustedCheckpoint } from './checkpoint';
import { CommerceError, identifier } from '../../functions/src/commerce/domain';
import type { CommerceEnvironment } from '../../src/commerce/contracts';
import { LEGACY_REGISTRATION_RULESET, RULESET, WEEK_MS, weekStart, type ReplayBatch, type RankedRun, type Standings } from '../../src/leaderboard/contracts';
import * as weekly1 from '../rulesets/stitched-v4-weekly-1';
import * as weekly2 from '../rulesets/stitched-v4-weekly-2';
import * as weekly3 from '../rulesets/stitched-v4-weekly-3';
import * as creativeWeekly1 from '../rulesets/stitched-v5-weekly-1';
import * as inventoryWeekly1 from '../rulesets/stitched-v6-weekly-1';
import type { Env } from './env';
import { D1CommerceWallet } from './wallet';
interface RunRow { id: string; uid: string; environment: CommerceEnvironment; seed: number; week: number; created_at: number; ruleset: string; sequence: number; elapsed: number; aiming: number; checkpoint: string }
const invalid = (message: string): never => { throw new CommerceError('failed-precondition', message); };
const engines = {
  'stitched-v4-weekly-1': weekly1,
  'stitched-v4-weekly-2': weekly2,
  'stitched-v4-weekly-3': weekly3,
  'stitched-v5-weekly-1': creativeWeekly1,
  'stitched-v6-weekly-1': inventoryWeekly1,
} as const;
type Engine = typeof weekly1;
const engineFor = (ruleset: string): Engine | undefined => Object.hasOwn(engines, ruleset) ? engines[ruleset as keyof typeof engines] : undefined;
const registrationRulesets: readonly string[] = [LEGACY_REGISTRATION_RULESET, 'stitched-v5-weekly-1', RULESET];
export const enabled = (value: string | undefined, environment: string) => (value ?? '').split(',').includes(environment);
export class WeeklyLeaderboard {
  constructor(private env: Env, private now: () => number = Date.now) {}
  private sql(query: string, ...values: (number | string)[]) { return this.env.DB.prepare(query).bind(...values); }
  private publicRun(run: RunRow): RankedRun { return { id: run.id, uid: run.uid, environment: run.environment, seed: run.seed, week: run.week, deadline: run.week + WEEK_MS, ruleset: run.ruleset }; }
  async register(uid: string, environment: CommerceEnvironment, requestId: string, requestedRuleset?: unknown): Promise<RankedRun> {
    identifier(requestId, 'request ID');
    const prior = await this.sql('SELECT * FROM weekly_runs WHERE uid=? AND environment=? AND request_id=?', uid, environment, requestId).first<RunRow>();
    if (prior) return this.publicRun(prior);
    const ruleset = requestedRuleset === undefined ? LEGACY_REGISTRATION_RULESET : requestedRuleset;
    if (typeof ruleset !== 'string' || !registrationRulesets.includes(ruleset) || !engineFor(ruleset)) return invalid('This competition version is unavailable. Update the app.');
    const now = this.now();
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    const id = crypto.randomUUID();
    // A deterministic alias is stable without collecting a public display name.
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(uid)));
    const alias = `${['Cozy','Brave','Nimble','Sunny','Velvet','Merry','Tiny','Lucky'][hash[0] % 8]} ${['Button','Bobbin','Thimble','Ribbon','Stitch','Spool','Pocket','Quilt'][hash[1] % 8]} ${Array.from(hash.slice(2, 5), n => n.toString(16).padStart(2, '0')).join('')}`;
    const engine = engineFor(ruleset)!;
    await this.env.DB.batch([
      this.sql('INSERT OR IGNORE INTO weekly_profiles(uid,alias) VALUES (?,?)', uid, alias),
      this.sql(`INSERT OR IGNORE INTO weekly_runs(id,uid,environment,request_id,seed,week,created_at,ruleset,checkpoint)
        SELECT ?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM weekly_runs WHERE uid=? AND environment=? AND created_at>?) < 20
        AND (SELECT COUNT(*) FROM weekly_runs WHERE uid=? AND environment=? AND created_at>?) < 200`,
      id, uid, environment, requestId, seed, weekStart(now), now, ruleset, engine.serializeEndlessRun(engine.createRankedSimulation(seed)), uid, environment, now - 60000, uid, environment, now - 86400000),
    ]);
    const row = await this.sql('SELECT * FROM weekly_runs WHERE uid=? AND environment=? AND request_id=?', uid, environment, requestId).first<RunRow>();
    if (!row) throw new CommerceError('resource-exhausted', 'Too many run starts. Play locally and try again later.');
    return this.publicRun(row);
  }
  async upload(uid: string, environment: CommerceEnvironment, runId: string, batch: ReplayBatch) {
    identifier(runId, 'run ID');
    if (!batch || !Number.isSafeInteger(batch.sequence)) return invalid('Invalid replay batch.');
    const read = await this.env.DB.batch([
      this.sql('SELECT * FROM weekly_runs WHERE id=? AND uid=? AND environment=?', runId, uid, environment),
      this.sql('SELECT digest,score FROM weekly_batches WHERE run_id=? AND sequence=?', runId, batch.sequence),
    ]);
    const row = read[0].results[0] as unknown as RunRow | undefined;
    const engine = row && engineFor(row.ruleset);
    if (!row || !engine) return invalid('This ranked run is unavailable.');
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(batch)))), n => n.toString(16).padStart(2, '0')).join('');
    const prior = read[1].results[0] as unknown as { digest: string; score: number } | undefined;
    if (prior) return prior.digest === digest ? { sequence: batch.sequence, score: prior.score } : invalid('Batch ID already used.');
    const now = this.now();
    if (now >= row.week + WEEK_MS) return invalid('This week has ended. Your last verified score is saved.');
    if (batch.sequence > 100 + Math.floor(row.elapsed / 30)) throw new CommerceError('resource-exhausted', 'Too many replay batches.');
    if (row.sequence !== batch.sequence) return invalid('Upload the preceding batch first.');
    try { engine.validateBatch(batch, row.elapsed); } catch { return invalid('Invalid replay batch.'); }
    if (batch.to > Math.floor((now - row.created_at) * .12) + 120 || batch.to > 120 * 86400) return invalid('Replay clock is ahead of server time.');
    const run = readTrustedCheckpoint(row.checkpoint);
    if (!run) return invalid('Checkpoint unavailable.');
    const cursor = { elapsed: row.elapsed, aiming: !!row.aiming };
    const receipts: string[] = [];
    try {
      await engine.replayBatch(run, cursor, batch, async (command, context) => {
        const operation = command.operationId!;
        if (receipts.includes(operation)) throw new Error('Duplicate receipt.');
        const receipt = await this.sql('SELECT run_id,tool,context_key,status FROM commerce_redemptions WHERE uid=? AND environment=? AND operation_id=?', uid, environment, operation).first<{ run_id: string; tool: string; context_key: string; status: string }>();
        if (!receipt || receipt.run_id !== runId || receipt.tool !== command.tool || receipt.context_key !== context || receipt.status !== 'applied') throw new Error('Receipt not applied.');
        receipts.push(operation);
      });
    } catch { return invalid('Replay could not be verified. Retry after tool delivery completes.'); }
    const score = run.pocketsCaught;
    await this.env.DB.batch([
      this.sql('UPDATE weekly_runs SET checkpoint=?,sequence=sequence+1,elapsed=?,aiming=? WHERE id=? AND sequence=? AND NOT EXISTS(SELECT 1 FROM weekly_settlements WHERE environment=? AND week=?)', engine.serializeEndlessRun(run), cursor.elapsed, Number(cursor.aiming), runId, batch.sequence, environment, row.week),
      this.sql('INSERT INTO commerce_revision_assertions(matched) SELECT changes() WHERE changes()!=1'),
      ...receipts.map(operation => this.sql('INSERT INTO weekly_receipts(uid,environment,operation_id,run_id) VALUES (?,?,?,?)', uid, environment, operation, runId)),
      this.sql('INSERT INTO weekly_batches(run_id,sequence,digest,score) VALUES (?,?,?,?)', runId, batch.sequence, digest, score),
      // Reinsert only on an improvement: AUTOINCREMENT defines server acceptance tie order.
      this.sql('DELETE FROM weekly_entries WHERE uid=? AND environment=? AND week=? AND score<?', uid, environment, row.week, score),
      this.sql('INSERT OR IGNORE INTO weekly_entries(uid,environment,week,score) SELECT ?,?,?,? WHERE ?>0', uid, environment, row.week, score, score),
    ]);
    return { sequence: batch.sequence, score };
  }
  async standings(uid: string, environment: CommerceEnvironment): Promise<Standings> {
    const now = this.now(), week = weekStart(now);
    const ranking = 'SELECT e.uid,p.alias,e.score,ROW_NUMBER() OVER(ORDER BY score DESC,accepted) AS rank FROM weekly_entries e JOIN weekly_profiles p ON p.uid=e.uid WHERE environment=? AND week=?';
    const results = await this.env.DB.batch([
      this.sql(`SELECT alias,score,rank FROM (${ranking}) LIMIT 50`, environment, week),
      this.sql(`SELECT alias,score,rank FROM (${ranking}) WHERE uid=?`, environment, week, uid),
      this.sql('SELECT p.alias,w.score,w.rank FROM weekly_winners w JOIN weekly_profiles p ON p.uid=w.uid WHERE environment=? AND week=? ORDER BY rank', environment, week - WEEK_MS),
      this.sql('SELECT week,rank,points FROM weekly_awards WHERE uid=? AND environment=? ORDER BY week DESC LIMIT 52', uid, environment),
    ]);
    return { uid, week, deadline: week + WEEK_MS, serverTime: now, prizesEnabled: enabled(this.env.LEADERBOARD_PRIZES_ENABLED, environment), leaders: results[0].results as unknown as Standings['leaders'], own: (results[1].results[0] as unknown as Standings['own']) ?? null, previous: results[2].results as unknown as Standings['previous'], awards: results[3].results as unknown as Standings['awards'], wallet: await new D1CommerceWallet(this.env.DB).getWallet(uid, environment) };
  }
  async settle(): Promise<void> {
    const deadline = weekStart(this.now());
    for (const environment of ['sandbox', 'production'] as const) {
      if (!enabled(this.env.LEADERBOARD_ENABLED_ENVIRONMENTS, environment)) continue;
      const weeks = await this.sql('SELECT DISTINCT week FROM weekly_entries WHERE environment=? AND week<? AND NOT EXISTS(SELECT 1 FROM weekly_settlements s WHERE s.environment=weekly_entries.environment AND s.week=weekly_entries.week) ORDER BY week LIMIT 4', environment, deadline).all<{ week: number }>();
      for (const { week } of weeks.results) {
        await this.env.DB.batch([
          this.sql('INSERT OR IGNORE INTO weekly_winners(environment,week,uid,rank,score) SELECT environment,week,uid,ROW_NUMBER() OVER(ORDER BY score DESC,accepted),score FROM weekly_entries WHERE environment=? AND week=? ORDER BY score DESC,accepted LIMIT 3', environment, week),
          this.sql('INSERT OR IGNORE INTO weekly_settlements(environment,week,rewards_enabled) VALUES (?,?,?)', environment, week, Number(enabled(this.env.LEADERBOARD_PRIZES_ENABLED, environment))),
        ]);
      }
      if (!enabled(this.env.LEADERBOARD_PRIZES_ENABLED, environment)) continue;
      const pending = await this.sql('SELECT w.uid,w.week FROM weekly_winners w JOIN weekly_settlements s ON s.environment=w.environment AND s.week=w.week AND s.rewards_enabled=1 LEFT JOIN weekly_awards a ON a.uid=w.uid AND a.environment=w.environment AND a.week=w.week WHERE w.environment=? AND a.uid IS NULL ORDER BY w.week LIMIT 12', environment).all<{ uid: string; week: number }>();
      for (const award of pending.results) await new D1CommerceWallet(this.env.DB).awardWeekly(award.uid, environment, award.week);
    }
    const expired = deadline - WEEK_MS * 8;
    await this.env.DB.batch([
      this.sql('DELETE FROM weekly_batches WHERE rowid IN (SELECT b.rowid FROM weekly_batches b JOIN weekly_runs r ON r.id=b.run_id WHERE r.week<? LIMIT 1000)', expired),
      this.sql('DELETE FROM weekly_runs WHERE id IN (SELECT r.id FROM weekly_runs r WHERE week<? AND NOT EXISTS(SELECT 1 FROM weekly_batches b WHERE b.run_id=r.id) LIMIT 100)', expired),
    ]);

  }
}
