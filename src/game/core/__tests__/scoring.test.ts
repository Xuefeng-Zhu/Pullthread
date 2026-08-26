import { describe, expect, test } from '@jest/globals';

import {
  calculateThreadCost,
  calculateThreadUsed,
  canAffordThread,
  compareRuns,
  mergeBestRun,
  scoreRun,
  selectBestRun,
  type RunMetrics,
} from '../scoring';
import type { Stitch } from '../types';

describe('thread scoring', () => {
  test('uses deterministic integer thread units', () => {
    expect(calculateThreadCost({ x: 0, y: 0 }, { x: 0.3, y: 0.4 })).toBe(
      50,
    );
    expect(calculateThreadCost({ x: 0.3, y: 0.4 }, { x: 0, y: 0 })).toBe(
      50,
    );
    expect(calculateThreadCost({ x: 1, y: 1 }, { x: 1, y: 1 })).toBe(0);
  });

  test('sums committed integer costs and checks the budget inclusively', () => {
    const stitch = (id: string, threadCost: number): Stitch => ({
      id,
      type: 'pinch',
      start: { x: 0, y: 0 },
      end: { x: 0, y: 0.1 },
      tension: 1,
      radius: 0.1,
      threadCost,
    });

    expect(calculateThreadUsed([stitch('a', 12), stitch('b', 23)])).toBe(35);
    expect(canAffordThread(35, 15, 50)).toBe(true);
    expect(canAffordThread(35, 16, 50)).toBe(false);
  });
});

const run = (overrides: Partial<RunMetrics> = {}): RunMetrics => ({
  threadUsed: 90,
  stitchesUsed: 2,
  completionMs: 4_000,
  collectedPatch: false,
  ...overrides,
});

describe('run scoring', () => {
  test('awards completion, inclusive target-thread, and patch thimbles', () => {
    expect(scoreRun(run({ threadUsed: 101 }), 100).thimbles).toBe(1);
    expect(scoreRun(run({ threadUsed: 100 }), 100).thimbles).toBe(2);
    expect(
      scoreRun(run({ threadUsed: 100, collectedPatch: true }), 100).thimbles,
    ).toBe(3);
    expect(
      scoreRun(run({ threadUsed: 101, collectedPatch: true }), 100).thimbles,
    ).toBe(2);
  });

  test('rejects invalid metrics and targets instead of producing unstable scores', () => {
    expect(() => scoreRun(run({ threadUsed: -1 }), 100)).toThrow(RangeError);
    expect(() => scoreRun(run({ stitchesUsed: 1.5 }), 100)).toThrow(
      RangeError,
    );
    expect(() => scoreRun(run({ completionMs: Number.NaN }), 100)).toThrow(
      RangeError,
    );
    expect(() =>
      scoreRun(run({ collectedPatch: 'yes' as unknown as boolean }), 100),
    ).toThrow(TypeError);
    expect(() => scoreRun(run(), -1)).toThrow(RangeError);
  });

  test('orders by thimbles, then thread, stitches, and completion time', () => {
    const baseline = scoreRun(run(), 100);

    expect(
      compareRuns(scoreRun(run({ collectedPatch: true }), 100), baseline),
    ).toBeLessThan(0);
    expect(
      compareRuns(scoreRun(run({ threadUsed: 80 }), 100), baseline),
    ).toBeLessThan(0);
    expect(
      compareRuns(scoreRun(run({ stitchesUsed: 1 }), 100), baseline),
    ).toBeLessThan(0);
    expect(
      compareRuns(scoreRun(run({ completionMs: 3_999 }), 100), baseline),
    ).toBeLessThan(0);
    expect(compareRuns(scoreRun(run(), 100), baseline)).toBe(0);
  });

  test('keeps the incumbent on a tie and selects a better candidate', () => {
    const incumbent = scoreRun(run(), 100);
    const tie = scoreRun(run(), 100);
    const better = scoreRun(run({ completionMs: 3_000 }), 100);

    expect(selectBestRun(tie, incumbent)).toBe(incumbent);
    expect(selectBestRun(better, incumbent)).toBe(better);
  });

  test('merges achievements without losing the better performance metrics', () => {
    const patchRun = scoreRun(
      run({
        threadUsed: 110,
        stitchesUsed: 3,
        completionMs: 5_000,
        collectedPatch: true,
      }),
      100,
    );
    const threadRun = scoreRun(
      run({ threadUsed: 80, stitchesUsed: 2, completionMs: 4_000 }),
      100,
    );

    expect(mergeBestRun(threadRun, patchRun)).toEqual({
      metrics: {
        threadUsed: 80,
        stitchesUsed: 2,
        completionMs: 4_000,
        collectedPatch: true,
      },
      thimbles: 3,
    });
    expect(patchRun.metrics.collectedPatch).toBe(true);
    expect(threadRun.metrics.collectedPatch).toBe(false);
  });
});
