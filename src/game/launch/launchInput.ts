import { clampPull } from './simulation';
import type { LaunchPoint } from './types';

/** Shared by touch input and authoring checks: zero stays zero near every edge. */
export function clampEndlessPull(pull: LaunchPoint, anchor: LaunchPoint, cameraY: number,
  bounds: { readonly width: number; readonly height: number }): LaunchPoint {
  const limited = clampPull(pull);
  return {
    x: Math.max(Math.min(0, 12 - anchor.x),
      Math.min(Math.max(0, bounds.width - 12 - anchor.x), limited.x)),
    y: Math.max(Math.min(0, cameraY + 12 - anchor.y),
      Math.min(Math.max(0, cameraY + bounds.height - 12 - anchor.y), limited.y)),
  };
}
