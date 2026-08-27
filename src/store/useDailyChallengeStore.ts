import { create } from 'zustand';

import {
  createDailyClientRunId,
  createDailyRun,
  DailyCatalogUpdateRequiredError,
  selectDailyBest,
  type DailyChallenge,
  type DailyLeaderboardEntry,
  type DailyRun,
} from '../game/daily';
import type { LevelReplayV1 } from '../game/replay';
import {
  createDailyChallengeService,
  type DailyChallengeService,
  type DailySubmissionResult,
} from '../services/dailyChallenges';

export type DailyLoadStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'error'
  | 'update-required';
export type DailyBoardStatus = 'idle' | 'loading' | 'local' | 'ready' | 'offline';
export type DailySubmitStatus =
  | 'idle'
  | 'saving'
  | 'saved'
  | 'pending'
  | 'volatile'
  | 'error';

interface DailyChallengeStore {
  readonly challenge: DailyChallenge | null;
  readonly loadStatus: DailyLoadStatus;
  readonly boardStatus: DailyBoardStatus;
  readonly submitStatus: DailySubmitStatus;
  readonly errorMessage: string | null;
  readonly statusMessage: string;
  readonly leaderboard: readonly DailyLeaderboardEntry[];
  readonly personalBest: DailyRun | null;
  readonly latestSubmission: DailySubmissionResult | null;
  loadToday: () => Promise<void>;
  refreshLeaderboard: () => Promise<void>;
  submitCompletedReplay: (
    challenge: DailyChallenge,
    replay: LevelReplayV1,
  ) => Promise<DailySubmissionResult | null>;
}

let service: DailyChallengeService = createDailyChallengeService();
let loadRequest = 0;
let leaderboardRequest = 0;
let submissionRequest = 0;

function personalBestFromEntries(
  entries: readonly DailyLeaderboardEntry[],
  challenge: DailyChallenge,
): DailyRun | null {
  const ownEntry = entries.find((entry) => entry.isCurrentPlayer && entry.replay);
  if (!ownEntry?.replay) return null;
  try {
    return createDailyRun(challenge, ownEntry.replay.levelReplay, {
      clientRunId: ownEntry.id,
      createdAt: new Date(0).toISOString(),
    });
  } catch {
    return null;
  }
}

function selectPersonalBest(
  challenge: DailyChallenge,
  ...candidates: readonly (DailyRun | null | undefined)[]
): DailyRun | null {
  let best: DailyRun | null = null;
  for (const candidate of candidates) {
    if (!candidate || candidate.challengeId !== challenge.id) continue;
    best = best ? selectDailyBest(candidate, best) : candidate;
  }
  return best;
}

export const useDailyChallengeStore = create<DailyChallengeStore>((set, get) => ({
  challenge: null,
  loadStatus: 'idle',
  boardStatus: 'idle',
  submitStatus: 'idle',
  errorMessage: null,
  statusMessage: 'Daily Scrap is saved locally on this device.',
  leaderboard: [],
  personalBest: null,
  latestSubmission: null,

  loadToday: async () => {
    const request = ++loadRequest;
    set({ loadStatus: 'loading', errorMessage: null });
    try {
      const challenge = await service.getTodayChallenge();
      if (request !== loadRequest) return;
      const challengeChanged = get().challenge?.id !== challenge.id;
      if (challengeChanged) {
        // Results still in flight belong to the prior UTC day. The service
        // may finish its own durable work, but it must not repopulate the new
        // day's visible state.
        leaderboardRequest += 1;
        submissionRequest += 1;
      }
      set((state) => ({
        challenge,
        loadStatus: 'ready',
        boardStatus: 'loading',
        submitStatus: challengeChanged ? 'idle' : state.submitStatus,
        leaderboard: challengeChanged ? [] : state.leaderboard,
        personalBest: challengeChanged ? null : state.personalBest,
        latestSubmission: challengeChanged ? null : state.latestSubmission,
        statusMessage:
          service.kind === 'local'
            ? 'LOCAL BOARD — Remote leaderboard is not configured.'
            : 'Loading shared standings…',
      }));
      await get().refreshLeaderboard();
    } catch (error) {
      if (request !== loadRequest) return;
      leaderboardRequest += 1;
      submissionRequest += 1;
      const updateRequired = error instanceof DailyCatalogUpdateRequiredError;
      set({
        challenge: null,
        loadStatus: updateRequired ? 'update-required' : 'error',
        boardStatus: 'idle',
        submitStatus: 'idle',
        leaderboard: [],
        personalBest: null,
        latestSubmission: null,
        errorMessage: updateRequired
          ? 'Update Pullthread to load today’s Daily Scrap.'
          : 'Today’s scrap could not be prepared. Try again.',
      });
    }
  },

  refreshLeaderboard: async () => {
    const challenge = get().challenge;
    if (!challenge) return;
    const challengeId = challenge.id;
    const request = ++leaderboardRequest;
    set((state) =>
      state.challenge?.id === challengeId
        ? { boardStatus: 'loading' }
        : state,
    );
    try {
      const [leaderboard, servicePersonalBest] = await Promise.all([
        service.getLeaderboard(challenge.id),
        service.getPersonalBest(challenge.id),
      ]);
      if (
        request !== leaderboardRequest ||
        get().challenge?.id !== challengeId
      ) {
        return;
      }
      const localOnly = service.kind === 'local';
      const offline = service.status === 'offline';
      set((state) => ({
        leaderboard,
        personalBest: selectPersonalBest(
          challenge,
          servicePersonalBest,
          personalBestFromEntries(leaderboard, challenge),
          state.personalBest,
        ),
        boardStatus: localOnly ? 'local' : offline ? 'offline' : 'ready',
        statusMessage: localOnly
          ? 'LOCAL BOARD — Remote leaderboard is not configured.'
          : offline
            ? 'Showing saved standings. Today’s challenge still works offline.'
            : 'Shared standings are up to date.',
      }));
    } catch {
      if (
        request !== leaderboardRequest ||
        get().challenge?.id !== challengeId
      ) {
        return;
      }
      set({
        boardStatus: 'offline',
        statusMessage: 'Shared board unavailable. Today’s challenge still works.',
      });
    }
  },

  submitCompletedReplay: async (challenge, replay) => {
    if (get().challenge?.id !== challenge.id) return null;
    const challengeId = challenge.id;
    const request = ++submissionRequest;
    const run = createDailyRun(challenge, replay, {
      clientRunId: createDailyClientRunId(challenge),
      createdAt: new Date().toISOString(),
    });
    set({
      submitStatus: 'saving',
      errorMessage: null,
      latestSubmission: null,
    });
    try {
      const result = await service.submitRun(run);
      if (
        request !== submissionRequest ||
        get().challenge?.id !== challengeId
      ) {
        return null;
      }
      const submitStatus: DailySubmitStatus =
        !result.accepted || result.syncStatus === 'volatile'
          ? 'volatile'
          : result.syncStatus === 'pending'
            ? 'pending'
            : 'saved';
      const submissionState = (state: DailyChallengeStore) => ({
        personalBest: selectPersonalBest(
          challenge,
          result.personalBest,
          state.personalBest,
        ),
        latestSubmission: result,
        submitStatus,
        statusMessage: result.message,
      });
      set(submissionState);
      await get().refreshLeaderboard();
      if (
        request !== submissionRequest ||
        get().challenge?.id !== challengeId
      ) {
        return null;
      }
      set(submissionState);
      return result;
    } catch {
      if (
        request !== submissionRequest ||
        get().challenge?.id !== challengeId
      ) {
        return null;
      }
      set({
        submitStatus: 'error',
        errorMessage: 'This pull could not be saved. Please try again.',
      });
      return null;
    }
  },
}));

export function setDailyChallengeServiceForTests(
  nextService: DailyChallengeService,
): void {
  loadRequest += 1;
  leaderboardRequest += 1;
  submissionRequest += 1;
  service = nextService;
}

export function resetDailyChallengeStoreForTests(
  nextService: DailyChallengeService = createDailyChallengeService(),
): void {
  service = nextService;
  loadRequest += 1;
  leaderboardRequest += 1;
  submissionRequest += 1;
  useDailyChallengeStore.setState({
    challenge: null,
    loadStatus: 'idle',
    boardStatus: 'idle',
    submitStatus: 'idle',
    errorMessage: null,
    statusMessage: 'Daily Scrap is saved locally on this device.',
    leaderboard: [],
    personalBest: null,
    latestSubmission: null,
  });
}
