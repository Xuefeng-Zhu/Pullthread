import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import {
  createDailyRun,
  DAILY_SUBMISSION_MIN_INTERVAL_MS,
  DailyCatalogUpdateRequiredError,
  getDailyChallengeForDate,
} from '../../../game/daily';
import { getLevelVersion } from '../../../game/levels/levelLoader';
import { createLevelReplay } from '../../../game/replay';
import {
  FirebaseDailyChallengeService,
  ensureAnonymousUser,
  type FirebaseDailyRemoteGateway,
  type FirebaseDailyRemoteSubmission,
  parseFirebaseDailySubmissionResponse,
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
  readonly getPersonalBest = jest.fn<FirebaseDailyRemoteGateway['getPersonalBest']>();
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
  const level = getLevelVersion(challenge.levelId, challenge.levelVersion);
  return createDailyRun(
    challenge,
    createLevelReplay(level, level.referenceSolution),
    {
      clientRunId,
      createdAt,
    },
  );
}

function remoteSubmission(
  personalBest: ReturnType<typeof referenceRun>,
  isNewBest = true,
): FirebaseDailyRemoteSubmission {
  return Object.freeze({ isNewBest, personalBest });
}

describe('Firebase anonymous session coordination', () => {
  test('shares one cold-start anonymous sign-in across concurrent readers', async () => {
    const auth = { currentUser: null } as unknown as Parameters<
      typeof ensureAnonymousUser
    >[0];
    let finishSignIn!: () => void;
    const signInGate = new Promise<void>((resolve) => {
      finishSignIn = resolve;
    });
    const signIn = jest.fn<
      NonNullable<Parameters<typeof ensureAnonymousUser>[1]>
    >(async () => {
      await signInGate;
      return { user: { uid: 'shared-anonymous-user' } };
    });

    const first = ensureAnonymousUser(auth, signIn);
    const second = ensureAnonymousUser(auth, signIn);
    expect(signIn).toHaveBeenCalledTimes(1);

    finishSignIn();
    await expect(Promise.all([first, second])).resolves.toEqual([
      'shared-anonymous-user',
      'shared-anonymous-user',
    ]);
    expect(signIn).toHaveBeenCalledTimes(1);
  });
});

describe('Firebase Daily submission response parsing', () => {
  test('accepts a canonical authoritative incumbent', () => {
    const submitted = referenceRun('firebase-parser-submitted-0001');
    const incumbent = referenceRun('firebase-parser-incumbent-0001');

    expect(
      parseFirebaseDailySubmissionResponse(
        { accepted: true, isNewBest: false, personalBest: incumbent },
        submitted,
      ),
    ).toEqual(remoteSubmission(incumbent, false));
  });

  test('rejects missing, cross-challenge, and false new-best responses', () => {
    const submitted = referenceRun('firebase-parser-submitted-0002');
    const differentDay = referenceRunForDate(
      '2026-08-26',
      'firebase-parser-yesterday-0001',
      '2026-08-26T12:00:00.000Z',
    );
    const tiedOtherId = referenceRun('firebase-parser-other-0001');

    expect(() =>
      parseFirebaseDailySubmissionResponse(
        { accepted: true, isNewBest: false },
        submitted,
      ),
    ).toThrow();
    expect(() =>
      parseFirebaseDailySubmissionResponse(
        { accepted: true, isNewBest: false, personalBest: differentDay },
        submitted,
      ),
    ).toThrow(/authoritative best/);
    expect(() =>
      parseFirebaseDailySubmissionResponse(
        { accepted: true, isNewBest: true, personalBest: tiedOtherId },
        submitted,
      ),
    ).toThrow(/authoritative best/);
  });
});

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

  test('flushes the final supported day when today requires an update', async () => {
    const remote = new FakeRemote();
    const local = new LocalDailyChallengeService(new MemoryStorage());
    const finalSupportedRun = referenceRunForDate(
      '2027-12-31',
      'firebase-final-supported-run-0001',
      '2027-12-31T12:00:00.000Z',
    );
    await local.submitRun(finalSupportedRun);
    let signalUploadStarted!: () => void;
    const uploadStarted = new Promise<void>((resolve) => {
      signalUploadStarted = resolve;
    });
    remote.submitRun.mockImplementationOnce(async (run) => {
      signalUploadStarted();
      return remoteSubmission(run);
    });
    const service = new FirebaseDailyChallengeService(
      local,
      () => new Date('2028-01-01T00:01:00.000Z'),
      remote,
    );

    await expect(service.getTodayChallenge()).rejects.toBeInstanceOf(
      DailyCatalogUpdateRequiredError,
    );
    await uploadStarted;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if ((await local.getPendingRuns()).length === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(remote.submitRun).toHaveBeenCalledWith(finalSupportedRun);
    await expect(local.getPendingRuns()).resolves.toEqual([]);
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

    remote.submitRun.mockResolvedValueOnce(remoteSubmission(run));
    remote.getLeaderboard.mockResolvedValueOnce([]);
    await expect(service.getLeaderboard(run.challengeId)).resolves.toEqual([]);
    expect(remote.submitRun).toHaveBeenCalledTimes(2);
    expect(service.status).toBe('remote');
    await expect(local.getPendingRuns()).resolves.toEqual([]);
    remote.getPersonalBest.mockResolvedValueOnce(null);
    await expect(service.getPersonalBest(run.challengeId)).resolves.toMatchObject(
      { clientRunId: run.clientRunId },
    );
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
    remote.submitRun.mockResolvedValueOnce(remoteSubmission(first));

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
    remote.submitRun.mockResolvedValueOnce(remoteSubmission(run));

    await expect(service.submitRun(run)).resolves.toMatchObject({
      accepted: true,
      isNewBest: true,
      syncStatus: 'remote',
      message: 'Shared as a new best, but device storage is unavailable.',
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

  test('preserves a local personal best omitted from the remote top 50', async () => {
    const remote = new FakeRemote();
    const local = new LocalDailyChallengeService(new MemoryStorage());
    const service = new FirebaseDailyChallengeService(
      local,
      () => new Date('2026-08-27T12:00:00.000Z'),
      remote,
    );
    const run = referenceRun('firebase-outside-top-fifty-0001');
    await local.submitRun(run);
    await local.markRunSynced(run);
    const remoteBoard = Array.from({ length: 50 }, (_, index) => ({
      id: `remote-top-${index + 1}`,
      rank: index + 1,
      displayName: `Remote ${index + 1}`,
      metrics: run.metrics,
      replay: run.replay,
      isCurrentPlayer: false,
    }));
    remote.getLeaderboard.mockResolvedValueOnce(remoteBoard);
    remote.getPersonalBest.mockResolvedValueOnce(null);

    await expect(service.getLeaderboard(run.challengeId)).resolves.toEqual(
      remoteBoard,
    );
    await expect(service.getPersonalBest(run.challengeId)).resolves.toMatchObject(
      { clientRunId: run.clientRunId },
    );

    remote.getLeaderboard.mockRejectedValueOnce(new Error('offline'));
    await expect(service.getLeaderboard(run.challengeId)).resolves.toEqual(
      remoteBoard,
    );
    expect(service.status).toBe('offline');

    remote.getLeaderboard.mockResolvedValueOnce([]);
    await expect(service.getLeaderboard(run.challengeId)).resolves.toEqual([]);
    remote.getLeaderboard.mockRejectedValueOnce(new Error('offline again'));
    await expect(service.getLeaderboard(run.challengeId)).resolves.toEqual([]);
  });

  test('does not invent a shared rank for an offline local personal best', async () => {
    const remote = new FakeRemote();
    const local = new LocalDailyChallengeService(new MemoryStorage());
    const service = new FirebaseDailyChallengeService(
      local,
      () => new Date('2026-08-27T12:00:00.000Z'),
      remote,
    );
    const run = referenceRun('firebase-offline-personal-best-0001');
    await local.submitRun(run);
    await local.markRunSynced(run);
    remote.getLeaderboard.mockRejectedValueOnce(new Error('offline'));
    remote.getPersonalBest.mockRejectedValueOnce(new Error('offline'));

    await expect(service.getLeaderboard(run.challengeId)).resolves.toEqual([]);
    await expect(service.getPersonalBest(run.challengeId)).resolves.toMatchObject(
      { clientRunId: run.clientRunId },
    );
    expect(service.status).toBe('offline');
  });

  test('keeps a failed board offline when a background challenge check later succeeds', async () => {
    const remote = new FakeRemote();
    const local = new LocalDailyChallengeService(new MemoryStorage());
    let finishChallengeCheck!: () => void;
    const challengeCheckGate = new Promise<void>((resolve) => {
      finishChallengeCheck = resolve;
    });
    let signalChallengeCheckFinished!: () => void;
    const challengeCheckFinished = new Promise<void>((resolve) => {
      signalChallengeCheckFinished = resolve;
    });
    remote.checkChallenge.mockImplementationOnce(async () => {
      await challengeCheckGate;
      signalChallengeCheckFinished();
    });
    remote.getLeaderboard.mockRejectedValueOnce(new Error('offline'));
    const service = new FirebaseDailyChallengeService(
      local,
      () => new Date('2026-08-27T12:00:00.000Z'),
      remote,
    );
    const challenge = await service.getTodayChallenge();

    await expect(service.getLeaderboard(challenge.id)).resolves.toEqual([]);
    expect(service.status).toBe('offline');

    finishChallengeCheck();
    await challengeCheckFinished;
    await Promise.resolve();
    expect(service.status).toBe('offline');
  });

  test('does not let an older refresh overwrite the newer cached board', async () => {
    const remote = new FakeRemote();
    const local = new LocalDailyChallengeService(new MemoryStorage());
    const run = referenceRun('firebase-board-generation-0001');
    const olderBoard = [
      {
        id: 'older-remote-entry',
        rank: 2,
        displayName: 'Older snapshot',
        metrics: run.metrics,
        replay: run.replay,
        isCurrentPlayer: false,
      },
    ];
    const newerBoard = [
      {
        id: 'newer-remote-entry',
        rank: 1,
        displayName: 'Newer snapshot',
        metrics: run.metrics,
        replay: run.replay,
        isCurrentPlayer: false,
      },
    ];
    let signalOlderRequestStarted!: () => void;
    const olderRequestStarted = new Promise<void>((resolve) => {
      signalOlderRequestStarted = resolve;
    });
    let finishOlderRequest!: () => void;
    const olderRequest = new Promise<typeof olderBoard>((resolve) => {
      finishOlderRequest = () => resolve(olderBoard);
    });
    remote.getLeaderboard
      .mockImplementationOnce(() => {
        signalOlderRequestStarted();
        return olderRequest;
      })
      .mockResolvedValueOnce(newerBoard)
      .mockRejectedValueOnce(new Error('offline'));
    const service = new FirebaseDailyChallengeService(
      local,
      () => new Date('2026-08-27T12:00:00.000Z'),
      remote,
    );

    const staleRefresh = service.getLeaderboard(run.challengeId);
    await olderRequestStarted;
    await expect(service.getLeaderboard(run.challengeId)).resolves.toEqual(
      newerBoard,
    );
    finishOlderRequest();
    await expect(staleRefresh).resolves.toEqual(olderBoard);

    await expect(service.getLeaderboard(run.challengeId)).resolves.toEqual(
      newerBoard,
    );
    expect(service.status).toBe('offline');
  });

  test('does not let a prior-day success overwrite the current board status', async () => {
    const remote = new FakeRemote();
    const local = new LocalDailyChallengeService(new MemoryStorage());
    const priorRun = referenceRun('firebase-prior-day-board-0001');
    const currentRun = referenceRunForDate(
      '2026-08-28',
      'firebase-current-day-board-0001',
      '2026-08-28T12:00:00.000Z',
    );
    const priorBoard = [
      {
        id: 'prior-day-entry',
        rank: 1,
        displayName: 'Prior day',
        metrics: priorRun.metrics,
        replay: priorRun.replay,
        isCurrentPlayer: false,
      },
    ];
    let signalPriorRequestStarted!: () => void;
    const priorRequestStarted = new Promise<void>((resolve) => {
      signalPriorRequestStarted = resolve;
    });
    let finishPriorRequest!: () => void;
    const priorRequest = new Promise<typeof priorBoard>((resolve) => {
      finishPriorRequest = () => resolve(priorBoard);
    });
    remote.getLeaderboard
      .mockImplementationOnce(() => {
        signalPriorRequestStarted();
        return priorRequest;
      })
      .mockRejectedValueOnce(new Error('current board offline'));
    let now = new Date('2026-08-27T23:59:59.999Z');
    const service = new FirebaseDailyChallengeService(
      local,
      () => now,
      remote,
    );

    const priorRefresh = service.getLeaderboard(priorRun.challengeId);
    await priorRequestStarted;
    now = new Date('2026-08-28T00:00:00.000Z');
    await expect(service.getLeaderboard(currentRun.challengeId)).resolves.toEqual(
      [],
    );
    expect(service.status).toBe('offline');

    finishPriorRequest();
    await expect(priorRefresh).resolves.toEqual(priorBoard);
    expect(service.status).toBe('offline');
    await expect(service.getLeaderboard(priorRun.challengeId)).resolves.toEqual(
      priorBoard,
    );
    expect(service.status).toBe('offline');
  });

  test('uses and caches the authoritative best after local storage resets', async () => {
    const remote = new FakeRemote();
    const local = new LocalDailyChallengeService(new MemoryStorage());
    const service = new FirebaseDailyChallengeService(
      local,
      () => new Date('2026-08-27T12:00:00.000Z'),
      remote,
    );
    const candidate = referenceRun('firebase-reset-candidate-0001');
    const incumbent = referenceRun('firebase-server-incumbent-0001');
    remote.submitRun.mockResolvedValueOnce(remoteSubmission(incumbent, false));

    await expect(service.submitRun(candidate)).resolves.toMatchObject({
      accepted: true,
      isNewBest: false,
      personalBest: { clientRunId: incumbent.clientRunId },
      syncStatus: 'remote',
    });
    await expect(local.getPersonalBest(candidate.challengeId)).resolves.toMatchObject(
      { clientRunId: incumbent.clientRunId },
    );
    await expect(local.getPendingRuns()).resolves.toEqual([]);
  });

  test('keeps the authoritative best in memory when device writes fail', async () => {
    const remote = new FakeRemote();
    const local = new LocalDailyChallengeService(new FailingWriteStorage());
    const service = new FirebaseDailyChallengeService(
      local,
      () => new Date('2026-08-27T12:00:00.000Z'),
      remote,
    );
    const candidate = referenceRun('firebase-volatile-candidate-0001');
    const incumbent = referenceRun('firebase-volatile-incumbent-0001');
    remote.submitRun.mockResolvedValueOnce(remoteSubmission(incumbent, false));

    await expect(service.submitRun(candidate)).resolves.toMatchObject({
      accepted: true,
      isNewBest: false,
      personalBest: { clientRunId: incumbent.clientRunId },
      syncStatus: 'remote',
      message: 'Shared best is up to date, but device storage is unavailable.',
    });
    await expect(local.getPersonalBest(candidate.challengeId)).resolves.toMatchObject(
      { clientRunId: incumbent.clientRunId },
    );
    await expect(local.getPendingRuns()).resolves.toEqual([]);
  });

  test('returns the reconciled best when its parallel direct read fails', async () => {
    const remote = new FakeRemote();
    const local = new LocalDailyChallengeService(new MemoryStorage());
    const service = new FirebaseDailyChallengeService(
      local,
      () => new Date('2026-08-27T12:00:00.000Z'),
      remote,
    );
    const candidate = referenceRun('firebase-racing-candidate-0001');
    const incumbent = referenceRun('firebase-racing-incumbent-0001');
    await local.submitRun(candidate);

    let signalUploadStarted!: () => void;
    const uploadStarted = new Promise<void>((resolve) => {
      signalUploadStarted = resolve;
    });
    let finishUpload!: () => void;
    const uploadGate = new Promise<FirebaseDailyRemoteSubmission>((resolve) => {
      finishUpload = () => resolve(remoteSubmission(incumbent, false));
    });
    remote.submitRun.mockImplementationOnce(() => {
      signalUploadStarted();
      return uploadGate;
    });
    remote.getLeaderboard.mockResolvedValueOnce([]);
    remote.getPersonalBest.mockRejectedValueOnce(new Error('read unavailable'));

    const leaderboard = service.getLeaderboard(candidate.challengeId);
    await uploadStarted;
    const personalBest = service.getPersonalBest(candidate.challengeId);
    await Promise.resolve();
    expect(remote.getPersonalBest).not.toHaveBeenCalled();

    finishUpload();
    await leaderboard;
    await expect(personalBest).resolves.toMatchObject({
      clientRunId: incumbent.clientRunId,
    });
    expect(remote.getPersonalBest).toHaveBeenCalledTimes(1);
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
    remote.submitRun.mockResolvedValueOnce(remoteSubmission(current));
    remote.getLeaderboard.mockResolvedValueOnce([]);

    await service.getLeaderboard(current.challengeId);

    expect(remote.submitRun).toHaveBeenCalledTimes(1);
    expect(remote.submitRun).toHaveBeenCalledWith(current);
    await expect(local.getPendingRuns()).resolves.toEqual([]);
    expect(service.status).toBe('remote');
  });

  test('keeps a newly completed expired run local without claiming a retry', async () => {
    const remote = new FakeRemote();
    const local = new LocalDailyChallengeService(new MemoryStorage());
    const service = new FirebaseDailyChallengeService(
      local,
      () => new Date('2026-08-27T12:00:00.000Z'),
      remote,
    );
    const expired = referenceRunForDate(
      '2026-08-25',
      'firebase-expired-foreground-0001',
      '2026-08-25T12:00:00.000Z',
    );

    const result = await service.submitRun(expired);

    expect(result).toMatchObject({
      accepted: true,
      isNewBest: true,
      personalBest: { clientRunId: expired.clientRunId },
      syncStatus: 'expired',
    });
    expect(result.message).toMatch(/too old to share/i);
    expect(result.message).not.toMatch(/retry|online/i);
    expect(remote.submitRun).not.toHaveBeenCalled();
    expect(remote.ensureGuest).not.toHaveBeenCalled();
    await expect(local.getPendingRuns()).resolves.toEqual([]);
    await expect(local.getPersonalBest(expired.challengeId)).resolves.toMatchObject(
      { clientRunId: expired.clientRunId },
    );
    expect(service.status).toBe('remote');
  });

  test('stops claiming retries when an active upload expires at rollover', async () => {
    const remote = new FakeRemote();
    const local = new LocalDailyChallengeService(new MemoryStorage());
    let now = new Date('2026-08-27T23:59:59.000Z');
    const service = new FirebaseDailyChallengeService(
      local,
      () => now,
      remote,
    );
    const yesterday = referenceRunForDate(
      '2026-08-26',
      'firebase-rollover-pending-0001',
      '2026-08-26T12:00:00.000Z',
    );
    const tie = referenceRunForDate(
      '2026-08-26',
      'firebase-rollover-tie-0001',
      '2026-08-26T12:01:00.000Z',
    );
    await local.submitRun(yesterday);

    let signalUploadStarted!: () => void;
    const uploadStarted = new Promise<void>((resolve) => {
      signalUploadStarted = resolve;
    });
    let rejectUpload!: () => void;
    const uploadGate = new Promise<FirebaseDailyRemoteSubmission>(
      (_resolve, reject) => {
        rejectUpload = () => reject(new Error('callable rejected expired run'));
      },
    );
    remote.checkChallenge.mockResolvedValueOnce();
    remote.submitRun.mockImplementationOnce(() => {
      signalUploadStarted();
      return uploadGate;
    });

    await service.getTodayChallenge();
    await uploadStarted;
    const foreground = service.submitRun(tie);
    await expect(local.attemptsForChallenge(yesterday.challengeId)).resolves.toBe(2);
    now = new Date('2026-08-28T00:00:01.000Z');
    rejectUpload();

    const result = await foreground;
    expect(result).toMatchObject({
      accepted: true,
      syncStatus: 'expired',
      personalBest: { clientRunId: yesterday.clientRunId },
    });
    expect(result.message).toMatch(/too old to share/i);
    expect(result.message).not.toMatch(/retry|online/i);
    await expect(local.getPendingRuns()).resolves.toEqual([]);
  });

  test('paces yesterday and today uploads to the server rate limit', async () => {
    const remote = new FakeRemote();
    const local = new LocalDailyChallengeService(new MemoryStorage());
    const yesterday = referenceRunForDate(
      '2026-08-26',
      'firebase-paced-yesterday-0001',
      '2026-08-26T12:00:00.000Z',
    );
    const today = referenceRun('firebase-paced-today-0001');
    await local.submitRun(yesterday);
    await local.submitRun(today);

    let virtualTime = new Date('2026-08-27T12:00:00.000Z').getTime();
    let previousUploadAt: number | null = null;
    const events: string[] = [];
    remote.submitRun.mockImplementation(async (run) => {
      events.push(`upload:${run.clientRunId}`);
      if (
        previousUploadAt !== null &&
        virtualTime - previousUploadAt < DAILY_SUBMISSION_MIN_INTERVAL_MS
      ) {
        throw new Error('server rate limit');
      }
      previousUploadAt = virtualTime;
      return remoteSubmission(run);
    });
    remote.getLeaderboard.mockResolvedValueOnce([]);
    const delay = jest.fn<(milliseconds: number) => Promise<void>>(
      async (milliseconds) => {
        events.push(`delay:${milliseconds}`);
        virtualTime += milliseconds;
      },
    );
    const service = new FirebaseDailyChallengeService(
      local,
      () => new Date(virtualTime),
      remote,
      delay,
    );

    await service.getLeaderboard(today.challengeId);

    expect(events).toEqual([
      `upload:${yesterday.clientRunId}`,
      `delay:${DAILY_SUBMISSION_MIN_INTERVAL_MS}`,
      `upload:${today.clientRunId}`,
    ]);
    expect(delay).toHaveBeenCalledWith(DAILY_SUBMISSION_MIN_INTERVAL_MS);
    expect(remote.submitRun).toHaveBeenCalledTimes(2);
    await expect(local.getPendingRuns()).resolves.toEqual([]);
    expect(service.status).toBe('remote');
  });

  test('keeps pacing when late work drains in a second flush cycle', async () => {
    const remote = new FakeRemote();
    const local = new LocalDailyChallengeService(new MemoryStorage());
    const yesterday = referenceRunForDate(
      '2026-08-26',
      'firebase-cycle-yesterday-0001',
      '2026-08-26T12:00:00.000Z',
    );
    const today = referenceRun('firebase-cycle-today-0001');
    await local.submitRun(yesterday);

    let virtualTime = new Date('2026-08-27T12:00:00.000Z').getTime();
    const events: string[] = [];
    let signalUploadStarted!: () => void;
    const uploadStarted = new Promise<void>((resolve) => {
      signalUploadStarted = resolve;
    });
    let finishFirstUpload!: () => void;
    const firstUpload = new Promise<FirebaseDailyRemoteSubmission>((resolve) => {
      finishFirstUpload = () => resolve(remoteSubmission(yesterday));
    });
    remote.submitRun
      .mockImplementationOnce((run) => {
        events.push(`upload:${run.clientRunId}`);
        signalUploadStarted();
        return firstUpload;
      })
      .mockImplementationOnce(async (run) => {
        events.push(`upload:${run.clientRunId}`);
        return remoteSubmission(run);
      });
    remote.getLeaderboard.mockResolvedValueOnce([]);
    const delay = jest.fn<(milliseconds: number) => Promise<void>>(
      async (milliseconds) => {
        events.push(`delay:${milliseconds}`);
        virtualTime += milliseconds;
      },
    );
    const service = new FirebaseDailyChallengeService(
      local,
      () => new Date(virtualTime),
      remote,
      delay,
    );

    const boardRefresh = service.getLeaderboard(today.challengeId);
    await uploadStarted;
    const foreground = service.submitRun(today);
    finishFirstUpload();

    await boardRefresh;
    await expect(foreground).resolves.toMatchObject({
      accepted: true,
      syncStatus: 'remote',
      personalBest: { clientRunId: today.clientRunId },
    });
    expect(events).toEqual([
      `upload:${yesterday.clientRunId}`,
      `delay:${DAILY_SUBMISSION_MIN_INTERVAL_MS}`,
      `upload:${today.clientRunId}`,
    ]);
    await expect(local.getPendingRuns()).resolves.toEqual([]);
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
    const uploadGate = new Promise<FirebaseDailyRemoteSubmission>((resolve) => {
      finishUpload = () => resolve(remoteSubmission(run));
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

  test('shares a background pending flush with a tied foreground submission', async () => {
    const remote = new FakeRemote();
    const local = new LocalDailyChallengeService(new MemoryStorage());
    const service = new FirebaseDailyChallengeService(
      local,
      () => new Date('2026-08-27T12:00:00.000Z'),
      remote,
    );
    const first = referenceRun('firebase-background-pending-0001');
    const tie = referenceRun(
      'firebase-foreground-tie-0001',
      '2026-08-27T12:01:00.000Z',
    );
    await local.submitRun(first);

    let signalUploadStarted!: () => void;
    const uploadStarted = new Promise<void>((resolve) => {
      signalUploadStarted = resolve;
    });
    let finishUpload!: () => void;
    const uploadGate = new Promise<FirebaseDailyRemoteSubmission>((resolve) => {
      finishUpload = () => resolve(remoteSubmission(first));
    });
    remote.checkChallenge.mockResolvedValueOnce();
    remote.submitRun.mockImplementationOnce(() => {
      signalUploadStarted();
      return uploadGate;
    });

    await service.getTodayChallenge();
    await uploadStarted;
    const foreground = service.submitRun(tie);
    await expect(local.attemptsForChallenge(first.challengeId)).resolves.toBe(2);
    await Promise.resolve();
    expect(remote.submitRun).toHaveBeenCalledTimes(1);

    finishUpload();
    await expect(foreground).resolves.toMatchObject({
      accepted: true,
      isNewBest: false,
      personalBest: { clientRunId: first.clientRunId },
      syncStatus: 'remote',
    });
    expect(remote.submitRun).toHaveBeenCalledTimes(1);
    await expect(local.getPendingRuns()).resolves.toEqual([]);
  });
});
