import { distanceSquared } from './geometry';
import type { Point, Stitch } from './types';

export const THREAD_UNITS_PER_WORLD_UNIT = 100;

const INTEGER_BOUNDARY_EPSILON = 1e-9;

export function calculateThreadCost(
  start: Point,
  end: Point,
  unitsPerWorldUnit = THREAD_UNITS_PER_WORLD_UNIT,
): number {
  if (!Number.isFinite(unitsPerWorldUnit) || unitsPerWorldUnit <= 0) {
    throw new RangeError('Thread-unit scale must be a positive finite number.');
  }

  const length = Math.sqrt(distanceSquared(start, end));
  return Math.max(
    0,
    Math.ceil(length * unitsPerWorldUnit - INTEGER_BOUNDARY_EPSILON),
  );
}

export function calculateThreadUsed(stitches: readonly Stitch[]): number {
  let total = 0;

  for (const stitch of stitches) {
    if (!Number.isInteger(stitch.threadCost) || stitch.threadCost < 0) {
      throw new RangeError('Committed stitch costs must be non-negative integers.');
    }
    total += stitch.threadCost;
  }

  return total;
}

export function canAffordThread(
  used: number,
  nextCost: number,
  budget: number,
): boolean {
  return (
    Number.isInteger(used) &&
    Number.isInteger(nextCost) &&
    Number.isInteger(budget) &&
    used >= 0 &&
    nextCost >= 0 &&
    budget >= 0 &&
    used + nextCost <= budget
  );
}
