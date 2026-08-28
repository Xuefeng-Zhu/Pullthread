import {
  FieldValue,
  Timestamp,
  type Firestore,
} from 'firebase-admin/firestore';

import {
  DAILY_SUBMISSION_MIN_INTERVAL_MS,
  parseDailyChallenge,
  parseDailyRun,
  type DailyChallenge,
  type DailyRun,
} from '../../src/game/daily';
import {
  dailyReplaysEqual,
  selectTrustedDailyBest,
} from './domain';

const DISPLAY_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,23}$/;
const FIREBASE_ANONYMOUS_UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export interface PersistBestDailyRunResult {
  readonly isNewBest: boolean;
  readonly personalBest: DailyRun;
}

export class ClientRunIdConflictError extends Error {
  constructor() {
    super('Daily client run id was reused with a different replay.');
    this.name = 'ClientRunIdConflictError';
  }
}

export class SubmissionRateLimitError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super('Daily Scrap submissions are arriving too quickly.');
    this.name = 'SubmissionRateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function fallbackDisplayName(uid: string): string {
  const suffix = uid.slice(-4).padStart(4, '0').toUpperCase();
  return `Quilter ${suffix}`;
}

function publicDisplayName(profileData: unknown, uid: string): string {
  if (
    typeof profileData === 'object' &&
    profileData !== null &&
    !Array.isArray(profileData) &&
    typeof (profileData as Record<string, unknown>).displayName === 'string'
  ) {
    const normalized = (
      (profileData as Record<string, unknown>).displayName as string
    )
      .trim()
      .replace(/\s+/g, ' ');
    if (DISPLAY_NAME_PATTERN.test(normalized)) return normalized;
  }

  return fallbackDisplayName(uid);
}

function assertCanonicalStoredChallenge(
  data: unknown,
  expected: DailyChallenge,
): void {
  const stored = parseDailyChallenge(data);
  if (stored.id !== expected.id) {
    throw new Error('Stored Daily Scrap challenge is not canonical.');
  }
}

function dailyRunsEqual(left: DailyRun, right: DailyRun): boolean {
  return (
    left.clientRunId === right.clientRunId &&
    left.createdAt === right.createdAt &&
    dailyReplaysEqual(left, right)
  );
}

/**
 * Stores exactly one best run for a Firebase Auth user and challenge. The
 * transaction keeps the incumbent on ties, so concurrent and idempotent
 * submissions cannot regress the leaderboard.
 */
export async function persistBestDailyRun(
  database: Firestore,
  uid: string,
  challenge: DailyChallenge,
  candidateInput: DailyRun,
  serverNow: Date = new Date(),
): Promise<PersistBestDailyRunResult> {
  if (!FIREBASE_ANONYMOUS_UID_PATTERN.test(uid)) {
    throw new TypeError('Firebase anonymous Auth uid is invalid.');
  }

  const candidate = parseDailyRun(candidateInput);
  if (candidate.challengeId !== challenge.id) {
    throw new RangeError('Daily run does not belong to the supplied challenge.');
  }

  const challengeRef = database.collection('daily_challenges').doc(challenge.id);
  const profileRef = database.collection('profiles').doc(uid);
  const runRef = challengeRef.collection('runs').doc(uid);
  const submissionGuardRef = database
    .collection('daily_submission_guards')
    .doc(uid);

  return database.runTransaction(async (transaction) => {
    // Firestore transactions require all reads to happen before any writes.
    const challengeSnapshot = await transaction.get(challengeRef);
    const profileSnapshot = await transaction.get(profileRef);
    const incumbentSnapshot = await transaction.get(runRef);
    const submissionGuardSnapshot = await transaction.get(submissionGuardRef);

    if (challengeSnapshot.exists) {
      assertCanonicalStoredChallenge(challengeSnapshot.data(), challenge);
    }

    const incumbent = incumbentSnapshot.exists
      ? parseDailyRun(incumbentSnapshot.data())
      : null;

    let lastAcceptedRun: DailyRun | null = null;
    try {
      const storedLastRun = submissionGuardSnapshot.get('lastRun');
      if (storedLastRun !== undefined) {
        lastAcceptedRun = parseDailyRun(storedLastRun);
      }
    } catch {
      // A legacy or malformed private guard must never become authority. It
      // simply loses the retry exemption and follows the normal throttle path.
    }
    const lastResultIsNewBest = submissionGuardSnapshot.get(
      'lastResultIsNewBest',
    );
    if (
      lastAcceptedRun?.clientRunId === candidate.clientRunId &&
      !dailyRunsEqual(lastAcceptedRun, candidate)
    ) {
      throw new ClientRunIdConflictError();
    }
    if (
      incumbent &&
      typeof lastResultIsNewBest === 'boolean' &&
      lastAcceptedRun &&
      dailyRunsEqual(lastAcceptedRun, candidate) &&
      (!lastResultIsNewBest ||
        incumbent.clientRunId === candidate.clientRunId)
    ) {
      // Reproduce the committed callable result without another write. This
      // covers new-best, tied, and worse attempts whose response was lost.
      return Object.freeze({
        isNewBest: lastResultIsNewBest,
        personalBest: incumbent,
      });
    }

    if (incumbent?.clientRunId === candidate.clientRunId) {
      if (!dailyRunsEqual(incumbent, candidate)) {
        throw new ClientRunIdConflictError();
      }

      // Backward compatibility for a best written before guards retained the
      // request fingerprint. It is still safe to exempt because the public run
      // document belongs to this authenticated uid and matches exactly.
      return Object.freeze({ isNewBest: false, personalBest: incumbent });
    }

    const lastSubmissionAt = submissionGuardSnapshot.get('lastSubmissionAt');
    if (lastSubmissionAt instanceof Timestamp) {
      const elapsedMs = Math.max(
        0,
        serverNow.getTime() - lastSubmissionAt.toMillis(),
      );
      if (elapsedMs < DAILY_SUBMISSION_MIN_INTERVAL_MS) {
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil(
            (DAILY_SUBMISSION_MIN_INTERVAL_MS - elapsedMs) / 1_000,
          ),
        );
        throw new SubmissionRateLimitError(retryAfterSeconds);
      }
    }

    const displayName = publicDisplayName(profileSnapshot.data(), uid);

    const personalBest = selectTrustedDailyBest(candidate, incumbent);
    const isNewBest =
      incumbent === null || personalBest.clientRunId !== incumbent.clientRunId;
    const now = FieldValue.serverTimestamp();

    transaction.set(submissionGuardRef, {
      lastSubmissionAt: Timestamp.fromDate(serverNow),
      lastRun: candidate,
      lastResultIsNewBest: isNewBest,
      updatedAt: now,
    });

    if (!challengeSnapshot.exists) {
      transaction.set(challengeRef, {
        ...challenge,
        createdAt: now,
        updatedAt: now,
      });
    }

    if (!profileSnapshot.exists) {
      transaction.set(profileRef, {
        displayName,
        createdAt: now,
        updatedAt: now,
      });
    }

    if (isNewBest) {
      transaction.set(runRef, {
        ...personalBest,
        userId: uid,
        displayName,
        recordedAt: now,
        updatedAt: now,
      });
    } else if (incumbentSnapshot.get('displayName') !== displayName) {
      transaction.update(runRef, { displayName, updatedAt: now });
    }

    return Object.freeze({ isNewBest, personalBest });
  });
}
