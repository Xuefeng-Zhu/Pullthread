import type { LaunchPocket, LaunchRoom, LaunchState } from './types';

export const BOUNCE_PATCH_LENGTH = 72;
export const BOUNCE_PATCH_THICKNESS = 12;
export const BOUNCE_PATCH_RESTITUTION = 0.98;
export const STITCH_POCKET_WIDTH = 80;
export const VELCRO_CAPTURE_HEIGHT = 28;
export const SAIL_GRAVITY_SCALE = 0.35;
export const SAIL_TERMINAL_SPEED = 180;

export function effectiveToolTick(id: string, tick: number, state?: LaunchState): number {
  'worklet';
  const pin = state?.toolEffects?.pin;
  return (pin?.targetId === id ? pin.startedTick : tick) - (state?.toolPhaseOffsets?.[id] ?? 0);
}

export function effectivePockets(room: LaunchRoom, state: LaunchState): readonly LaunchPocket[] {
  'worklet';
  return state.stitchedPocket ? [...room.pockets, state.stitchedPocket.pocket] : room.pockets;
}

export function clearFlightToolEffects(state: LaunchState): void {
  const pin = state.toolEffects?.pin;
  if (pin) {
    state.toolPhaseOffsets ??= {};
    state.toolPhaseOffsets[pin.targetId] = (state.toolPhaseOffsets[pin.targetId] ?? 0) + state.tick - pin.startedTick;
  }
  state.toolEffects = undefined;
}

export function pruneToolPhaseOffsets(room: LaunchRoom, state: LaunchState): void {
  if (!state.toolPhaseOffsets) return;
  const ids = new Set([...room.pockets, ...room.hazards, ...room.barriers ?? []].map((item) => item.id));
  state.toolPhaseOffsets = Object.fromEntries(Object.entries(state.toolPhaseOffsets).filter(([id]) => ids.has(id)));
}

/** Exact vertical integration across an apex and the sail's terminal descent. */
export function integrateFlightVertical(velocity: number, seconds: number, gravity: number, sail = false): { distance: number; velocity: number } {
  'worklet';
  if (!sail || gravity <= 0) return { distance: velocity * seconds + gravity * seconds * seconds / 2, velocity: velocity + gravity * seconds };
  let distance = 0, remaining = seconds, vy = velocity;
  if (vy < 0) {
    const ascent = Math.min(remaining, -vy / gravity);
    distance += vy * ascent + gravity * ascent * ascent / 2;
    vy += gravity * ascent;
    remaining -= ascent;
  }
  if (remaining > 0) {
    vy = Math.min(SAIL_TERMINAL_SPEED, Math.max(0, vy));
    const acceleration = gravity * SAIL_GRAVITY_SCALE;
    const accelerating = Math.min(remaining, (SAIL_TERMINAL_SPEED - vy) / acceleration);
    distance += vy * accelerating + acceleration * accelerating * accelerating / 2;
    vy += acceleration * accelerating;
    distance += vy * (remaining - accelerating);
  }
  return { distance, velocity: vy };
}

