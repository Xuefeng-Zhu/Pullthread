import { create } from 'zustand';

import {
  calculateThreadUsed,
  scoreRun,
  type RunMetrics,
  type ScoredRun,
} from '../game/core/scoring';
import type {
  SimulationOutcome,
  SimulationPhase,
  Stitch,
} from '../game/core/types';
import {
  compareDailyMetrics,
  parseDailyChallenge,
  type DailyChallenge,
} from '../game/daily';
import { CAMPAIGN_LEVELS } from '../game/levels/campaignLevels';
import {
  getCampaignLevel,
  getLevelVersion,
} from '../game/levels/levelLoader';
import {
  createLevelReplay,
  type LevelReplayV1,
} from '../game/replay';
import { useCampaignProgressStore } from './useCampaignProgressStore';
import { useDailyChallengeStore } from './useDailyChallengeStore';

export type GameSession =
  | { readonly kind: 'campaign' }
  | { readonly kind: 'daily'; readonly challenge: DailyChallenge };

export interface CompletedRun {
  /** Older persisted/test fixtures without a session are campaign runs. */
  readonly session?: GameSession;
  readonly levelId: string;
  readonly replay: LevelReplayV1;
  readonly outcome: Extract<SimulationOutcome, { status: 'success' }>;
  readonly isNewBest: boolean;
  readonly scoredRun: ScoredRun;
  /** Compatibility view used by result tiles and older callers. */
  readonly bestMetrics: RunMetrics;
}

interface CommitLimits {
  readonly maxStitches: number;
  readonly threadBudget: number;
}

interface GameStore {
  activeLevelId: string;
  activeSession: GameSession;
  phase: SimulationPhase;
  stitches: Stitch[];
  outcome: SimulationOutcome | null;
  completedRun: CompletedRun | null;
  /** Process-local mirror of the active level's durable best metrics. */
  bestRun: RunMetrics | null;
  startLevel: (levelId: string, session?: GameSession) => void;
  commitStitch: (stitch: Stitch, limits: CommitLimits) => boolean;
  removeStitch: (id: string) => void;
  undo: () => void;
  clearStitches: () => void;
  release: () => void;
  retry: () => void;
  resolve: (outcome: SimulationOutcome) => void;
  resetSession: () => void;
}

const FIRST_LEVEL_ID = CAMPAIGN_LEVELS[0].id;
const CAMPAIGN_SESSION: GameSession = Object.freeze({ kind: 'campaign' });

function scoredRunsDiffer(
  left: ScoredRun | null,
  right: ScoredRun,
): boolean {
  return (
    !left ||
    left.thimbles !== right.thimbles ||
    left.metrics.threadUsed !== right.metrics.threadUsed ||
    left.metrics.stitchesUsed !== right.metrics.stitchesUsed ||
    left.metrics.completionMs !== right.metrics.completionMs ||
    left.metrics.collectedPatch !== right.metrics.collectedPatch
  );
}

export const useGameStore = create<GameStore>((set, get) => ({
  activeLevelId: FIRST_LEVEL_ID,
  activeSession: CAMPAIGN_SESSION,
  phase: 'planning',
  stitches: [],
  outcome: null,
  completedRun: null,
  bestRun: null,

  startLevel: (levelId, requestedSession = CAMPAIGN_SESSION) => {
    const activeSession =
      requestedSession.kind === 'daily'
        ? Object.freeze({
            kind: 'daily' as const,
            challenge: parseDailyChallenge(requestedSession.challenge),
          })
        : CAMPAIGN_SESSION;
    if (
      activeSession.kind === 'daily' &&
      activeSession.challenge.levelId !== levelId
    ) {
      throw new RangeError('Daily Scrap session does not match its level.');
    }
    if (activeSession.kind === 'daily') {
      getLevelVersion(levelId, activeSession.challenge.levelVersion);
    } else {
      getCampaignLevel(levelId);
    }
    const durableBest =
      activeSession.kind === 'daily'
        ? useDailyChallengeStore.getState().personalBest?.metrics ?? null
        : useCampaignProgressStore.getState().progressByLevel[levelId]?.bestRun
            ?.metrics ?? null;
    set({
      activeLevelId: levelId,
      activeSession,
      phase: 'planning',
      stitches: [],
      outcome: null,
      completedRun: null,
      bestRun: durableBest,
    });
  },

  commitStitch: (stitch, limits) => {
    const state = get();
    if (
      state.phase !== 'planning' ||
      state.stitches.length >= limits.maxStitches ||
      calculateThreadUsed(state.stitches) + stitch.threadCost >
        limits.threadBudget
    ) {
      return false;
    }

    set({
      stitches: [...state.stitches, stitch],
      outcome: null,
      completedRun: null,
    });
    return true;
  },

  removeStitch: (id) =>
    set((state) =>
      state.phase === 'planning'
        ? {
            stitches: state.stitches.filter((stitch) => stitch.id !== id),
            outcome: null,
            completedRun: null,
          }
        : state,
    ),

  undo: () =>
    set((state) =>
      state.phase === 'planning' && state.stitches.length > 0
        ? {
            stitches: state.stitches.slice(0, -1),
            outcome: null,
            completedRun: null,
          }
        : state,
    ),

  clearStitches: () =>
    set((state) =>
      state.phase === 'planning'
        ? { stitches: [], outcome: null, completedRun: null }
        : state,
    ),

  release: () =>
    set((state) =>
      state.phase === 'planning'
        ? { phase: 'running', outcome: null, completedRun: null }
        : state,
    ),

  retry: () =>
    set((state) =>
      state.phase === 'succeeded' || state.phase === 'failed'
        ? { phase: 'planning', outcome: null, completedRun: null }
        : state,
    ),

  resolve: (outcome) =>
    set((state) => {
      if (state.phase !== 'running') return state;

      if (outcome.status !== 'success') {
        return {
          phase: 'failed',
          outcome,
          completedRun: null,
        };
      }

      const level =
        state.activeSession.kind === 'daily'
          ? getLevelVersion(
              state.activeLevelId,
              state.activeSession.challenge.levelVersion,
            )
          : getCampaignLevel(state.activeLevelId);
      const metrics: RunMetrics = Object.freeze({
        threadUsed: calculateThreadUsed(state.stitches),
        stitchesUsed: state.stitches.length,
        completionMs: outcome.completionMs,
        collectedPatch:
          Boolean(level.collectible) &&
          outcome.collectedPatchId === level.collectible?.id,
      });
      const replay = createLevelReplay(level, state.stitches);
      const scoredRun = scoreRun(metrics, level.targetThreadUsage);
      if (state.activeSession.kind === 'daily') {
        const challenge = state.activeSession.challenge;
        const priorBest =
          useDailyChallengeStore.getState().personalBest?.challengeId ===
          challenge.id
            ? useDailyChallengeStore.getState().personalBest
            : null;
        const isNewBest =
          !priorBest || compareDailyMetrics(metrics, priorBest.metrics) < 0;
        const bestMetrics = isNewBest ? metrics : priorBest.metrics;
        void useDailyChallengeStore
          .getState()
          .submitCompletedReplay(challenge, replay);

        return {
          phase: 'succeeded',
          outcome,
          completedRun: {
            session: state.activeSession,
            levelId: level.id,
            replay,
            outcome: Object.freeze({ ...outcome }),
            isNewBest,
            scoredRun,
            bestMetrics,
          },
          bestRun: bestMetrics,
        };
      }

      const priorBest =
        useCampaignProgressStore.getState().progressByLevel[level.id]?.bestRun ??
        null;
      const durableBest = useCampaignProgressStore
        .getState()
        .recordRun(level.id, metrics, level.targetThreadUsage);

      return {
        phase: 'succeeded',
        outcome,
        completedRun: {
          session: CAMPAIGN_SESSION,
          levelId: level.id,
          replay,
          outcome: Object.freeze({ ...outcome }),
          isNewBest: scoredRunsDiffer(priorBest, durableBest),
          scoredRun,
          bestMetrics: durableBest.metrics,
        },
        bestRun: durableBest.metrics,
      };
    }),

  resetSession: () => {
    const { activeLevelId, activeSession } = get();
    const durableBest =
      activeSession.kind === 'daily'
        ? useDailyChallengeStore.getState().personalBest?.metrics ?? null
        : useCampaignProgressStore.getState().progressByLevel[activeLevelId]
            ?.bestRun?.metrics ?? null;
    set({
      phase: 'planning',
      stitches: [],
      outcome: null,
      completedRun: null,
      bestRun: durableBest,
    });
  },
}));

export const selectThreadUsed = (state: GameStore): number =>
  calculateThreadUsed(state.stitches);

export const resetGameStoreForTests = (): void => {
  useCampaignProgressStore.setState({ progressByLevel: {} });
  useGameStore.setState({
    activeLevelId: FIRST_LEVEL_ID,
    activeSession: CAMPAIGN_SESSION,
    phase: 'planning',
    stitches: [],
    outcome: null,
    completedRun: null,
    bestRun: null,
  });
};
