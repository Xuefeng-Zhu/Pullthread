import type { Point, Rect } from '../core/types';
import type { CanvasSize } from '../input/stitchGesture';

export function toCanvasPoint(
  point: Point,
  size: CanvasSize,
  bounds: Rect,
): Point {
  return {
    x: ((point.x - bounds.x) / bounds.width) * size.width,
    y: ((point.y - bounds.y) / bounds.height) * size.height,
  };
}

export function worldRadiusToPixels(
  radius: number,
  size: CanvasSize,
  bounds: Rect,
): number {
  return (
    radius *
    Math.min(size.width / bounds.width, size.height / bounds.height)
  );
}
