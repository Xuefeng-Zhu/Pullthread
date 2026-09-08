import { barrierIsActive, sweepCircleRectangle, type RectangleContact } from './interactivePhysics';
import type {
  LaunchClock,
  LaunchEvent,
  LaunchFailure,
  LaunchHazard,
  LaunchInput,
  LaunchPocket,
  LaunchPoint,
  LaunchRoom,
  LaunchState,
  LaunchWindZone,
} from './types';
export { barrierIsActive, shutterPhase } from './interactivePhysics';

export const LAUNCH_HZ = 120;
export const LAUNCH_STEP_SECONDS = 1 / LAUNCH_HZ;
export const BUTTON_RADIUS = 10;
export const MAX_PULL = 100;
export const MIN_PULL = 8;
export const LAUNCH_POWER = 7.5;
export const MAX_FLIGHT_TICKS = LAUNCH_HZ * 8;
const EPSILON = 1e-8;
const MAX_CONTACTS_PER_STEP = 8;
const BARRIER_ESCAPE_SPEED = 360;
const BARRIER_ESCAPE_NORMAL_SPEED = 180;
const BARRIER_RESTING_NORMAL_SPEED = 90;
/** A slow foreground frame cannot accumulate a seconds-long simulation backlog. */
export const MAX_FRAME_SECONDS = 0.1;

export function pocketPosition(pocket: LaunchPocket, tick: number): LaunchPoint {
  'worklet';
  if (pocket.orbit) {
    const orbit = pocket.orbit;
    const angle = ((tick * (orbit.direction ?? 1) + orbit.phaseTicks) / orbit.periodTicks) * Math.PI * 2;
    return { x: pocket.center.x + Math.cos(angle) * orbit.radius, y: pocket.center.y + Math.sin(angle) * orbit.radius };
  }
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

/** Only an orbit carries momentum into a launch; historical sway stays unchanged. */
export function pocketVelocity(pocket: LaunchPocket, tick: number): LaunchPoint {
  'worklet';
  if (!pocket.orbit) return { x: 0, y: 0 };
  const orbit = pocket.orbit;
  const angle = ((tick * (orbit.direction ?? 1) + orbit.phaseTicks) / orbit.periodTicks) * Math.PI * 2;
  const speed = (orbit.direction ?? 1) * orbit.radius * Math.PI * 2 * LAUNCH_HZ / orbit.periodTicks;
  return { x: -Math.sin(angle) * speed, y: Math.cos(angle) * speed };
}

export function launchVelocity(pocket: LaunchPocket, tick: number, pull: LaunchPoint): LaunchPoint {
  'worklet';
  const carried = pocketVelocity(pocket, tick);
  const velocity = { x: -pull.x * LAUNCH_POWER + carried.x, y: -pull.y * LAUNCH_POWER + carried.y };
  const magnitude = Math.hypot(velocity.x, velocity.y);
  if (pocket.orbit && magnitude > 850) return { x: velocity.x * 850 / magnitude, y: velocity.y * 850 / magnitude };
  return velocity;
}

export function activateLandingSwitches(room: LaunchRoom, state: LaunchState, pocketId: string): LaunchEvent[] {
  const events: LaunchEvent[] = [];
  for (const sensor of room.switches ?? []) {
    if (state.activatedSwitchIds?.includes(sensor.id)) continue;
    if (sensor.pocketId !== pocketId
      && Math.hypot(state.position.x - sensor.center.x, state.position.y - sensor.center.y) > sensor.radius + BUTTON_RADIUS) continue;
    state.activatedSwitchIds = [...state.activatedSwitchIds ?? [], sensor.id];
    events.push({ type: 'switch', tick: state.tick, id: sensor.id });
  }
  return events;
}

/** A single center sample per fixed tick is shared by flight and the short aim guide. */
export function windAccelerationAt(zones: readonly LaunchWindZone[] | undefined, position: LaunchPoint): number {
  'worklet';
  let acceleration = 0;
  for (const zone of zones ?? []) {
    if (position.x >= zone.x && position.x < zone.x + zone.width
      && position.y >= zone.y && position.y < zone.y + zone.height) acceleration += zone.accelerationX;
  }
  return acceleration;
}

/** Rendering and swept collisions share this deterministic obstacle clock. */
export function hazardPosition(hazard: LaunchHazard, tick: number): LaunchPoint {
  'worklet';
  const { motion } = hazard;
  const offset = motion && motion.periodTicks > 0
    ? Math.sin(((tick + motion.phaseTicks) / motion.periodTicks) * Math.PI * 2) * motion.amplitude
    : 0;
  return {
    x: hazard.center.x + (motion?.axis === 'y' ? 0 : offset),
    y: hazard.center.y + (motion?.axis === 'y' ? offset : 0),
  };
}

/** First arrival owns the deadline: leaving or recatching never restarts it. */
export function startPocketLifetime(state: LaunchState, pocket: LaunchPocket): void {
  if (pocket.frayTicks === undefined || pocket.frayTicks <= 0) return;
  state.pocketExpiryTicks ??= {};
  if (state.pocketExpiryTicks[pocket.id] === undefined) {
    state.pocketExpiryTicks[pocket.id] = state.tick + pocket.frayTicks;
  }
}

export function isPocketExpired(state: LaunchState, pocket: LaunchPocket, tick = state.tick): boolean {
  'worklet';
  const expires = state.pocketExpiryTicks?.[pocket.id];
  return expires !== undefined && tick >= expires;
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
  const pocket = findPocket(room, room.startPocketId);
  const position = pocketPosition(pocket, 0);
  const state: LaunchState = {
    tick: 0,
    phase: 'held',
    position,
    previousPosition: { ...position },
    velocity: { x: 0, y: 0 },
    pocketId: room.startPocketId,
    checkpoint: { pocketId: room.startPocketId, tick: 0, patchCollected: false },
    patchCollected: false,
    pickupIds: [],
    ...(room.barriers !== undefined || room.switches !== undefined ? { brokenBarrierIds: [], activatedSwitchIds: [] } : {}),
    flightTicks: 0,
    launches: 0,
    sourcePocketImmune: true,
  };
  startPocketLifetime(state, pocket);
  return state;
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
  const pocket = findPocket(room, state.pocketId);
  if (isPocketExpired(state, pocket)) return false;
  const anchor = pocketPosition(pocket, state.tick);
  state.position = { x: anchor.x + pull.x, y: anchor.y + pull.y };
  state.previousPosition = { ...state.position };
  state.velocity = launchVelocity(pocket, state.tick, pull);
  state.phase = 'flying';
  state.flightTicks = 0;
  state.launches += 1;
  state.sourcePocketImmune = true;
  state.failure = undefined;
  if (state.frayedFall !== undefined) state.frayedFall = false;
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
  if (state.frayedFall !== undefined) state.frayedFall = false;
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
  | { time: number; kind: 'wall'; side: 'left' | 'right'; key: string }
  | { time: number; kind: 'pocket'; index: number; key: string }
  | { time: number; kind: 'hazard'; index: number; key: string }
  | { time: number; kind: 'patch'; key: string }
  | { time: number; kind: 'pickup'; index: number; key: string }
  | { time: number; kind: 'bounds'; key: string }
  | { time: number; kind: 'barrier'; index: number; key: string; hit: RectangleContact }
  | { time: number; kind: 'switch'; index: number; key: string };

/** Stable tie breaking makes authoring order irrelevant at exactly simultaneous contacts. */
function contactPriority(contact: Contact): number {
  return { hazard: 0, bounds: 1, pocket: 2, bumper: 3, wall: 3, patch: 4, pickup: 5, barrier: 3, switch: 1.5 }[contact.kind];
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
    // Solve in the hazard's moving reference frame, including the fractional
    // remainder after an earlier bumper bounce during this same tick.
    const from = hazardPosition(hazard, tickStart);
    const to = hazardPosition(hazard, tickEnd);
    const time = hazard.motion
      ? circleContact(
        { x: start.x - from.x, y: start.y - from.y },
        { x: end.x - to.x, y: end.y - to.y },
        { x: 0, y: 0 },
        hazard.radius + BUTTON_RADIUS,
      )
      : circleContact(start, end, hazard.center, hazard.radius + BUTTON_RADIUS);
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
  room.barriers?.forEach((barrier, index) => {
    if (!barrierIsActive(barrier, room, state, tickEnd)) return;
    const hit = sweepCircleRectangle(start, end, barrier, BUTTON_RADIUS);
    if (!hit) return;
    const lethal = barrier.kind === 'thorns' || barrier.kind === 'shutter';
    const outward = (end.x - start.x) * hit.normal.x + (end.y - start.y) * hit.normal.y >= 0;
    const penetrated = Math.hypot(start.x - hit.position.x, start.y - hit.position.y) > 1e-7;
    if (!lethal && hit.time === 0 && outward && !penetrated) return;
    if (lethal) consider({ kind: 'hazard', index: -1, time: hit.time, key: barrier.id });
    else consider({ kind: 'barrier', index, time: hit.time, key: barrier.id, hit });
  });
  room.switches?.forEach((sensor, index) => {
    if (state.activatedSwitchIds?.includes(sensor.id)) return;
    const time = circleContact(start, end, sensor.center, sensor.radius + BUTTON_RADIUS);
    if (time !== undefined) consider({ kind: 'switch', index, time, key: sensor.id });
  });
  room.pockets.forEach((pocket, index) => {
    if (isPocketExpired(state, pocket, tickEnd)) return;
    if (pocket.id === state.pocketId && state.sourcePocketImmune) return;
    if (pocket.orbit) {
      const mouthStart = pocketPosition(pocket, tickStart);
      const mouthEnd = pocketPosition(pocket, tickEnd);
      const before = start.y - mouthStart.y, after = end.y - mouthEnd.y;
      if (before > 0 || after < 0 || after <= before) return;
      const time = -before / (after - before);
      const mouthX = mouthStart.x + (mouthEnd.x - mouthStart.x) * time;
      if (Math.abs(start.x + (end.x - start.x) * time - mouthX) <= pocket.width / 2 - BUTTON_RADIUS * 0.35) {
        consider({ kind: 'pocket', index, time, key: pocket.id });
      }
    } else if (end.y > start.y) {
      const time = (pocket.center.y - start.y) / (end.y - start.y);
      if (time < 0 || time > 1) return;
      const mouth = pocketPosition(pocket, tickStart + (tickEnd - tickStart) * time);
      const x = start.x + (end.x - start.x) * time;
      if (Math.abs(x - mouth.x) <= pocket.width / 2 - BUTTON_RADIUS * 0.35) consider({ kind: 'pocket', index, time, key: pocket.id });
    }
  });
  if (room.patch && !state.patchCollected) {
    const time = circleContact(start, end, room.patch.center, room.patch.radius + BUTTON_RADIUS);
    if (time !== undefined) consider({ kind: 'patch', time, key: '' });
  }
  room.pickups?.forEach((pickup, index) => {
    if (state.pickupIds.includes(pickup.id)) return;
    const time = circleContact(start, end, pickup.center, pickup.radius + BUTTON_RADIUS);
    if (time !== undefined) consider({ kind: 'pickup', index, time, key: pickup.id });
  });
  const bouncingWalls = room.sideWallRestitution !== undefined;
  if (bouncingWalls) {
    const left = BUTTON_RADIUS;
    const right = room.bounds.width - BUTTON_RADIUS;
    // A stretched launch may start outside the wall. Resolve it once at t=0;
    // an already inward velocity is preserved rather than reflected outward.
    if (start.x < left) consider({ kind: 'wall', side: 'left', time: 0, key: 'wall-left' });
    else if (end.x <= left && end.x < start.x) {
      consider({ kind: 'wall', side: 'left', time: (left - start.x) / (end.x - start.x), key: 'wall-left' });
    }
    if (start.x > right) consider({ kind: 'wall', side: 'right', time: 0, key: 'wall-right' });
    else if (end.x >= right && end.x > start.x) {
      consider({ kind: 'wall', side: 'right', time: (right - start.x) / (end.x - start.x), key: 'wall-right' });
    }
  }
  const bounds = [
    ...(bouncingWalls ? [] : [{ from: start.x, to: end.x, min: -BUTTON_RADIUS, max: room.bounds.width + BUTTON_RADIUS }]),
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

/** A rail-adjacent platform has only one reachable edge for the button center. */
function barrierEscapeDirection(room: LaunchRoom, barrier: NonNullable<LaunchRoom['barriers']>[number], x: number): -1 | 1 {
  const leftEdgeReachable = barrier.x - BUTTON_RADIUS > BUTTON_RADIUS + EPSILON;
  const rightEdgeReachable = barrier.x + barrier.width + BUTTON_RADIUS < room.bounds.width - BUTTON_RADIUS - EPSILON;
  if (!leftEdgeReachable && rightEdgeReachable) return 1;
  if (leftEdgeReachable && !rightEdgeReachable) return -1;
  return x < barrier.x + barrier.width / 2 ? -1 : 1;
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
    const pocket = findPocket(room, state.pocketId);
    state.position = pocketPosition(pocket, state.tick);
    if (isPocketExpired(state, pocket)) {
      state.phase = 'flying';
      state.velocity = { x: 0, y: 0 };
      state.flightTicks = 0;
      state.sourcePocketImmune = true;
      state.frayedFall = true;
      state.event = { type: 'fray', tick: state.tick, id: pocket.id };
      return [state.event];
    }
    return [];
  }
  const events: LaunchEvent[] = [];
  state.flightTicks += 1;
  state.velocity.x += windAccelerationAt(room.windZones, state.position) * LAUNCH_STEP_SECONDS;
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
    let contact = findContact(room, state, start, end, previousTick + elapsed * LAUNCH_HZ, state.tick);
    // Collect in swept order up to the next physical contact, without splitting
    // the ballistic segment: optional tools must not nudge an otherwise identical shot.
    while (contact?.kind === 'pickup' || contact?.kind === 'switch') {
      if (contact.kind === 'switch') {
        const sensor = room.switches![contact.index];
        state.activatedSwitchIds = [...state.activatedSwitchIds ?? [], sensor.id];
        events.push({ type: 'switch', tick: state.tick, id: sensor.id });
        contact = findContact(room, state, start, end, previousTick + elapsed * LAUNCH_HZ, state.tick);
        continue;
      }
      const pickup = room.pickups![contact.index];
      state.pickupIds.push(pickup.id);
      events.push({ type: 'pickup', tick: state.tick, id: pickup.id, kind: pickup.kind });
      contact = findContact(room, state, start, end, previousTick + elapsed * LAUNCH_HZ, state.tick);
    }
    const fraction = contact?.time ?? 1;
    const duration = remaining * fraction;
    state.position = {
      x: start.x + (end.x - start.x) * fraction,
      // A horizontal wall changes no vertical physics. Integrate the exact
      // elapsed ballistic time instead of splitting the full-step chord.
      y: contact?.kind === 'wall'
        ? start.y + state.velocity.y * duration + (room.gravity * duration * duration) / 2
        : start.y + (end.y - start.y) * fraction,
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
    if (contact.kind === 'wall') {
      const restitution = Math.max(0, Math.min(1, room.sideWallRestitution!));
      state.position.x = contact.side === 'left' ? BUTTON_RADIUS : room.bounds.width - BUTTON_RADIUS;
      if ((contact.side === 'left' && state.velocity.x < 0) || (contact.side === 'right' && state.velocity.x > 0)) {
        state.velocity.x = -state.velocity.x * restitution;
      }
      events.push({ type: 'bounce', tick: state.tick, id: contact.key });
      continue;
    }
    if (contact.kind === 'pocket') {
      const pocket = room.pockets[contact.index];
      state.pocketId = pocket.id;
      startPocketLifetime(state, pocket);
      if (state.frayedFall !== undefined) state.frayedFall = false;
      state.position = pocketPosition(pocket, state.tick);
      events.push(...activateLandingSwitches(room, state, pocket.id));
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
    if (contact.kind === 'barrier') {
      const barrier = room.barriers![contact.index];
      const normal = contact.hit.normal;
      const incoming = state.velocity.x * normal.x + state.velocity.y * normal.y;
      if (barrier.kind === 'tearable' && -incoming >= 400) {
        state.brokenBarrierIds = [...state.brokenBarrierIds ?? [], barrier.id];
        state.velocity.x -= incoming * 0.25 * normal.x;
        state.velocity.y -= incoming * 0.25 * normal.y;
        events.push({ type: 'break', tick: state.tick, id: barrier.id });
      } else {
        if (incoming < 0) {
          state.velocity.x -= 1.55 * incoming * normal.x;
          state.velocity.y -= 1.55 * incoming * normal.y;
        }
        const outwardSpeed = state.velocity.x * normal.x + state.velocity.y * normal.y;
        // A damped fall can converge to repeated contacts on a flat cloth wall.
        // Send that near-resting case toward a reachable edge with enough lift
        // to clear the platform. A wall touching a rail must escape inward.
        if (Math.abs(normal.x) < EPSILON && normal.y < -1 + EPSILON
          && outwardSpeed < BARRIER_RESTING_NORMAL_SPEED
          && Math.abs(state.velocity.x) < BARRIER_ESCAPE_SPEED) {
          state.velocity.x = barrierEscapeDirection(room, barrier, state.position.x) * BARRIER_ESCAPE_SPEED;
          state.velocity.y += (BARRIER_ESCAPE_NORMAL_SPEED - outwardSpeed) * normal.y;
        }
        state.position = { x: contact.hit.position.x + normal.x * 0.001, y: contact.hit.position.y + normal.y * 0.001 };
        events.push({ type: 'bounce', tick: state.tick, id: barrier.id });
      }
      continue;
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
      if (bumper.springSpeed !== undefined) {
        const outwardSpeed = state.velocity.x * nx + state.velocity.y * ny;
        const outward = Math.min(850, Math.max(bumper.springSpeed, outwardSpeed));
        const tangent = state.velocity.x * -ny + state.velocity.y * nx;
        const maxTangent = Math.sqrt(Math.max(0, 850 * 850 - outward * outward));
        const limitedTangent = Math.max(-maxTangent, Math.min(maxTangent, tangent));
        state.velocity.x = nx * outward - ny * limitedTangent;
        state.velocity.y = ny * outward + nx * limitedTangent;
      }
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
