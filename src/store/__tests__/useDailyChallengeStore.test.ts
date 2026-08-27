import { waitFor } from '@testing-library/react-native';
import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import {
  createDailyRun,
  getDailyChallengeForDate,
  type DailyChallenge,
  type DailyLeaderboardEntry,
  type DailyRun,
} from '../../game/daily';
import { getCampaignLevel } from '../../game/levels/levelLoader';
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
  const level = getCampaignLevel(challenge.levelId);
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
  >,
): DailyChallengeService {
  return {
    kind: 'local',
    status: 'local',
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
});
