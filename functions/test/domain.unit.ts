import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import {
  createDailyReplay,
  createDailyRun,
  getDailyChallengeForDate,
} from '../../src/game/daily';
import { getCampaignLevel } from '../../src/game/levels/levelLoader';
import { createLevelReplay } from '../../src/game/replay';
import {
  selectTrustedDailyBest,
  validateDailyRunSubmission,
} from '../src/domain';

function referenceRun(
  challengeDate: string,
  clientRunId: string,
  createdAt = `${challengeDate}T12:00:00.000Z`,
) {
  const challenge = getDailyChallengeForDate(challengeDate);
  const level = getCampaignLevel(challenge.levelId);
  const replay = createLevelReplay(level, level.referenceSolution);
  return createDailyRun(challenge, replay, { clientRunId, createdAt });
}

describe('Daily Scrap callable validation', () => {
  test('ignores claimed metrics and derives them from a successful replay', () => {
    const source = referenceRun('2026-08-27', 'daily-run-valid-0001');
    const result = validateDailyRunSubmission(
      {
        ...source,
        metrics: {
          threadUsed: 0,
          stitchesUsed: 0,
          completionMs: 0,
          collectedPatch: false,
        },
      },
      new Date('2026-08-27T20:00:00.000Z'),
    );

    assert.deepEqual(result.run.metrics, source.metrics);
    assert.notEqual(result.run.metrics.threadUsed, 0);
    assert.notEqual(result.run.metrics.completionMs, 0);
  });

  test('rejects a future challenge relative to server UTC time', () => {
    const future = referenceRun('2026-08-28', 'daily-run-future-0001');
    assert.throws(
      () =>
        validateDailyRunSubmission(
          future,
          new Date('2026-08-27T23:59:59.000Z'),
        ),
      /Future Daily Scrap challenges/,
    );
  });

  test('accepts one offline day of grace and rejects older submissions', () => {
    const yesterday = referenceRun(
      '2026-08-26',
      'daily-run-yesterday-0001',
    );
    const older = referenceRun('2026-08-25', 'daily-run-old-0001');
    const serverNow = new Date('2026-08-27T00:01:00.000Z');

    assert.equal(
      validateDailyRunSubmission(yesterday, serverNow).run.clientRunId,
      yesterday.clientRunId,
    );
    assert.throws(
      () => validateDailyRunSubmission(older, serverNow),
      /limited to today and yesterday/,
    );
  });

  test('rejects replays that do not finish successfully', () => {
    const challenge = getDailyChallengeForDate('2026-08-27');
    const level = getCampaignLevel(challenge.levelId);
    const levelReplay = createLevelReplay(level, []);
    const replay = createDailyReplay(challenge, levelReplay);

    assert.throws(
      () =>
        validateDailyRunSubmission(
          {
            clientRunId: 'daily-run-failed-0001',
            challengeId: challenge.id,
            challengeDate: challenge.challengeDate,
            replay,
            createdAt: '2026-08-27T12:00:00.000Z',
          },
          new Date('2026-08-27T20:00:00.000Z'),
        ),
      /Only successful Daily Scrap replays/,
    );
  });

  test('bounds replay-authored identifiers before persistence', () => {
    const challenge = getDailyChallengeForDate('2026-08-27');
    const level = getCampaignLevel(challenge.levelId);
    const stitches = level.referenceSolution.map((stitch, index) => ({
      ...stitch,
      id: `${index}-${'x'.repeat(81)}`,
    }));
    const run = createDailyRun(
      challenge,
      createLevelReplay(level, stitches),
      {
        clientRunId: 'daily-run-long-stitch-0001',
        createdAt: '2026-08-27T12:00:00.000Z',
      },
    );

    assert.throws(
      () =>
        validateDailyRunSubmission(
          run,
          new Date('2026-08-27T20:00:00.000Z'),
        ),
      /invalid stitch id/,
    );
  });

  test('keeps the incumbent on an exact leaderboard tie', () => {
    const incumbent = referenceRun('2026-08-27', 'daily-run-first-0001');
    const candidate = referenceRun('2026-08-27', 'daily-run-second-0001');

    assert.equal(
      selectTrustedDailyBest(candidate, incumbent).clientRunId,
      incumbent.clientRunId,
    );
  });
});
