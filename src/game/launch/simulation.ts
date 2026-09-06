import type {
  LaunchClock,
  LaunchEvent,
  LaunchFailure,
  LaunchInput,
  LaunchPocket,
  LaunchPoint,
  LaunchRoom,
  LaunchState,
} from './types';

export const LAUNCH_HZ = 120;
export const LAUNCH_STEP_SECONDS = 1 / LAUNCH_HZ;
export const BUTTON_RADIUS = 10;
export const MAX_PULL = 100;
export const MIN_PULL = 8;
export const LAUNCH_POWER = 7.5;
export const MAX_FLIGHT_TICKS = LAUNCH_HZ * 8;
const EPSILON = 1e-8;
const MAX_CONTACTS_PER_STEP = 8;
/** A slow foreground frame cannot accumulate a seconds-long simulation backlog. */
export const MAX_FRAME_SECONDS = 0.1;

export function pocketPosition(pocket: LaunchPocket, tick: number): LaunchPoint {
  'worklet';
  const { motion } = pocket;
  return {
    x:
      pocket.center.x +
      (motion && motion.periodTicks > 0
        ? Math.sin(((tick + motion.phaseTicks) / motion.periodTicks) * Math.PI * 2) *
          motion.amplitude
        : 0),
    y: pocket.center.y,
  };
}

/** Quantize valid input before limiting its length, so replay inputs have one interpretation. */
export function clampPull(pull: LaunchPoint): LaunchPoint {
  'worklet';
  if (!Number.isFinite(pull.x) || !Number.isFinite(pull.y)) return { x: 0, y: 0 };
  const x = Math.round(pull.x * 100) / 100;
  const y = Math.round(pull.y * 100) / 100;
  const length = Math.hypot(x, y);
  if (!Number.isFinite(length)) return { x: 0, y: 0 };
  const scale = length > MAX_PULL ? MAX_PULL / length : 1;
  return { x: x * scale, y: y * scale };
}

function findPocket(room: LaunchRoom, id: string): LaunchPocket {
  const pocket = room.pockets.find((candidate) => candidate.id === id);
  if (!pocket) throw new Error(`Launch room ${room.id} has no pocket ${id}`);
  return pocket;
}

export function createLaunchState(room: LaunchRoom): LaunchState {
  const position = pocketPosition(findPocket(room, room.startPocketId), 0);
  return {
    tick: 0,
    phase: 'held',
    position,
    previousPosition: { ...position },
    velocity: { x: 0, y: 0 },
    pocketId: room.startPocketId,
    checkpoint: { pocketId: room.startPocketId, tick: 0, patchCollected: false },
    patchCollected: false,
    flightTicks: 0,
    launches: 0,
    sourcePocketImmune: true,
  };
}

/** A cancelled gesture calls no simulation operation; a tap is rejected without mutation. */
export function launch(room: LaunchRoom, state: LaunchState, input: LaunchInput): boolean {
  if (
    state.phase !== 'held' ||
    !Number.isInteger(input.tick) ||
    input.tick !== state.tick ||
    input.pocketId !== state.pocketId
  ) return false;
  const pull = clampPull(input.pull);
  if (Math.hypot(pull.x, pull.y) < MIN_PULL) return false;
  const anchor = pocketPosition(findPocket(room, state.pocketId), state.tick);
  state.position = { x: anchor.x + pull.x, y: anchor.y + pull.y };
  state.previousPosition = { ...state.position };
  state.velocity = { x: -pull.x * LAUNCH_POWER, y: -pull.y * LAUNCH_POWER };
  state.phase = 'flying';
  state.flightTicks = 0;
  state.launches += 1;
  state.sourcePocketImmune = true;
  state.failure = undefined;
  state.event = { type: 'launch', tick: state.tick, id: state.pocketId };
  return true;
}

export function retryFromCheckpoint(room: LaunchRoom, state: LaunchState): void {
  state.tick = state.checkpoint.tick;
  state.pocketId = state.checkpoint.pocketId;
  state.patchCollected = state.checkpoint.patchCollected;
  state.position = pocketPosition(findPocket(room, state.pocketId), state.tick);
  state.previousPosition = { ...state.position };
  state.velocity = { x: 0, y: 0 };
  state.phase = 'held';
  state.flightTicks = 0;
  state.sourcePocketImmune = true;
  state.event = undefined;
  state.failure = undefined;
}

/** Earliest segment/circle entry, including an initial overlap. */
function circleContact(start: LaunchPoint, end: LaunchPoint, center: LaunchPoint, radius: number): number | undefined {
  const offsetX = start.x - center.x;
  const offsetY = start.y - center.y;
  const c = offsetX * offsetX + offsetY * offsetY - radius * radius;
  if (c <= 0) return 0;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const a = dx * dx + dy * dy;
  if (a <= EPSILON) return undefined;
  const b = 2 * (offsetX * dx + offsetY * dy);
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return undefined;
  const time = (-b - Math.sqrt(discriminant)) / (2 * a);
  return time >= 0 && time <= 1 ? time : undefined;
}

type Contact =
  | { time: number; kind: 'bumper'; index: number; key: string }
  | { time: number; kind: 'pocket'; index: number; key: string }
  | { time: number; kind: 'hazard'; index: number; key: string }
  | { time: number; kind: 'patch'; key: string }
  | { time: number; kind: 'bounds'; key: string };

/** Stable tie breaking makes authoring order irrelevant at exactly simultaneous contacts. */
function contactPriority(contact: Contact): number {
  return { hazard: 0, bounds: 1, pocket: 2, bumper: 3, patch: 4 }[contact.kind];
}

function findContact(room: LaunchRoom, state: LaunchState, start: LaunchPoint, end: LaunchPoint, tickStart: number, tickEnd: number): Contact | undefined {
  let earliest: Contact | undefined;
  function consider(candidate: Contact) {
    if (
      !earliest ||
      candidate.time < earliest.time - EPSILON ||
      (Math.abs(candidate.time - earliest.time) <= EPSILON &&
        (contactPriority(candidate) < contactPriority(earliest) ||
          (contactPriority(candidate) === contactPriority(earliest) && candidate.key < earliest.key)))
    ) earliest = candidate;
  }
  room.hazards.forEach((hazard, index) => {
    const time = circleContact(start, end, hazard.center, hazard.radius + BUTTON_RADIUS);
    if (time !== undefined) consider({ kind: 'hazard', index, time, key: hazard.id });
  });
  room.bumpers.forEach((bumper, index) => {
    const time = circleContact(start, end, bumper.center, bumper.radius + BUTTON_RADIUS);
    if (time === undefined) return;
    const x = start.x + (end.x - start.x) * time - bumper.center.x;
    const y = start.y + (end.y - start.y) * time - bumper.center.y;
    // Ignore a tangency or already-resolved surface contact travelling outward.
    if (x * (end.x - start.x) + y * (end.y - start.y) >= 0) return;
    consider({ kind: 'bumper', index, time, key: bumper.id });
  });
  if (end.y > start.y) {
    room.pockets.forEach((pocket, index) => {
      if (pocket.id === state.pocketId && state.sourcePocketImmune) return;
      const time = (pocket.center.y - start.y) / (end.y - start.y);
      if (time < 0 || time > 1) return;
      const mouth = pocketPosition(pocket, tickStart + (tickEnd - tickStart) * time);
      const x = start.x + (end.x - start.x) * time;
      if (Math.abs(x - mouth.x) <= pocket.width / 2 - BUTTON_RADIUS * 0.35) {
        consider({ kind: 'pocket', index, time, key: pocket.id });
      }
    });
  }
  if (room.patch && !state.patchCollected) {
    const time = circleContact(start, end, room.patch.center, room.patch.radius + BUTTON_RADIUS);
    if (time !== undefined) consider({ kind: 'patch', time, key: '' });
  }
  const bounds = [
    { from: start.x, to: end.x, min: -BUTTON_RADIUS, max: room.bounds.width + BUTTON_RADIUS },
    {
      from: start.y,
      to: end.y,
      min: room.bounds.top ?? -BUTTON_RADIUS,
      max: room.bounds.bottom ?? room.bounds.height + BUTTON_RADIUS,
    },
  ];
  bounds.forEach(({ from, to, min, max }) => {
    if (from < min || from > max) consider({ kind: 'bounds', time: 0, key: '' });
    else if (to < min) consider({ kind: 'bounds', time: (min - from) / (to - from), key: '' });
    else if (to > max) consider({ kind: 'bounds', time: (max - from) / (to - from), key: '' });
  });
  return earliest;
}

function fail(state: LaunchState, reason: LaunchFailure): LaunchEvent {
  state.phase = 'failed';
  state.failure = reason;
  state.velocity = { x: 0, y: 0 };
  return { type: 'fail', tick: state.tick, reason };
}

/** Advance exactly one normal-speed 120 Hz tick, returning all tactile events in contact order. */
export function stepLaunch(room: LaunchRoom, state: LaunchState): LaunchEvent[] {
  if (state.phase === 'failed' || state.phase === 'complete') return [];
  const previousTick = state.tick;
  state.tick += 1;
  state.previousPosition = { ...state.position };
  if (state.phase === 'held') {
    state.position = pocketPosition(findPocket(room, state.pocketId), state.tick);
    return [];
  }
  const events: LaunchEvent[] = [];
  state.flightTicks += 1;
  let remaining = LAUNCH_STEP_SECONDS;
  let elapsed = 0;
  for (let count = 0; count < MAX_CONTACTS_PER_STEP && remaining > EPSILON; count += 1) {
    const source = pocketPosition(findPocket(room, state.pocketId), previousTick);
    const sourceWidth = findPocket(room, state.pocketId).width;
    if (
      state.sourcePocketImmune &&
      (state.position.y < source.y - BUTTON_RADIUS ||
        Math.abs(state.position.x - source.x) > sourceWidth / 2 + BUTTON_RADIUS)
    ) state.sourcePocketImmune = false;
    const start = state.position;
    const end = {
      x: start.x + state.velocity.x * remaining,
      y: start.y + state.velocity.y * remaining + (room.gravity * remaining * remaining) / 2,
    };
    const contact = findContact(room, state, start, end, previousTick + elapsed * LAUNCH_HZ, state.tick);
    const fraction = contact?.time ?? 1;
    const duration = remaining * fraction;
    state.position = {
      x: start.x + (end.x - start.x) * fraction,
      y: start.y + (end.y - start.y) * fraction,
    };
    state.velocity.y += room.gravity * duration;
    remaining -= duration;
    elapsed += duration;
    if (!contact) break;
    if (contact.kind === 'hazard' || contact.kind === 'bounds') {
      events.push(fail(state, contact.kind === 'hazard' ? 'hazard' : 'out_of_bounds'));
      break;
    }
    if (contact.kind === 'patch') {
      state.patchCollected = true;
      events.push({ type: 'patch', tick: state.tick });
      continue;
    }
    if (contact.kind === 'pocket') {
      const pocket = room.pockets[contact.index];
      state.pocketId = pocket.id;
      state.position = pocketPosition(pocket, state.tick);
      state.velocity = { x: 0, y: 0 };
      state.flightTicks = 0;
      state.sourcePocketImmune = true;
      if (pocket.kind === 'goal') {
        state.phase = 'complete';
        events.push({ type: 'complete', tick: state.tick, id: pocket.id });
      } else {
        state.phase = 'held';
        state.checkpoint = { pocketId: pocket.id, tick: state.tick, patchCollected: state.patchCollected };
        events.push({ type: 'catch', tick: state.tick, id: pocket.id });
      }
      break;
    }
    const bumper = room.bumpers[contact.index];
    const dx = state.position.x - bumper.center.x;
    const dy = state.position.y - bumper.center.y;
    const distance = Math.hypot(dx, dy);
    const nx = distance > EPSILON ? dx / distance : 0;
    const ny = distance > EPSILON ? dy / distance : -1;
    const inwardSpeed = state.velocity.x * nx + state.velocity.y * ny;
    const restitution = Math.max(0, Math.min(1, bumper.restitution));
    if (inwardSpeed < 0) {
      state.velocity.x -= (1 + restitution) * inwardSpeed * nx;
      state.velocity.y -= (1 + restitution) * inwardSpeed * ny;
    }
    const safeRadius = bumper.radius + BUTTON_RADIUS + 0.001;
    state.position = { x: bumper.center.x + nx * safeRadius, y: bumper.center.y + ny * safeRadius };
    events.push({ type: 'bounce', tick: state.tick, id: bumper.id });
  }
  const timeout = room.flightTimeoutTicks === undefined ? MAX_FLIGHT_TICKS : room.flightTimeoutTicks;
  if (state.phase === 'flying' && timeout !== null && state.flightTicks >= timeout) events.push(fail(state, 'timeout'));
  if (events.length) state.event = events[events.length - 1];
  return events;
}

export function createLaunchClock(): LaunchClock {
  return { accumulator: 0 };
}

/** Runtime calls on blur/background and again before resuming, discarding elapsed wall time. */
export function resetLaunchClock(clock: LaunchClock): void {
  clock.accumulator = 0;
}

/** elapsedSeconds is foreground frame time only; there is intentionally no playback multiplier. */
export function advanceLaunch(
  room: LaunchRoom,
  state: LaunchState,
  clock: LaunchClock,
  elapsedSeconds: number,
  onEvent?: (event: LaunchEvent) => void,
): number {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) return 0;
  clock.accumulator += Math.min(elapsedSeconds, MAX_FRAME_SECONDS);
  let steps = 0;
  while (clock.accumulator + EPSILON >= LAUNCH_STEP_SECONDS) {
    clock.accumulator = Math.max(0, clock.accumulator - LAUNCH_STEP_SECONDS);
    if (state.phase === 'complete' || state.phase === 'failed') {
      resetLaunchClock(clock);
      break;
    }
    stepLaunch(room, state).forEach((event) => onEvent?.(event));
    steps += 1;
  }
  return steps;
}
