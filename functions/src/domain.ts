import {
  createDailyRun,
  getDailyChallengeForDate,
  parseDailyReplay,
  selectDailyBest,
  utcChallengeDate,
  type DailyChallenge,
  type DailyRun,
} from '../../src/game/daily';

const MAX_SUBMISSION_BYTES = 64 * 1024;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const STITCH_ID_PATTERN = /^[a-z0-9:._-]{1,80}$/i;

type UnknownRecord = Record<string, unknown>;

export interface ValidatedDailySubmission {
  readonly challenge: DailyChallenge;
  readonly run: DailyRun;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertBoundedJson(value: unknown): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new TypeError('Daily run submission must be JSON serializable.');
  }

  if (Buffer.byteLength(serialized, 'utf8') > MAX_SUBMISSION_BYTES) {
    throw new RangeError('Daily run submission is too large.');
  }
}

/**
 * Validates the untrusted callable payload and re-simulates its compact replay.
 * Client-supplied metrics are deliberately ignored; createDailyRun derives a
 * fresh metric tuple from the canonical catalog and fixed-step simulation.
 */
export function validateDailyRunSubmission(
  payload: unknown,
  serverNow: Date = new Date(),
): ValidatedDailySubmission {
  assertBoundedJson(payload);
  if (!isRecord(payload)) {
    throw new TypeError('Daily run submission must be an object.');
  }

  const rawRun = payload;
  if (
    typeof rawRun.challengeDate !== 'string' ||
    typeof rawRun.challengeId !== 'string' ||
    typeof rawRun.clientRunId !== 'string' ||
    typeof rawRun.createdAt !== 'string'
  ) {
    throw new TypeError('Daily run submission is missing required fields.');
  }

  const today = utcChallengeDate(serverNow);
  if (rawRun.challengeDate > today) {
    throw new RangeError('Future Daily Scrap challenges cannot be submitted.');
  }

  // Keep a one-day offline grace period without allowing arbitrary historical
  // re-simulation requests against the public callable.
  const oldestAcceptedDate = utcChallengeDate(
    new Date(serverNow.getTime() - ONE_DAY_MS),
  );
  if (rawRun.challengeDate < oldestAcceptedDate) {
    throw new RangeError(
      'Daily Scrap submissions are limited to today and yesterday.',
    );
  }

  const challenge = getDailyChallengeForDate(rawRun.challengeDate);
  if (rawRun.challengeId !== challenge.id) {
    throw new RangeError('Daily run challenge id is not canonical.');
  }

  const replay = parseDailyReplay(rawRun.replay, challenge);
  for (const stitch of replay.levelReplay.stitches) {
    if (!STITCH_ID_PATTERN.test(stitch.id)) {
      throw new RangeError('Daily replay contains an invalid stitch id.');
    }
  }

  const run = createDailyRun(challenge, replay.levelReplay, {
    clientRunId: rawRun.clientRunId,
    createdAt: rawRun.createdAt,
  });

  return Object.freeze({ challenge, run });
}

/** Keeps the incumbent on an exact tie, including idempotent retries. */
export function selectTrustedDailyBest(
  candidate: DailyRun,
  incumbent: DailyRun | null,
): DailyRun {
  return selectDailyBest(candidate, incumbent);
}

export function dailyReplaysEqual(left: DailyRun, right: DailyRun): boolean {
  return JSON.stringify(left.replay) === JSON.stringify(right.replay);
}
