import { strict as assert } from 'node:assert';
import { after, describe, test } from 'node:test';

import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

import {
  createDailyRun,
  getDailyChallengeForDate,
  parseDailyChallenge,
} from '../../src/game/daily';
import { getCampaignLevel } from '../../src/game/levels/levelLoader';
import { createLevelReplay } from '../../src/game/replay';
import {
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
  const level = getCampaignLevel(challenge.levelId);
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
      '2026-08-27T12:00:00.000Z',
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
