import { create } from 'zustand';

import type {
  SimulationOutcome,
  SimulationPhase,
  Stitch,
} from '../game/core/types';

interface CommitLimits {
  readonly maxStitches: number;
  readonly threadBudget: number;
}

interface GameStore {
  phase: SimulationPhase;
  stitches: Stitch[];
  outcome: SimulationOutcome | null;
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

export const useGameStore = create<GameStore>((set, get) => ({
  phase: 'planning',
  stitches: [],
  outcome: null,

  commitStitch: (stitch, limits) => {
    const state = get();
    if (
      state.phase !== 'planning' ||
      state.stitches.length >= limits.maxStitches ||
      threadUsed(state.stitches) + stitch.threadCost > limits.threadBudget
    ) {
      return false;
    }

    set({ stitches: [...state.stitches, stitch], outcome: null });
    return true;
  },

  removeStitch: (id) =>
    set((state) =>
      state.phase === 'planning'
        ? { stitches: state.stitches.filter((stitch) => stitch.id !== id) }
        : state,
    ),

  undo: () =>
    set((state) =>
      state.phase === 'planning' && state.stitches.length > 0
        ? { stitches: state.stitches.slice(0, -1), outcome: null }
        : state,
    ),

  clearStitches: () =>
    set((state) =>
      state.phase === 'planning'
        ? { stitches: [], outcome: null }
        : state,
    ),

  release: () =>
    set((state) =>
      state.phase === 'planning'
        ? { phase: 'running', outcome: null }
        : state,
    ),

  retry: () =>
    set((state) =>
      state.phase === 'succeeded' || state.phase === 'failed'
        ? { phase: 'planning', outcome: null }
        : state,
    ),

  resolve: (outcome) =>
    set({
      phase: outcome.status === 'success' ? 'succeeded' : 'failed',
      outcome,
    }),

  resetSession: () => set({ phase: 'planning', stitches: [], outcome: null }),
}));

export const selectThreadUsed = (state: GameStore): number =>
  threadUsed(state.stitches);

export const resetGameStoreForTests = (): void => {
  useGameStore.setState({ phase: 'planning', stitches: [], outcome: null });
};
