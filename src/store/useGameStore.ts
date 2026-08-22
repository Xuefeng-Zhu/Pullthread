import { create } from 'zustand';

import type {
  SimulationOutcome,
  SimulationPhase,
  Stitch,
} from '../game/core/types';
import {
  createSpikeReplay,
  type SpikeReplayV1,
} from '../game/replay';

export interface CompletedRun {
  readonly replay: SpikeReplayV1;
  readonly outcome: Extract<SimulationOutcome, { status: 'success' }>;
  readonly isNewBest: boolean;
  readonly bestMetrics: RunMetrics;
}

export interface RunMetrics {
  readonly threadUsed: number;
  readonly stitchesUsed: number;
  readonly completionMs: number;
}

interface CommitLimits {
  readonly maxStitches: number;
  readonly threadBudget: number;
}

interface GameStore {
  phase: SimulationPhase;
  stitches: Stitch[];
  outcome: SimulationOutcome | null;
  completedRun: CompletedRun | null;
  bestRun: RunMetrics | null;
  commitStitch: (stitch: Stitch, limits: CommitLimits) => boolean;
  removeStitch: (id: string) => void;
  undo: () => void;
  clearStitches: () => void;
  release: () => void;
  retry: () => void;
  resolve: (outcome: SimulationOutcome) => void;
  resetSession: () => void;
}

function threadUsed(stitches: readonly Stitch[]): number {
  return stitches.reduce((total, stitch) => total + stitch.threadCost, 0);
}

function isBetterRun(candidate: RunMetrics, best: RunMetrics | null): boolean {
  if (!best) return true;

  return (
    candidate.threadUsed < best.threadUsed ||
    (candidate.threadUsed === best.threadUsed &&
      (candidate.stitchesUsed < best.stitchesUsed ||
        (candidate.stitchesUsed === best.stitchesUsed &&
          candidate.completionMs < best.completionMs)))
  );
}

export const useGameStore = create<GameStore>((set, get) => ({
  phase: 'planning',
  stitches: [],
  outcome: null,
  completedRun: null,
  bestRun: null,

  commitStitch: (stitch, limits) => {
    const state = get();
    if (
      state.phase !== 'planning' ||
      state.stitches.length >= limits.maxStitches ||
      threadUsed(state.stitches) + stitch.threadCost > limits.threadBudget
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

      const metrics: RunMetrics = {
        threadUsed: threadUsed(state.stitches),
        stitchesUsed: state.stitches.length,
        completionMs: outcome.completionMs,
      };
      const isNewBest = isBetterRun(metrics, state.bestRun);
      const bestMetrics = isNewBest ? metrics : state.bestRun;

      if (!bestMetrics) {
        throw new Error('A successful run must produce best-result metrics.');
      }

      return {
        phase: 'succeeded',
        outcome,
        completedRun: {
          replay: createSpikeReplay(state.stitches),
          outcome: Object.freeze({ ...outcome }),
          isNewBest,
          bestMetrics: Object.freeze({ ...bestMetrics }),
        },
        bestRun: isNewBest ? Object.freeze({ ...metrics }) : state.bestRun,
      };
    }),

  resetSession: () =>
    set({
      phase: 'planning',
      stitches: [],
      outcome: null,
      completedRun: null,
    }),
}));

export const selectThreadUsed = (state: GameStore): number =>
  threadUsed(state.stitches);

export const resetGameStoreForTests = (): void => {
  useGameStore.setState({
    phase: 'planning',
    stitches: [],
    outcome: null,
    completedRun: null,
    bestRun: null,
  });
};
