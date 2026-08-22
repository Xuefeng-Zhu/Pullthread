import { describe, expect, test } from '@jest/globals';

import {
  calculateThreadCost,
  calculateThreadUsed,
  canAffordThread,
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
