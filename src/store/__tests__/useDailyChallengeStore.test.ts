import { waitFor } from '@testing-library/react-native';
import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import {
  createDailyRun,
  DailyCatalogUpdateRequiredError,
  getDailyChallengeForDate,
  type DailyChallenge,
  type DailyLeaderboardEntry,
  type DailyRun,
} from '../../game/daily';
import { getLevelVersion } from '../../game/levels/levelLoader';
import { createLevelReplay, type LevelReplayV1 } from '../../game/replay';
import type {
  DailyChallengeService,
  DailySubmissionResult,
} from '../../services/dailyChallenges';
import {
  resetDailyChallengeStoreForTests,
  useDailyChallengeStore,
} from '../useDailyChallengeStore';

interface DailyFixture {
  readonly challenge: DailyChallenge;
  readonly entry: DailyLeaderboardEntry;
  readonly replay: LevelReplayV1;
  readonly run: DailyRun;
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function dailyFixture(date: string, suffix: string): DailyFixture {
  const challenge = getDailyChallengeForDate(date);
  const level = getLevelVersion(challenge.levelId, challenge.levelVersion);
  const replay = createLevelReplay(level, level.referenceSolution);
  const run = createDailyRun(challenge, replay, {
    clientRunId: `daily-store-${suffix}`,
    createdAt: `${date}T12:00:00.000Z`,
  });
  return {
    challenge,
    replay,
    run,
    entry: Object.freeze({
      id: run.clientRunId,
      rank: 1,
      displayName: `Quilter ${suffix}`,
      metrics: run.metrics,
      replay: run.replay,
      isCurrentPlayer: true,
    }),
  };
}

const firstDay = dailyFixture('2026-08-27', 'day-one');
const secondDay = dailyFixture('2026-08-28', 'day-two');

function serviceWith(
  methods: Pick<
    DailyChallengeService,
    'getLeaderboard' | 'getTodayChallenge' | 'submitRun'
  > & Partial<Pick<DailyChallengeService, 'getPersonalBest'>>,
): DailyChallengeService {
  return {
    kind: 'local',
    status: 'local',
    getPersonalBest: jest.fn(async () => null),
    ...methods,
  };
}

describe('useDailyChallengeStore request coordination', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('clears prior-day state and discards a late prior-day leaderboard', async () => {
    const firstBoard = deferred<DailyLeaderboardEntry[]>();
    const secondBoard = deferred<DailyLeaderboardEntry[]>();
    let todayRequest = 0;
    const service = serviceWith({
      getTodayChallenge: jest.fn(async () => {
        todayRequest += 1;
        return todayRequest === 1
          ? firstDay.challenge
          : secondDay.challenge;
      }),
      getLeaderboard: jest.fn((challengeId: string) =>
        challengeId === firstDay.challenge.id
          ? firstBoard.promise
          : secondBoard.promise,
      ),
      submitRun: jest.fn(async (run: DailyRun) => ({
        accepted: true,
        isNewBest: true,
        personalBest: run,
        syncStatus: 'local' as const,
        message: 'Saved on this device.',
      })),
    });
    resetDailyChallengeStoreForTests(service);

    const firstLoad = useDailyChallengeStore.getState().loadToday();
    await waitFor(() => {
      expect(useDailyChallengeStore.getState()).toMatchObject({
        challenge: { id: firstDay.challenge.id },
        boardStatus: 'loading',
      });
    });

    const secondLoad = useDailyChallengeStore.getState().loadToday();
    await waitFor(() => {
      expect(useDailyChallengeStore.getState()).toMatchObject({
        challenge: { id: secondDay.challenge.id },
        boardStatus: 'loading',
        leaderboard: [],
        personalBest: null,
        latestSubmission: null,
      });
    });

    secondBoard.resolve([secondDay.entry]);
    await secondLoad;
    expect(useDailyChallengeStore.getState()).toMatchObject({
      challenge: { id: secondDay.challenge.id },
      leaderboard: [{ id: secondDay.entry.id }],
      personalBest: { challengeId: secondDay.challenge.id },
    });

    firstBoard.resolve([firstDay.entry]);
    await firstLoad;
    expect(useDailyChallengeStore.getState()).toMatchObject({
      challenge: { id: secondDay.challenge.id },
      leaderboard: [{ id: secondDay.entry.id }],
      personalBest: { challengeId: secondDay.challenge.id },
    });
  });

  test('discards a prior-day submission result that resolves after rollover', async () => {
    const pendingSubmission = deferred<DailySubmissionResult>();
    let activeDay = firstDay;
    let submittedRun: DailyRun | null = null;
    const service = serviceWith({
      getTodayChallenge: jest.fn(async () => activeDay.challenge),
      getLeaderboard: jest.fn(async () => []),
      submitRun: jest.fn((run: DailyRun) => {
        submittedRun = run;
        return pendingSubmission.promise;
      }),
    });
    resetDailyChallengeStoreForTests(service);
    await useDailyChallengeStore.getState().loadToday();

    const submission = useDailyChallengeStore
      .getState()
      .submitCompletedReplay(firstDay.challenge, firstDay.replay);
    await waitFor(() => {
      expect(useDailyChallengeStore.getState().submitStatus).toBe('saving');
      expect(submittedRun).not.toBeNull();
    });

    activeDay = secondDay;
    await useDailyChallengeStore.getState().loadToday();
    expect(useDailyChallengeStore.getState()).toMatchObject({
      challenge: { id: secondDay.challenge.id },
      submitStatus: 'idle',
      personalBest: null,
      latestSubmission: null,
    });
    if (!submittedRun) throw new Error('Expected the first-day run to submit.');

    pendingSubmission.resolve({
      accepted: true,
      isNewBest: true,
      personalBest: submittedRun,
      syncStatus: 'local',
      message: 'Saved on this device.',
    });

    await expect(submission).resolves.toBeNull();
    expect(useDailyChallengeStore.getState()).toMatchObject({
      challenge: { id: secondDay.challenge.id },
      submitStatus: 'idle',
      personalBest: null,
      latestSubmission: null,
      leaderboard: [],
    });
  });

  test('loads the personal best independently when the shared top 50 omits it', async () => {
    const sharedTopFifty = Array.from({ length: 50 }, (_, index) => ({
      ...firstDay.entry,
      id: `shared-player-${index + 1}`,
      rank: index + 1,
      displayName: `Quilter ${index + 1}`,
      isCurrentPlayer: false,
    }));
    const service = serviceWith({
      getTodayChallenge: jest.fn(async () => firstDay.challenge),
      getLeaderboard: jest.fn(async () => sharedTopFifty),
      getPersonalBest: jest.fn(async () => firstDay.run),
      submitRun: jest.fn(async (run: DailyRun) => ({
        accepted: true,
        isNewBest: true,
        personalBest: run,
        syncStatus: 'remote' as const,
        message: 'Shared as a new best.',
      })),
    });
    resetDailyChallengeStoreForTests(service);

    await useDailyChallengeStore.getState().loadToday();

    expect(useDailyChallengeStore.getState()).toMatchObject({
      leaderboard: { length: 50 },
      personalBest: { clientRunId: firstDay.run.clientRunId },
    });
  });

  test('keeps the authoritative incumbent after a tied submission refreshes', async () => {
    const service = serviceWith({
      getTodayChallenge: jest.fn(async () => firstDay.challenge),
      getLeaderboard: jest.fn(async () => []),
      getPersonalBest: jest.fn(async () => null),
      submitRun: jest.fn(async () => ({
        accepted: true,
        isNewBest: false,
        personalBest: firstDay.run,
        syncStatus: 'remote' as const,
        message: 'Shared. Your existing best still leads this attempt.',
      })),
    });
    resetDailyChallengeStoreForTests(service);
    await useDailyChallengeStore.getState().loadToday();

    await expect(
      useDailyChallengeStore
        .getState()
        .submitCompletedReplay(firstDay.challenge, firstDay.replay),
    ).resolves.toMatchObject({
      isNewBest: false,
      personalBest: { clientRunId: firstDay.run.clientRunId },
    });
    expect(useDailyChallengeStore.getState()).toMatchObject({
      submitStatus: 'saved',
      personalBest: { clientRunId: firstDay.run.clientRunId },
      latestSubmission: {
        isNewBest: false,
        personalBest: { clientRunId: firstDay.run.clientRunId },
      },
    });
  });

  test('fails closed and clears day-scoped state when the catalog needs an update', async () => {
    let todayRequests = 0;
    const service = serviceWith({
      getTodayChallenge: jest.fn(async () => {
        todayRequests += 1;
        if (todayRequests === 1) return firstDay.challenge;
        throw new DailyCatalogUpdateRequiredError('2028-01-01');
      }),
      getLeaderboard: jest.fn(async () => [firstDay.entry]),
      getPersonalBest: jest.fn(async () => firstDay.run),
      submitRun: jest.fn(async (run: DailyRun) => ({
        accepted: true,
        isNewBest: true,
        personalBest: run,
        syncStatus: 'local' as const,
        message: 'Saved on this device.',
      })),
    });
    resetDailyChallengeStoreForTests(service);
    await useDailyChallengeStore.getState().loadToday();
    await useDailyChallengeStore
      .getState()
      .submitCompletedReplay(firstDay.challenge, firstDay.replay);

    await useDailyChallengeStore.getState().loadToday();

    expect(useDailyChallengeStore.getState()).toMatchObject({
      challenge: null,
      loadStatus: 'update-required',
      boardStatus: 'idle',
      submitStatus: 'idle',
      leaderboard: [],
      personalBest: null,
      latestSubmission: null,
      errorMessage: 'Update Pullthread to load today’s Daily Scrap.',
    });
  });
});
