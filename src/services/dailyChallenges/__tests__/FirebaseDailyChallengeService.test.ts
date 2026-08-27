import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import { createDailyRun, getDailyChallengeForDate } from '../../../game/daily';
import { getCampaignLevel } from '../../../game/levels/levelLoader';
import { createLevelReplay } from '../../../game/replay';
import {
  FirebaseDailyChallengeService,
  type FirebaseDailyRemoteGateway,
  resetFirebaseDailyClientsForTests,
} from '../FirebaseDailyChallengeService';
import {
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

class FailingWriteStorage implements DailyKeyValueStorage {
  async getItem(): Promise<string | null> {
    return null;
  }

  async setItem(): Promise<void> {
    throw new Error('storage unavailable');
  }
}

class FakeRemote implements FirebaseDailyRemoteGateway {
  readonly submitRun = jest.fn<FirebaseDailyRemoteGateway['submitRun']>();
  readonly ensureGuest = jest.fn<FirebaseDailyRemoteGateway['ensureGuest']>();
  readonly checkChallenge = jest.fn<FirebaseDailyRemoteGateway['checkChallenge']>();
  readonly getLeaderboard = jest.fn<FirebaseDailyRemoteGateway['getLeaderboard']>();
}

function referenceRun(
  clientRunId = 'firebase-daily-run-0001',
  createdAt = '2026-08-27T12:00:00.000Z',
) {
  return referenceRunForDate('2026-08-27', clientRunId, createdAt);
}

function referenceRunForDate(
  challengeDate: string,
  clientRunId: string,
  createdAt: string,
) {
  const challenge = getDailyChallengeForDate(challengeDate);
  const level = getCampaignLevel(challenge.levelId);
  return createDailyRun(
    challenge,
    createLevelReplay(level, level.referenceSolution),
    {
      clientRunId,
      createdAt,
    },
  );
}

describe('FirebaseDailyChallengeService local-first boundary', () => {
  beforeEach(() => {
    resetFirebaseDailyClientsForTests();
  });

  test('returns the deterministic challenge without waiting for Firebase', async () => {
    const remote = new FakeRemote();
    remote.checkChallenge.mockImplementation(
      () => new Promise<void>(() => undefined),
    );
    const service = new FirebaseDailyChallengeService(
      new LocalDailyChallengeService(new MemoryStorage()),
      () => new Date('2026-08-27T12:00:00.000Z'),
      remote,
    );

    await expect(service.getTodayChallenge()).resolves.toMatchObject({
      challengeDate: '2026-08-27',
      templateId: 'first-pull-sampler',
    });
  });

  test('saves locally on upload failure and flushes the pending best later', async () => {
    const remote = new FakeRemote();
    const local = new LocalDailyChallengeService(
      new MemoryStorage(),
      () => new Date('2026-08-27T12:00:00.000Z'),
    );
    const service = new FirebaseDailyChallengeService(
      local,
      () => new Date('2026-08-27T12:00:00.000Z'),
      remote,
    );
    const run = referenceRun();
    remote.submitRun.mockRejectedValueOnce(new Error('offline'));

    await expect(service.submitRun(run)).resolves.toMatchObject({
      accepted: true,
      personalBest: { clientRunId: run.clientRunId },
      syncStatus: 'pending',
    });
    await expect(local.getPendingRuns()).resolves.toEqual([run]);
    await expect(local.getLeaderboard(run.challengeId)).resolves.toHaveLength(1);

    remote.submitRun.mockResolvedValueOnce(true);
    remote.getLeaderboard.mockResolvedValueOnce([]);
    await expect(service.getLeaderboard(run.challengeId)).resolves.toEqual([
      expect.objectContaining({ id: run.clientRunId, isCurrentPlayer: true }),
    ]);
    expect(remote.submitRun).toHaveBeenCalledTimes(2);
    expect(service.status).toBe('remote');
    await expect(local.getPendingRuns()).resolves.toEqual([]);
  });

  test('uploads an earlier pending best instead of a later tied attempt', async () => {
    const remote = new FakeRemote();
    const local = new LocalDailyChallengeService(
      new MemoryStorage(),
      () => new Date('2026-08-27T12:00:00.000Z'),
    );
    const service = new FirebaseDailyChallengeService(
      local,
      () => new Date('2026-08-27T12:00:00.000Z'),
      remote,
    );
    const first = referenceRun();
    const tie = referenceRun(
      'firebase-daily-run-0002',
      '2026-08-27T12:01:00.000Z',
    );
    remote.submitRun.mockRejectedValueOnce(new Error('offline'));
    await service.submitRun(first);
    remote.submitRun.mockResolvedValueOnce(true);

    await expect(service.submitRun(tie)).resolves.toMatchObject({
      isNewBest: false,
      personalBest: { clientRunId: first.clientRunId },
      syncStatus: 'remote',
    });
    expect(remote.submitRun).toHaveBeenNthCalledWith(2, first);
    await expect(local.getPendingRuns()).resolves.toEqual([]);
  });

  test('promotes a volatile local run when Firebase accepts that run', async () => {
    const remote = new FakeRemote();
    const local = new LocalDailyChallengeService(new FailingWriteStorage());
    const service = new FirebaseDailyChallengeService(
      local,
      () => new Date('2026-08-27T12:00:00.000Z'),
      remote,
    );
    const run = referenceRun('firebase-volatile-remote-0001');
    remote.submitRun.mockResolvedValueOnce(true);

    await expect(service.submitRun(run)).resolves.toMatchObject({
      accepted: true,
      isNewBest: true,
      syncStatus: 'remote',
      message: 'Shared successfully, but device storage is unavailable.',
    });
    expect(remote.submitRun).toHaveBeenCalledWith(run);
    await expect(local.getPendingRuns()).resolves.toEqual([]);
  });

  test('keeps the volatile warning when Firebase is also unavailable', async () => {
    const remote = new FakeRemote();
    const local = new LocalDailyChallengeService(new FailingWriteStorage());
    const service = new FirebaseDailyChallengeService(
      local,
      () => new Date('2026-08-27T12:00:00.000Z'),
      remote,
    );
    const run = referenceRun('firebase-volatile-offline-0001');
    remote.submitRun.mockRejectedValueOnce(new Error('offline'));

    await expect(service.submitRun(run)).resolves.toMatchObject({
      accepted: false,
      syncStatus: 'volatile',
      message:
        'Kept for this session only. Device storage and the shared board are unavailable.',
    });
    await expect(local.getPendingRuns()).resolves.toEqual([run]);
  });

  test('drops expired pending days without blocking a current upload', async () => {
    const remote = new FakeRemote();
    const local = new LocalDailyChallengeService(new MemoryStorage());
    const service = new FirebaseDailyChallengeService(
      local,
      () => new Date('2026-08-27T12:00:00.000Z'),
      remote,
    );
    const expired = referenceRunForDate(
      '2026-08-25',
      'firebase-expired-pending-0001',
      '2026-08-25T12:00:00.000Z',
    );
    const current = referenceRun('firebase-current-pending-0001');
    await local.submitRun(expired);
    await local.submitRun(current);
    remote.submitRun.mockResolvedValueOnce(true);
    remote.getLeaderboard.mockResolvedValueOnce([]);

    await service.getLeaderboard(current.challengeId);

    expect(remote.submitRun).toHaveBeenCalledTimes(1);
    expect(remote.submitRun).toHaveBeenCalledWith(current);
    await expect(local.getPendingRuns()).resolves.toEqual([]);
    expect(service.status).toBe('remote');
  });

  test('shares one pending flush across reconnect and leaderboard refresh', async () => {
    const remote = new FakeRemote();
    const local = new LocalDailyChallengeService(new MemoryStorage());
    const service = new FirebaseDailyChallengeService(
      local,
      () => new Date('2026-08-27T12:00:00.000Z'),
      remote,
    );
    const run = referenceRun('firebase-concurrent-flush-0001');
    await local.submitRun(run);

    let signalUploadStarted!: () => void;
    const uploadStarted = new Promise<void>((resolve) => {
      signalUploadStarted = resolve;
    });
    let finishUpload!: () => void;
    const uploadGate = new Promise<boolean>((resolve) => {
      finishUpload = () => resolve(true);
    });
    remote.checkChallenge.mockResolvedValueOnce();
    remote.submitRun.mockImplementationOnce(() => {
      signalUploadStarted();
      return uploadGate;
    });
    remote.getLeaderboard.mockResolvedValueOnce([]);

    await service.getTodayChallenge();
    await uploadStarted;
    const leaderboard = service.getLeaderboard(run.challengeId);
    await Promise.resolve();

    expect(remote.submitRun).toHaveBeenCalledTimes(1);
    finishUpload();
    await leaderboard;

    expect(remote.submitRun).toHaveBeenCalledTimes(1);
    await expect(local.getPendingRuns()).resolves.toEqual([]);
    expect(service.status).toBe('remote');
  });
});
