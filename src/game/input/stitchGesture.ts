import {
  clamp,
  distancePointToSegmentSquared,
  distanceSquared,
  quantizePoint,
} from '../core/geometry';
import { calculateThreadCost } from '../core/scoring';
import type { Point, Rect, Stitch } from '../core/types';

export const MINIMUM_STITCH_LENGTH = 0.12;
export const SPIKE_STITCH_RADIUS = 0.19;

export interface CanvasSize {
  readonly width: number;
  readonly height: number;
}

export function viewPointToFabric(
  point: Point,
  canvas: CanvasSize,
  bounds: Rect,
): Point {
  if (canvas.width <= 0 || canvas.height <= 0) {
    return { x: bounds.x, y: bounds.y };
  }

  return {
    x:
      bounds.x +
      clamp(point.x / canvas.width, 0, 1) * bounds.width,
    y:
      bounds.y +
      clamp(point.y / canvas.height, 0, 1) * bounds.height,
  };
}

export function fabricPointToView(
  point: Point,
  canvas: CanvasSize,
  bounds: Rect,
): Point {
  return {
    x: ((point.x - bounds.x) / bounds.width) * canvas.width,
    y: ((point.y - bounds.y) / bounds.height) * canvas.height,
  };
}

export function isValidStitchDrag(start: Point, end: Point): boolean {
  return distanceSquared(start, end) >= MINIMUM_STITCH_LENGTH ** 2;
}

export function createPinchStitch(
  id: string,
  start: Point,
  end: Point,
): Stitch {
  const quantizedStart = quantizePoint(start);
  const quantizedEnd = quantizePoint(end);

  return {
    id,
    type: 'pinch',
    start: quantizedStart,
    end: quantizedEnd,
    tension: 1,
    radius: SPIKE_STITCH_RADIUS,
    threadCost: calculateThreadCost(quantizedStart, quantizedEnd),
  };
}

/** Creates only a stitch that remains valid after canonical quantization. */
export function createValidPinchStitch(
  id: string,
  start: Point,
  end: Point,
): Stitch | null {
  const stitch = createPinchStitch(id, start, end);
  return isValidStitchDrag(stitch.start, stitch.end) ? stitch : null;
}

export function findStitchNearPoint(
  stitches: readonly Stitch[],
  point: Point,
  tolerance = 0.08,
): Stitch | null {
  const threshold = tolerance * tolerance;
  let nearestStitch: Stitch | null = null;
  let nearestDistance = threshold;

  for (let index = stitches.length - 1; index >= 0; index -= 1) {
    const stitch = stitches[index];
    const distance = distancePointToSegmentSquared(
      point.x,
      point.y,
      stitch.start.x,
      stitch.start.y,
      stitch.end.x,
      stitch.end.y,
    );
    if (
      distance <= threshold &&
      (nearestStitch === null || distance < nearestDistance)
    ) {
      nearestStitch = stitch;
      nearestDistance = distance;
    }
  }

  return nearestStitch;
}
