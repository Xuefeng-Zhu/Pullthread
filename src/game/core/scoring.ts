import { distanceSquared } from './geometry';
import type { Point, Stitch } from './types';

export const THREAD_UNITS_PER_WORLD_UNIT = 100;

export interface RunMetrics {
  readonly threadUsed: number;
  readonly stitchesUsed: number;
  readonly completionMs: number;
  readonly collectedPatch: boolean;
}

export type ThimbleCount = 1 | 2 | 3;

export interface ScoredRun {
  readonly metrics: RunMetrics;
  readonly thimbles: ThimbleCount;
}

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

function assertNonNegativeSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer.`);
  }
}

function normalizedRunMetrics(metrics: RunMetrics): RunMetrics {
  assertNonNegativeSafeInteger(metrics.threadUsed, 'Thread used');
  assertNonNegativeSafeInteger(metrics.stitchesUsed, 'Stitches used');
  assertNonNegativeSafeInteger(metrics.completionMs, 'Completion time');

  if (typeof metrics.collectedPatch !== 'boolean') {
    throw new TypeError('Collected-patch state must be a boolean.');
  }

  return Object.freeze({ ...metrics });
}

/**
 * Scores a successful run. Completion earns the first thimble, meeting the
 * inclusive thread target earns the second, and collecting the patch earns
 * the third.
 */
export function scoreRun(
  metrics: RunMetrics,
  targetThreadUsage: number,
): ScoredRun {
  assertNonNegativeSafeInteger(targetThreadUsage, 'Target thread usage');
  const normalizedMetrics = normalizedRunMetrics(metrics);
  const thimbles = (1 +
    Number(normalizedMetrics.threadUsed <= targetThreadUsage) +
    Number(normalizedMetrics.collectedPatch)) as ThimbleCount;

  return Object.freeze({
    metrics: normalizedMetrics,
    thimbles,
  });
}

/**
 * Standard ascending comparator: a negative result means `left` ranks ahead.
 * Runs rank by thimbles descending, then thread, stitches, and time ascending.
 */
export function compareRuns(left: ScoredRun, right: ScoredRun): number {
  return (
    right.thimbles - left.thimbles ||
    left.metrics.threadUsed - right.metrics.threadUsed ||
    left.metrics.stitchesUsed - right.metrics.stitchesUsed ||
    left.metrics.completionMs - right.metrics.completionMs
  );
}

/** Keeps the incumbent on an exact tie so recording the same run is stable. */
export function selectBestRun(
  candidate: ScoredRun,
  incumbent: ScoredRun | null,
): ScoredRun {
  return !incumbent || compareRuns(candidate, incumbent) < 0
    ? candidate
    : incumbent;
}

function earnedThreadThimble(run: ScoredRun): boolean {
  const completionAndPatch = 1 + Number(run.metrics.collectedPatch);
  return run.thimbles > completionAndPatch;
}

/**
 * Combines durable per-level progress. Performance metrics come from the
 * better-ranked run while thread-target and patch achievements are cumulative,
 * so collecting a patch is never lost to a later, otherwise better run.
 */
export function mergeBestRun(
  candidate: ScoredRun,
  incumbent: ScoredRun | null,
): ScoredRun {
  if (!incumbent) return candidate;

  const winner = selectBestRun(candidate, incumbent);
  const collectedPatch =
    candidate.metrics.collectedPatch || incumbent.metrics.collectedPatch;
  const threadThimble =
    earnedThreadThimble(candidate) || earnedThreadThimble(incumbent);
  const thimbles = (1 +
    Number(threadThimble) +
    Number(collectedPatch)) as ThimbleCount;

  if (
    winner.metrics.collectedPatch === collectedPatch &&
    winner.thimbles === thimbles
  ) {
    return winner;
  }

  return Object.freeze({
    metrics: Object.freeze({ ...winner.metrics, collectedPatch }),
    thimbles,
  });
}
