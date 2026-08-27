import { beforeEach, describe, expect, test } from '@jest/globals';

import {
  createDailyRun,
  getDailyChallengeForDate,
} from '../../../game/daily';
import { getCampaignLevel } from '../../../game/levels/levelLoader';
import { createLevelReplay } from '../../../game/replay';
import {
  DAILY_SCRAP_STORAGE_KEY,
  LocalDailyChallengeService,
  type DailyKeyValueStorage,
} from '../LocalDailyChallengeService';

class MemoryStorage implements DailyKeyValueStorage {
  readonly values = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
}

function referenceRun(clientRunId: string, createdAt: string) {
  const challenge = getDailyChallengeForDate('2026-08-27');
  const level = getCampaignLevel(challenge.levelId);
  return createDailyRun(
    challenge,
    createLevelReplay(level, level.referenceSolution),
    { clientRunId, createdAt },
  );
}

describe('LocalDailyChallengeService', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  test('loads the deterministic day without requiring storage or a network', async () => {
    const service = new LocalDailyChallengeService(
      storage,
      () => new Date('2026-08-27T23:59:00.000Z'),
    );

    await expect(service.getTodayChallenge()).resolves.toMatchObject({
      challengeDate: '2026-08-27',
      templateId: 'first-pull-sampler',
    });
    expect(storage.values.size).toBe(0);
  });

  test('persists one personal best while allowing unlimited tied attempts', async () => {
    const service = new LocalDailyChallengeService(storage);
    const first = referenceRun('daily-run-0001', '2026-08-27T12:00:00.000Z');
    const tie = referenceRun('daily-run-0002', '2026-08-27T12:01:00.000Z');

    await expect(service.submitRun(first)).resolves.toMatchObject({
      isNewBest: true,
      personalBest: { clientRunId: first.clientRunId },
      syncStatus: 'local',
    });
    await expect(service.submitRun(tie)).resolves.toMatchObject({
      isNewBest: false,
      personalBest: { clientRunId: first.clientRunId },
    });
    await expect(service.attemptsForChallenge(first.challengeId)).resolves.toBe(2);

    const reloaded = new LocalDailyChallengeService(storage);
    await expect(reloaded.getLeaderboard(first.challengeId)).resolves.toEqual([
      expect.objectContaining({
        rank: 1,
        id: first.clientRunId,
        isCurrentPlayer: true,
        metrics: first.metrics,
      }),
    ]);
  });

  test('keeps a synced best out of the queue after tied attempts', async () => {
    const service = new LocalDailyChallengeService(storage);
    const first = referenceRun('daily-run-sync-1', '2026-08-27T12:00:00.000Z');
    const tie = referenceRun('daily-run-sync-2', '2026-08-27T12:01:00.000Z');

    await service.submitRun(first);
    await service.markRunSynced(first);
    await service.submitRun(tie);

    await expect(service.getPendingRuns()).resolves.toEqual([]);
  });

  test('handles idempotent resubmission and rejects a reused run id', async () => {
    const service = new LocalDailyChallengeService(storage);
    const first = referenceRun('daily-run-idempotent', '2026-08-27T12:00:00.000Z');
    const reused = referenceRun('daily-run-idempotent', '2026-08-27T12:01:00.000Z');

    await service.submitRun(first);
    await expect(service.submitRun(first)).resolves.toMatchObject({
      isNewBest: false,
    });
    await expect(service.submitRun(reused)).rejects.toThrow(
      'reused with different replay data',
    );
  });

  test('isolates malformed saved days and keeps valid local results', async () => {
    const valid = referenceRun('daily-run-valid', '2026-08-27T12:00:00.000Z');
    storage.values.set(
      DAILY_SCRAP_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        profile: { id: 'local-valid-guest', displayName: 'Quilter 2048' },
        remoteGuest: null,
        bestRunsByChallenge: {
          [valid.challengeId]: valid,
          'daily-broken': { challengeId: 'daily-broken' },
        },
        pendingRunsByChallenge: {},
        attemptsByChallenge: { [valid.challengeId]: 3, bad: -1 },
      }),
    );
    const service = new LocalDailyChallengeService(storage);

    const entries = await service.getLeaderboard(valid.challengeId);
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe(valid.clientRunId);
    await expect(service.attemptsForChallenge(valid.challengeId)).resolves.toBe(3);
  });

  test('keeps a run in memory but reports a volatile result when writes throw', async () => {
    const failingStorage: DailyKeyValueStorage = {
      getItem: async () => {
        throw new Error('storage unavailable');
      },
      setItem: async () => {
        throw new Error('storage unavailable');
      },
    };
    const service = new LocalDailyChallengeService(failingStorage);
    const run = referenceRun('daily-run-soft', '2026-08-27T12:00:00.000Z');

    await expect(service.submitRun(run)).resolves.toMatchObject({
      accepted: false,
      syncStatus: 'volatile',
      message: 'Kept for this session only. Device storage is unavailable.',
    });
    await expect(service.getLeaderboard(run.challengeId)).resolves.toHaveLength(1);

    const reloaded = new LocalDailyChallengeService(failingStorage);
    await expect(reloaded.getLeaderboard(run.challengeId)).resolves.toEqual([]);
  });
});
