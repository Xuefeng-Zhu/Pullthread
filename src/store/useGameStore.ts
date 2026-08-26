import { create } from 'zustand';

import {
  calculateThreadUsed,
  type RunMetrics,
  type ScoredRun,
} from '../game/core/scoring';
import type {
  SimulationOutcome,
  SimulationPhase,
  Stitch,
} from '../game/core/types';
import { CAMPAIGN_LEVELS } from '../game/levels/campaignLevels';
import { getCampaignLevel } from '../game/levels/levelLoader';
import {
  createLevelReplay,
  type LevelReplayV1,
} from '../game/replay';
import { useCampaignProgressStore } from './useCampaignProgressStore';

export interface CompletedRun {
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
  phase: SimulationPhase;
  stitches: Stitch[];
  outcome: SimulationOutcome | null;
  completedRun: CompletedRun | null;
  /** Process-local mirror of the active level's durable best metrics. */
  bestRun: RunMetrics | null;
  startLevel: (levelId: string) => void;
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
  phase: 'planning',
  stitches: [],
  outcome: null,
  completedRun: null,
  bestRun: null,

  startLevel: (levelId) => {
    getCampaignLevel(levelId);
    const durableBest =
      useCampaignProgressStore.getState().progressByLevel[levelId]?.bestRun ??
      null;
    set({
      activeLevelId: levelId,
      phase: 'planning',
      stitches: [],
      outcome: null,
      completedRun: null,
      bestRun: durableBest?.metrics ?? null,
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

      const level = getCampaignLevel(state.activeLevelId);
      const metrics: RunMetrics = Object.freeze({
        threadUsed: calculateThreadUsed(state.stitches),
        stitchesUsed: state.stitches.length,
        completionMs: outcome.completionMs,
        collectedPatch:
          Boolean(level.collectible) &&
          outcome.collectedPatchId === level.collectible?.id,
      });
      const priorBest =
        useCampaignProgressStore.getState().progressByLevel[level.id]?.bestRun ??
        null;
      const scoredRun = useCampaignProgressStore
        .getState()
        .recordRun(level.id, metrics, level.targetThreadUsage);

      return {
        phase: 'succeeded',
        outcome,
        completedRun: {
          levelId: level.id,
          replay: createLevelReplay(level, state.stitches),
          outcome: Object.freeze({ ...outcome }),
          isNewBest: scoredRunsDiffer(priorBest, scoredRun),
          scoredRun,
          bestMetrics: scoredRun.metrics,
        },
        bestRun: scoredRun.metrics,
      };
    }),

  resetSession: () => {
    const activeLevelId = get().activeLevelId;
    const durableBest =
      useCampaignProgressStore.getState().progressByLevel[activeLevelId]
        ?.bestRun ?? null;
    set({
      phase: 'planning',
      stitches: [],
      outcome: null,
      completedRun: null,
      bestRun: durableBest?.metrics ?? null,
    });
  },
}));

export const selectThreadUsed = (state: GameStore): number =>
  calculateThreadUsed(state.stitches);

export const resetGameStoreForTests = (): void => {
  useCampaignProgressStore.setState({ progressByLevel: {} });
  useGameStore.setState({
    activeLevelId: FIRST_LEVEL_ID,
    phase: 'planning',
    stitches: [],
    outcome: null,
    completedRun: null,
    bestRun: null,
  });
};
