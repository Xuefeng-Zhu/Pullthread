import type { Point, Rect } from './types';

const DEFAULT_POINT_QUANTUM = 1 / 4096;

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function smoothstep01(value: number): number {
  const clamped = clamp(value, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}

export function distanceSquared(a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return dx * dx + dy * dy;
}

export function closestSegmentParameter(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const segmentX = bx - ax;
  const segmentY = by - ay;
  const lengthSquared = segmentX * segmentX + segmentY * segmentY;

  if (lengthSquared === 0) {
    return 0;
  }

  return clamp(
    ((px - ax) * segmentX + (py - ay) * segmentY) / lengthSquared,
    0,
    1,
  );
}

export function distancePointToSegmentSquared(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const parameter = closestSegmentParameter(px, py, ax, ay, bx, by);
  const closestX = ax + (bx - ax) * parameter;
  const closestY = ay + (by - ay) * parameter;
  const dx = px - closestX;
  const dy = py - closestY;
  return dx * dx + dy * dy;
}

export function circleInsideRect(
  x: number,
  y: number,
  radius: number,
  bounds: Rect,
): boolean {
  return (
    x - radius >= bounds.x &&
    x + radius <= bounds.x + bounds.width &&
    y - radius >= bounds.y &&
    y + radius <= bounds.y + bounds.height
  );
}

export function quantizePoint(
  point: Point,
  quantum = DEFAULT_POINT_QUANTUM,
): Point {
  if (!Number.isFinite(quantum) || quantum <= 0) {
    throw new RangeError('Point quantum must be a positive finite number.');
  }

  return {
    x: Math.round(point.x / quantum) * quantum,
    y: Math.round(point.y / quantum) * quantum,
  };
}
