import type { RunMetrics } from '../core/scoring';
import { calculateThreadUsed } from '../core/scoring';
import { getCampaignLevel } from '../levels/levelLoader';
import {
  parseLevelReplay,
  simulateLevelReplay,
  type LevelReplayV1,
} from '../replay';

export const DAILY_CHALLENGE_SCHEMA_VERSION = 1 as const;
export const DAILY_REPLAY_SCHEMA_VERSION = 1 as const;
export const DAILY_POOL_EFFECTIVE_FROM = '2026-01-01';
export const DAILY_SUBMISSION_MIN_INTERVAL_MS = 5_000;

export interface DailyChallengeTemplate {
  readonly id: string;
  readonly version: number;
  readonly levelId: string;
  readonly levelVersion: number;
  readonly title: string;
  readonly description: string;
}

export interface DailyChallenge {
  readonly schemaVersion: typeof DAILY_CHALLENGE_SCHEMA_VERSION;
  readonly id: string;
  /** UTC calendar date in YYYY-MM-DD form. */
  readonly challengeDate: string;
  readonly seed: number;
  readonly poolVersion: number;
  readonly templateId: string;
  readonly templateVersion: number;
  readonly levelId: string;
  readonly levelVersion: number;
  readonly title: string;
  readonly description: string;
}

export interface DailyReplayV1 {
  readonly schemaVersion: typeof DAILY_REPLAY_SCHEMA_VERSION;
  readonly challengeId: string;
  readonly challengeDate: string;
  readonly simulationSeed: number;
  readonly levelReplay: LevelReplayV1;
}

export interface DailyRun {
  readonly clientRunId: string;
  readonly challengeId: string;
  readonly challengeDate: string;
  readonly metrics: RunMetrics;
  readonly replay: DailyReplayV1;
  readonly createdAt: string;
}

export interface DailyLeaderboardEntry {
  readonly id: string;
  readonly rank: number;
  readonly displayName: string;
  readonly metrics: RunMetrics;
  readonly replay: DailyReplayV1 | null;
  readonly isCurrentPlayer: boolean;
}

const DAILY_CHALLENGE_TEMPLATES_V1: readonly DailyChallengeTemplate[] =
  Object.freeze([
    Object.freeze({
      id: 'first-pull-sampler',
      version: 1,
      levelId: 'bedroom-01-first-pull',
      levelVersion: 1,
      title: 'First Pull Sampler',
      description: 'Find the cleanest ridge through a familiar square.',
    }),
    Object.freeze({
      id: 'edge-offcut',
      version: 1,
      levelId: 'bedroom-02-edge-redirect',
      levelVersion: 1,
      title: 'Edge Offcut',
      description: 'Turn the traveler before the cloth runs out.',
    }),
    Object.freeze({
      id: 'felt-swatch',
      version: 1,
      levelId: 'bedroom-03-felt-landing',
      levelVersion: 1,
      title: 'Felt Swatch',
      description: 'Use the quiet felt to settle the final approach.',
    }),
    Object.freeze({
      id: 'mended-hole',
      version: 1,
      levelId: 'bedroom-04-hole-crossing',
      levelVersion: 1,
      title: 'Mended Hole',
      description: 'Shape a safe route around the worn opening.',
    }),
    Object.freeze({
      id: 'short-thread',
      version: 1,
      levelId: 'bedroom-05-thread-budget',
      levelVersion: 1,
      title: 'Short Thread',
      description: 'Spend as little thread as the pattern allows.',
    }),
    Object.freeze({
      id: 'silk-ribbon',
      version: 1,
      levelId: 'attic-06-silk-slide',
      levelVersion: 1,
      title: 'Silk Ribbon',
      description: 'Guide a quicker glide across the silk panel.',
    }),
  ]);

export interface DailyChallengePool {
  readonly version: number;
  readonly effectiveFrom: string;
  readonly templates: readonly DailyChallengeTemplate[];
}

/**
 * Append-only pool registry. Adding variety means appending a new dated pool;
 * never edit an existing pool or historical challenge identities will drift.
 */
export const DAILY_CHALLENGE_POOLS: readonly DailyChallengePool[] =
  Object.freeze([
    Object.freeze({
      version: 1,
      effectiveFrom: DAILY_POOL_EFFECTIVE_FROM,
      templates: DAILY_CHALLENGE_TEMPLATES_V1,
    }),
  ]);

export const DAILY_POOL_VERSION = DAILY_CHALLENGE_POOLS.at(-1)?.version ?? 1;
export const DAILY_CHALLENGE_TEMPLATES = DAILY_CHALLENGE_TEMPLATES_V1;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CLIENT_RUN_ID_PATTERN = /^[a-z0-9:._-]{8,160}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertSafeUnsignedInteger(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer.`);
  }
}

export function parseChallengeDate(value: unknown): string {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    throw new TypeError('Daily challenge date must use UTC YYYY-MM-DD format.');
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new RangeError('Daily challenge date must be a real UTC calendar date.');
  }
  if (value < DAILY_POOL_EFFECTIVE_FROM) {
    throw new RangeError('Daily challenge date predates the supported template pool.');
  }

  return value;
}

export function utcChallengeDate(date: Date): string {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new TypeError('Daily challenge clock must return a valid date.');
  }
  return date.toISOString().slice(0, 10);
}

/** Stable unsigned FNV-1a hash. The input is deliberately ASCII-only. */
export function dailySeedForDate(challengeDate: string): number {
  const normalizedDate = parseChallengeDate(challengeDate);
  const pool = getDailyChallengePool(normalizedDate);
  const input = `pullthread-daily:p${pool.version}:${normalizedDate}`;
  let hash = 0x811c9dc5;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash;
}

export function getDailyChallengePool(challengeDate: string): DailyChallengePool {
  const normalizedDate = parseChallengeDate(challengeDate);
  const pool = [...DAILY_CHALLENGE_POOLS]
    .reverse()
    .find((candidate) => candidate.effectiveFrom <= normalizedDate);
  if (!pool) throw new RangeError('No Daily Scrap template pool covers this date.');
  return pool;
}

export function getDailyChallengeForDate(challengeDate: string): DailyChallenge {
  const normalizedDate = parseChallengeDate(challengeDate);
  const pool = getDailyChallengePool(normalizedDate);
  const seed = dailySeedForDate(normalizedDate);
  const template = pool.templates[seed % pool.templates.length];
  const level = getCampaignLevel(template.levelId);
  if (level.version !== template.levelVersion) {
    throw new RangeError(
      `Daily Scrap template "${template.id}" requires level version ${template.levelVersion}.`,
    );
  }

  return Object.freeze({
    schemaVersion: DAILY_CHALLENGE_SCHEMA_VERSION,
    id: `daily-${normalizedDate}-p${pool.version}-${template.id}-v${template.version}-l${level.version}`,
    challengeDate: normalizedDate,
    seed,
    poolVersion: pool.version,
    templateId: template.id,
    templateVersion: template.version,
    levelId: level.id,
    levelVersion: level.version,
    title: template.title,
    description: template.description,
  });
}

export function getTodayDailyChallenge(clock: () => Date = () => new Date()): DailyChallenge {
  return getDailyChallengeForDate(utcChallengeDate(clock()));
}

/** Treats a remote or persisted descriptor as untrusted canonical input. */
export function parseDailyChallenge(value: unknown): DailyChallenge {
  if (!isRecord(value)) throw new TypeError('Daily challenge must be an object.');
  const date = parseChallengeDate(value.challengeDate);
  const canonical = getDailyChallengeForDate(date);

  for (const key of [
    'schemaVersion',
    'id',
    'seed',
    'poolVersion',
    'templateId',
    'templateVersion',
    'levelId',
    'levelVersion',
  ] as const) {
    if (value[key] !== canonical[key]) {
      throw new RangeError(`Daily challenge ${key} does not match the canonical day.`);
    }
  }

  return canonical;
}

export function createDailyReplay(
  challenge: DailyChallenge,
  levelReplay: LevelReplayV1,
): DailyReplayV1 {
  const canonicalChallenge = parseDailyChallenge(challenge);
  const replay = parseLevelReplay(levelReplay);
  if (
    replay.levelId !== canonicalChallenge.levelId ||
    replay.levelVersion !== canonicalChallenge.levelVersion
  ) {
    throw new RangeError('Daily replay does not match its challenge template.');
  }

  return Object.freeze({
    schemaVersion: DAILY_REPLAY_SCHEMA_VERSION,
    challengeId: canonicalChallenge.id,
    challengeDate: canonicalChallenge.challengeDate,
    simulationSeed: canonicalChallenge.seed,
    levelReplay: replay,
  });
}

export function parseDailyReplay(
  value: unknown,
  expectedChallenge?: DailyChallenge,
): DailyReplayV1 {
  if (!isRecord(value)) throw new TypeError('Daily replay must be an object.');
  if (value.schemaVersion !== DAILY_REPLAY_SCHEMA_VERSION) {
    throw new RangeError('Daily replay schema version is not supported.');
  }
  const challenge = expectedChallenge
    ? parseDailyChallenge(expectedChallenge)
    : getDailyChallengeForDate(parseChallengeDate(value.challengeDate));
  if (
    value.challengeDate !== challenge.challengeDate ||
    value.challengeId !== challenge.id ||
    value.simulationSeed !== challenge.seed
  ) {
    throw new RangeError('Daily replay does not match its challenge seed.');
  }

  return createDailyReplay(challenge, parseLevelReplay(value.levelReplay));
}

export function deriveDailyRunMetrics(
  challenge: DailyChallenge,
  replay: DailyReplayV1,
): RunMetrics {
  const validatedReplay = parseDailyReplay(replay, challenge);
  const result = simulateLevelReplay(validatedReplay.levelReplay);
  if (result.outcome.status !== 'success') {
    throw new RangeError('Only successful Daily Scrap replays can be submitted.');
  }
  const level = getCampaignLevel(validatedReplay.levelReplay.levelId);

  return Object.freeze({
    threadUsed: calculateThreadUsed(validatedReplay.levelReplay.stitches),
    stitchesUsed: validatedReplay.levelReplay.stitches.length,
    completionMs: result.outcome.completionMs,
    collectedPatch:
      Boolean(level.collectible) &&
      result.outcome.collectedPatchId === level.collectible?.id,
  });
}

export function compareDailyMetrics(left: RunMetrics, right: RunMetrics): number {
  return (
    left.threadUsed - right.threadUsed ||
    left.stitchesUsed - right.stitchesUsed ||
    left.completionMs - right.completionMs
  );
}

export function selectDailyBest(
  candidate: DailyRun,
  incumbent: DailyRun | null,
): DailyRun {
  return !incumbent || compareDailyMetrics(candidate.metrics, incumbent.metrics) < 0
    ? candidate
    : incumbent;
}

export function createDailyRun(
  challenge: DailyChallenge,
  levelReplay: LevelReplayV1,
  options: { readonly clientRunId: string; readonly createdAt: string },
): DailyRun {
  const canonicalChallenge = parseDailyChallenge(challenge);
  if (!CLIENT_RUN_ID_PATTERN.test(options.clientRunId)) {
    throw new TypeError('Daily client run id is invalid.');
  }
  const createdAtDate = new Date(options.createdAt);
  if (!Number.isFinite(createdAtDate.getTime()) || createdAtDate.toISOString() !== options.createdAt) {
    throw new TypeError('Daily run creation time must be a canonical ISO timestamp.');
  }
  const replay = createDailyReplay(canonicalChallenge, levelReplay);

  return Object.freeze({
    clientRunId: options.clientRunId,
    challengeId: canonicalChallenge.id,
    challengeDate: canonicalChallenge.challengeDate,
    metrics: deriveDailyRunMetrics(canonicalChallenge, replay),
    replay,
    createdAt: options.createdAt,
  });
}

export function parseDailyRun(value: unknown): DailyRun {
  if (!isRecord(value)) throw new TypeError('Daily run must be an object.');
  const challengeDate = parseChallengeDate(value.challengeDate);
  const challenge = getDailyChallengeForDate(challengeDate);
  if (value.challengeId !== challenge.id || typeof value.clientRunId !== 'string') {
    throw new RangeError('Daily run does not match its canonical challenge.');
  }
  if (typeof value.createdAt !== 'string') {
    throw new TypeError('Daily run creation time must be a string.');
  }

  const recreated = createDailyRun(
    challenge,
    parseDailyReplay(value.replay, challenge).levelReplay,
    { clientRunId: value.clientRunId, createdAt: value.createdAt },
  );
  if (!isRecord(value.metrics)) throw new TypeError('Daily run metrics must be an object.');
  const supplied = value.metrics;
  assertSafeUnsignedInteger(supplied.threadUsed, 'Daily thread used');
  assertSafeUnsignedInteger(supplied.stitchesUsed, 'Daily stitches used');
  assertSafeUnsignedInteger(supplied.completionMs, 'Daily completion time');
  if (typeof supplied.collectedPatch !== 'boolean') {
    throw new TypeError('Daily patch state must be a boolean.');
  }
  if (
    supplied.threadUsed !== recreated.metrics.threadUsed ||
    supplied.stitchesUsed !== recreated.metrics.stitchesUsed ||
    supplied.completionMs !== recreated.metrics.completionMs ||
    supplied.collectedPatch !== recreated.metrics.collectedPatch
  ) {
    throw new RangeError('Daily run metrics do not match its deterministic replay.');
  }

  return recreated;
}

let clientRunSequence = 0;

export function createDailyClientRunId(
  challenge: DailyChallenge,
  now: Date = new Date(),
): string {
  const canonical = parseDailyChallenge(challenge);
  if (!Number.isFinite(now.getTime())) throw new TypeError('Daily run clock is invalid.');
  clientRunSequence = (clientRunSequence + 1) % 1_000_000;
  const entropy = Math.floor(Math.random() * 0x1000000)
    .toString(36)
    .padStart(5, '0');
  return `${canonical.id}:${now.getTime().toString(36)}:${clientRunSequence.toString(36)}:${entropy}`;
}
