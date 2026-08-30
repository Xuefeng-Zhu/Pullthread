import { strict as assert } from 'node:assert';
import { after, describe, test } from 'node:test';

import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

import {
  createDailyRun,
  getDailyChallengeForDate,
  parseDailyChallenge,
} from '../../src/game/daily';
import { getLevelVersion } from '../../src/game/levels/levelLoader';
import { createLevelReplay } from '../../src/game/replay';
import {
  ClientRunIdConflictError,
  persistBestDailyRun,
  SubmissionRateLimitError,
} from '../src/persistence';

const PROJECT_ID = 'pullthread-rules-test';
const USER_ID = 'persistenceAnonymous123';
const app = initializeApp({ projectId: PROJECT_ID }, 'persistence-test');
const database = getFirestore(app);

after(async () => {
  await deleteApp(app);
});

function referenceRun(clientRunId: string, createdAt: string) {
  const challenge = getDailyChallengeForDate('2026-08-27');
  const level = getLevelVersion(challenge.levelId, challenge.levelVersion);
  return {
    challenge,
    run: createDailyRun(
      challenge,
      createLevelReplay(level, level.referenceSolution),
      { clientRunId, createdAt },
    ),
  };
}

describe('Daily Scrap best-run transaction', () => {
  test('stores one server-validated best per user and keeps ties stable', async () => {
    const first = referenceRun(
      'daily-run-persisted-first',
      '1970-01-01T00:00:00.000Z',
    );
    const tied = referenceRun(
      'daily-run-persisted-tie',
      '2026-08-27T12:05:00.000Z',
    );

    const firstResult = await persistBestDailyRun(
      database,
      USER_ID,
      first.challenge,
      first.run,
      new Date('2026-08-27T12:00:00.000Z'),
    );
    const tiedResult = await persistBestDailyRun(
      database,
      USER_ID,
      tied.challenge,
      tied.run,
      new Date('2026-08-27T12:05:00.000Z'),
    );

    assert.equal(firstResult.isNewBest, true);
    assert.equal(tiedResult.isNewBest, false);
    assert.equal(tiedResult.personalBest.clientRunId, first.run.clientRunId);

    const challengeRef = database
      .collection('daily_challenges')
      .doc(first.challenge.id);
    const challengeSnapshot = await challengeRef.get();
    assert.equal(challengeSnapshot.exists, true);
    assert.equal(
      parseDailyChallenge(challengeSnapshot.data()).id,
      first.challenge.id,
    );

    const runSnapshots = await challengeRef.collection('runs').get();
    assert.equal(runSnapshots.size, 1);
    assert.equal(runSnapshots.docs[0].id, USER_ID);
    assert.equal(runSnapshots.docs[0].get('userId'), USER_ID);
    assert.equal(
      runSnapshots.docs[0].get('clientRunId'),
      first.run.clientRunId,
    );
    assert.equal(
      runSnapshots.docs[0].get('createdAt'),
      first.run.createdAt,
    );
    const recordedAt = runSnapshots.docs[0].get('recordedAt');
    assert.ok(recordedAt instanceof Timestamp);
    assert.notEqual(recordedAt.toDate().toISOString(), first.run.createdAt);

    const profileSnapshot = await database
      .collection('profiles')
      .doc(USER_ID)
      .get();
    assert.equal(profileSnapshot.exists, true);
    assert.match(profileSnapshot.get('displayName'), /^Quilter [A-Z0-9]{4}$/);
  });

  test('rate-limits repeated submissions for the same guest', async () => {
    const first = referenceRun(
      'daily-run-rate-first',
      '2026-08-27T14:00:00.000Z',
    );
    const second = referenceRun(
      'daily-run-rate-second',
      '2026-08-27T14:00:01.000Z',
    );
    const rateLimitedUser = 'persistenceRateLimited789';

    await persistBestDailyRun(
      database,
      rateLimitedUser,
      first.challenge,
      first.run,
      new Date('2026-08-27T14:00:00.000Z'),
    );

    await assert.rejects(
      persistBestDailyRun(
        database,
        rateLimitedUser,
        second.challenge,
        second.run,
        new Date('2026-08-27T14:00:01.000Z'),
      ),
      (error: unknown) =>
        error instanceof SubmissionRateLimitError &&
        error.retryAfterSeconds === 4,
    );
  });

  test('accepts an exact committed retry inside the throttle window', async () => {
    const first = referenceRun(
      'daily-run-idempotent-retry',
      '2026-08-27T15:00:00.000Z',
    );
    const second = referenceRun(
      'daily-run-after-idempotent-retry',
      '2026-08-27T15:00:01.000Z',
    );
    const retryUser = 'persistenceIdempotentRetry123';
    const firstServerNow = new Date('2026-08-27T15:00:00.000Z');
    const retryServerNow = new Date('2026-08-27T15:00:01.000Z');

    await persistBestDailyRun(
      database,
      retryUser,
      first.challenge,
      first.run,
      firstServerNow,
    );
    const guardRef = database.collection('daily_submission_guards').doc(retryUser);
    const originalGuard = (await guardRef.get()).get('lastSubmissionAt');
    assert.ok(originalGuard instanceof Timestamp);

    const retryResult = await persistBestDailyRun(
      database,
      retryUser,
      first.challenge,
      first.run,
      retryServerNow,
    );

    assert.equal(retryResult.isNewBest, true);
    assert.equal(retryResult.personalBest.clientRunId, first.run.clientRunId);
    const unchangedGuard = (await guardRef.get()).get('lastSubmissionAt');
    assert.ok(unchangedGuard instanceof Timestamp);
    assert.equal(unchangedGuard.toMillis(), originalGuard.toMillis());
    await assert.rejects(
      persistBestDailyRun(
        database,
        retryUser,
        second.challenge,
        second.run,
        retryServerNow,
      ),
      (error: unknown) =>
        error instanceof SubmissionRateLimitError &&
        error.retryAfterSeconds === 4,
    );
  });

  test('accepts an exact tied retry that did not replace the public best', async () => {
    const first = referenceRun(
      'daily-run-before-tied-retry',
      '2026-08-27T17:00:00.000Z',
    );
    const tied = referenceRun(
      'daily-run-idempotent-tie',
      '2026-08-27T17:00:05.000Z',
    );
    const after = referenceRun(
      'daily-run-after-idempotent-tie',
      '2026-08-27T17:00:06.000Z',
    );
    const retryUser = 'persistenceIdempotentTie789';

    await persistBestDailyRun(
      database,
      retryUser,
      first.challenge,
      first.run,
      new Date('2026-08-27T17:00:00.000Z'),
    );
    const tiedResult = await persistBestDailyRun(
      database,
      retryUser,
      tied.challenge,
      tied.run,
      new Date('2026-08-27T17:00:05.000Z'),
    );
    assert.equal(tiedResult.isNewBest, false);
    assert.equal(tiedResult.personalBest.clientRunId, first.run.clientRunId);
    const guardRef = database.collection('daily_submission_guards').doc(retryUser);
    const committedGuard = (await guardRef.get()).get('lastSubmissionAt');
    assert.ok(committedGuard instanceof Timestamp);

    const retryResult = await persistBestDailyRun(
      database,
      retryUser,
      tied.challenge,
      tied.run,
      new Date('2026-08-27T17:00:06.000Z'),
    );

    assert.equal(retryResult.isNewBest, false);
    assert.equal(retryResult.personalBest.clientRunId, first.run.clientRunId);
    const unchangedGuard = (await guardRef.get()).get('lastSubmissionAt');
    assert.ok(unchangedGuard instanceof Timestamp);
    assert.equal(unchangedGuard.toMillis(), committedGuard.toMillis());
    await assert.rejects(
      persistBestDailyRun(
        database,
        retryUser,
        after.challenge,
        after.run,
        new Date('2026-08-27T17:00:06.000Z'),
      ),
      (error: unknown) =>
        error instanceof SubmissionRateLimitError &&
        error.retryAfterSeconds === 4,
    );
  });

  test('does not exempt a reused run id with a changed timestamp', async () => {
    const first = referenceRun(
      'daily-run-conflicting-retry',
      '2026-08-27T16:00:00.000Z',
    );
    const changedTimestamp = referenceRun(
      first.run.clientRunId,
      '2026-08-27T16:00:01.000Z',
    );
    const conflictUser = 'persistenceConflictingRetry456';

    await persistBestDailyRun(
      database,
      conflictUser,
      first.challenge,
      first.run,
      new Date('2026-08-27T16:00:00.000Z'),
    );

    await assert.rejects(
      persistBestDailyRun(
        database,
        conflictUser,
        changedTimestamp.challenge,
        changedTimestamp.run,
        new Date('2026-08-27T16:00:01.000Z'),
      ),
      ClientRunIdConflictError,
    );
  });

  test('rejects reuse of a tied run id after the throttle expires', async () => {
    const first = referenceRun(
      'daily-run-before-tied-conflict',
      '2026-08-27T18:00:00.000Z',
    );
    const tied = referenceRun(
      'daily-run-tied-conflict',
      '2026-08-27T18:00:05.000Z',
    );
    const reused = referenceRun(
      tied.run.clientRunId,
      '2026-08-27T18:00:06.000Z',
    );
    const conflictUser = 'persistenceTiedConflict012';

    await persistBestDailyRun(
      database,
      conflictUser,
      first.challenge,
      first.run,
      new Date('2026-08-27T18:00:00.000Z'),
    );
    await persistBestDailyRun(
      database,
      conflictUser,
      tied.challenge,
      tied.run,
      new Date('2026-08-27T18:00:05.000Z'),
    );

    await assert.rejects(
      persistBestDailyRun(
        database,
        conflictUser,
        reused.challenge,
        reused.run,
        new Date('2026-08-27T18:00:10.000Z'),
      ),
      ClientRunIdConflictError,
    );
  });

  test('defensively rejects forged metric tuples before writing', async () => {
    const source = referenceRun(
      'daily-run-forged-metrics',
      '2026-08-27T13:00:00.000Z',
    );

    await assert.rejects(
      persistBestDailyRun(
        database,
        'persistenceAnonymous456',
        source.challenge,
        {
          ...source.run,
          metrics: { ...source.run.metrics, threadUsed: 0 },
        },
      ),
      /metrics do not match its deterministic replay/,
    );
  });
});
