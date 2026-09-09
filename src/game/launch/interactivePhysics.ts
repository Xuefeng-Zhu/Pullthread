import type { LaunchBarrier, LaunchPoint, LaunchRoom, LaunchState } from './types';
import { effectiveToolTick } from './toolEffects';

export const SHUTTER_PERIOD_TICKS = 480;

export function shutterPhase(barrier: LaunchBarrier, tick: number, state?: LaunchState): 'open' | 'warning' | 'closed' {
  'worklet';
  tick = effectiveToolTick(barrier.id, tick, state);
  const phase = ((tick + (barrier.phaseTicks ?? 0)) % SHUTTER_PERIOD_TICKS + SHUTTER_PERIOD_TICKS) % SHUTTER_PERIOD_TICKS;
  return phase < 240 ? 'open' : phase < 330 ? 'warning' : 'closed';
}

export function barrierIsActive(barrier: LaunchBarrier, room: LaunchRoom, state: LaunchState, tick: number): boolean {
  'worklet';
  if (barrier.kind === 'tearable') return !state.brokenBarrierIds?.includes(barrier.id);
  if (barrier.kind === 'door') return !room.switches?.some((sensor) =>
    sensor.doorIds.includes(barrier.id) && state.activatedSwitchIds?.includes(sensor.id));
  return barrier.kind !== 'shutter' || shutterPhase(barrier, tick, state) === 'closed';
}

/** Swept disc against an oriented capsule, including rounded end caps. */
export function sweepCircleCapsule(start: LaunchPoint, end: LaunchPoint,
  capsule: { position: LaunchPoint; angle: number; length: number; thickness: number }, radius: number,
  captureInitialOverlap = false): RectangleContact | undefined {
  'worklet';
  const angle = capsule.angle * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  const local = (point: LaunchPoint) => ({ x: (point.x - capsule.position.x) * c + (point.y - capsule.position.y) * s,
    y: -(point.x - capsule.position.x) * s + (point.y - capsule.position.y) * c });
  const a = local(start), b = local(end), dx = b.x - a.x, dy = b.y - a.y;
  const half = (capsule.length - capsule.thickness) / 2, r = capsule.thickness / 2 + radius;
  let best: { time: number; normal: LaunchPoint; position: LaunchPoint } | undefined;
  const consider = (time: number, normal: LaunchPoint, position?: LaunchPoint) => {
    if (time < 0 || time > 1 || (best && time >= best.time) || dx * normal.x + dy * normal.y >= 0) return;
    best = { time, normal, position: position ?? { x: a.x + dx * time, y: a.y + dy * time } };
  };
  const nearX = Math.max(-half, Math.min(half, a.x)), ox = a.x - nearX;
  const initialDistance = Math.hypot(ox, a.y);
  if (initialDistance <= r) {
    const normal = initialDistance > 1e-8 ? { x: ox / initialDistance, y: a.y / initialDistance }
      : { x: 0, y: dy > 0 ? -1 : 1 };
    const position = { x: nearX + normal.x * r, y: normal.y * r };
    if (captureInitialOverlap) best = { time: 0, normal, position };
    else consider(0, normal, position);
  }
  if (dy !== 0) for (const side of [-1, 1]) {
    const time = (side * r - a.y) / dy;
    const x = a.x + dx * time;
    if (x >= -half && x <= half) consider(time, { x: 0, y: side });
  }
  const magnitude = dx * dx + dy * dy;
  if (magnitude > 1e-12) for (const side of [-1, 1]) {
    const centerX = side * half, offsetX = a.x - centerX;
    const qb = 2 * (offsetX * dx + a.y * dy), qc = offsetX * offsetX + a.y * a.y - r * r;
    const discriminant = qb * qb - 4 * magnitude * qc;
    if (discriminant < 0) continue;
    const time = (-qb - Math.sqrt(discriminant)) / (2 * magnitude);
    const x = a.x + dx * time - centerX, y = a.y + dy * time;
    if (side * x >= -1e-8) consider(time, { x: x / r, y: y / r });
  }
  if (!best) return undefined;
  const hit = best as RectangleContact;
  return { time: hit.time,
    normal: { x: hit.normal.x * c - hit.normal.y * s, y: hit.normal.x * s + hit.normal.y * c },
    position: { x: capsule.position.x + hit.position.x * c - hit.position.y * s,
      y: capsule.position.y + hit.position.x * s + hit.position.y * c } };
}

export interface RectangleContact {
  readonly time: number;
  readonly normal: LaunchPoint;
  /** Circle center at the resolved surface, including initial penetration. */
  readonly position: LaunchPoint;
}

/** Exact swept disc against a rectangle: flat faces plus rounded corner arcs. */
export function sweepCircleRectangle(start: LaunchPoint, end: LaunchPoint,
  rectangle: Pick<LaunchBarrier, 'x' | 'y' | 'width' | 'height'>, radius: number): RectangleContact | undefined {
  const left = rectangle.x, right = left + rectangle.width;
  const top = rectangle.y, bottom = top + rectangle.height;
  const dx = end.x - start.x, dy = end.y - start.y;
  const nearX = Math.max(left, Math.min(right, start.x));
  const nearY = Math.max(top, Math.min(bottom, start.y));
  const offsetX = start.x - nearX, offsetY = start.y - nearY;
  const distance = Math.hypot(offsetX, offsetY);
  if (distance <= radius) {
    if (distance > 1e-8) {
      const normal = { x: offsetX / distance, y: offsetY / distance };
      return { time: 0, normal, position: { x: nearX + normal.x * radius, y: nearY + normal.y * radius } };
    }
    const faces = [
      { distance: start.x - left, normal: { x: -1, y: 0 }, position: { x: left - radius, y: start.y } },
      { distance: right - start.x, normal: { x: 1, y: 0 }, position: { x: right + radius, y: start.y } },
      { distance: start.y - top, normal: { x: 0, y: -1 }, position: { x: start.x, y: top - radius } },
      { distance: bottom - start.y, normal: { x: 0, y: 1 }, position: { x: start.x, y: bottom + radius } },
    ];
    const face = faces.reduce((best, next) => next.distance < best.distance ? next : best);
    return { time: 0, normal: face.normal, position: face.position };
  }
  let best: RectangleContact | undefined;
  const consider = (time: number, normal: LaunchPoint) => {
    if (time < 0 || time > 1 || (best && time >= best.time) || dx * normal.x + dy * normal.y >= 0) return;
    best = { time, normal, position: { x: start.x + dx * time, y: start.y + dy * time } };
  };
  if (dx !== 0) for (const [x, sign] of [[left - radius, -1], [right + radius, 1]]) {
    const time = (x - start.x) / dx;
    const y = start.y + dy * time;
    if (y >= top && y <= bottom) consider(time, { x: sign, y: 0 });
  }
  if (dy !== 0) for (const [y, sign] of [[top - radius, -1], [bottom + radius, 1]]) {
    const time = (y - start.y) / dy;
    const x = start.x + dx * time;
    if (x >= left && x <= right) consider(time, { x: 0, y: sign });
  }
  const a = dx * dx + dy * dy;
  if (a > 1e-12) for (const [x, sx] of [[left, -1], [right, 1]]) for (const [y, sy] of [[top, -1], [bottom, 1]]) {
    const ox = start.x - x, oy = start.y - y;
    const b = 2 * (ox * dx + oy * dy);
    const c = ox * ox + oy * oy - radius * radius;
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) continue;
    const time = (-b - Math.sqrt(discriminant)) / (2 * a);
    const px = start.x + dx * time - x, py = start.y + dy * time - y;
    if (px * sx >= -1e-8 && py * sy >= -1e-8) consider(time, { x: px / radius, y: py / radius });
  }
  return best;
}
