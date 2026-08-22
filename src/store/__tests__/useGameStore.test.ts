import { beforeEach, describe, expect, test } from '@jest/globals';

import type { Stitch } from '../../game/core/types';
import {
  resetGameStoreForTests,
  selectThreadUsed,
  useGameStore,
} from '../useGameStore';

const STITCH: Stitch = {
  id: 'test-stitch',
  type: 'pinch',
  start: { x: 0.2, y: 0.2 },
  end: { x: 0.2, y: 0.8 },
  tension: 1,
  radius: 0.19,
  threadCost: 60,
};

describe('game planning store', () => {
  beforeEach(resetGameStoreForTests);

  test('commits and undoes a stitch without retaining thread cost', () => {
    const limits = { maxStitches: 2, threadBudget: 120 };

    expect(useGameStore.getState().commitStitch(STITCH, limits)).toBe(true);
    expect(selectThreadUsed(useGameStore.getState())).toBe(60);

    useGameStore.getState().undo();
    expect(useGameStore.getState().stitches).toHaveLength(0);
    expect(selectThreadUsed(useGameStore.getState())).toBe(0);
  });

  test('rejects a stitch beyond the thread budget', () => {
    const accepted = useGameStore.getState().commitStitch(STITCH, {
      maxStitches: 2,
      threadBudget: 50,
    });

    expect(accepted).toBe(false);
    expect(useGameStore.getState().stitches).toHaveLength(0);
  });

  test('locks edits while running and retries with stitches intact', () => {
    const limits = { maxStitches: 2, threadBudget: 120 };
    useGameStore.getState().commitStitch(STITCH, limits);
    useGameStore.getState().release();
    useGameStore.getState().undo();

    expect(useGameStore.getState().phase).toBe('running');
    expect(useGameStore.getState().stitches).toHaveLength(1);

    useGameStore.getState().resolve({
      status: 'failure',
      reason: 'stuck',
      tick: 180,
      completionMs: 1500,
    });
    useGameStore.getState().retry();

    expect(useGameStore.getState()).toMatchObject({
      phase: 'planning',
      stitches: [STITCH],
      outcome: null,
    });
  });
});
