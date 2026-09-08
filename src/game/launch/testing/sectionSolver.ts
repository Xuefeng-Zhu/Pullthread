/** Authoring verification only. Runtime generation never consults completing inputs. */
import type { SectionPattern } from '../sections';
import { clampEndlessPull } from '../launchInput';
import { activateLandingSwitches, createLaunchState, launch, LAUNCH_HZ, LAUNCH_POWER, pocketPosition, pocketVelocity, stepLaunch } from '../simulation';
import type { LaunchEvent, LaunchPoint, LaunchRoom, LaunchState } from '../types';
import type { WorldSectionPattern } from '../worldSections';
import type { InteractiveSectionPattern } from '../interactiveSections';

export interface SectionInput { readonly waitTicks: number; readonly pull: LaunchPoint; readonly setup?: readonly SectionInput[] }
export interface SectionWorld {
  readonly room: LaunchRoom;
  readonly connections: readonly { readonly from: string; readonly to: string }[];
}

/** Retains every pocket and obstacle in adjacent sections, including alternative branches. */
export function assembleSections(patterns: readonly SectionPattern[], entryX = 180): SectionWorld {
  let room: LaunchRoom = {
    id: 'section-verification', name: '', subtitle: '', hint: '', gravity: 700,
    bounds: { width: 360, height: 600, top: Number.NEGATIVE_INFINITY, bottom: 140 },
    flightTimeoutTicks: null, startPocketId: 'entry',
    pockets: [{ id: 'entry', center: { x: entryX, y: 0 }, width: 144, kind: 'start', ascentRank: 0 }],
    bumpers: [], hazards: [], pickups: [],
    ...(patterns.some((pattern) => 'barriers' in pattern) ? { sideWallRestitution: 0.8 } : {}),
  };
  const connections: { from: string; to: string }[] = [];
  let originY = 0;
  let previousExit = 'entry';
  let ascentRank = 0;
  patterns.forEach((pattern, index) => {
    const prefix = `${index}:`;
    const point = (center: LaunchPoint) => ({ x: center.x, y: center.y + originY });
    const id = (local: string) => local === 'entry' ? previousExit : prefix + local;
    room = { ...room, pockets: [...room.pockets, ...pattern.pockets.map((value) => ({
      ...value, id: id(value.id), center: point(value.center), sectionId: String(index),
      ascentRank: ascentRank + (value.ascentRank ?? 0),
    }))],
    bumpers: [...room.bumpers, ...pattern.bumpers.map((value) => ({ ...value, id: id(value.id), center: point(value.center) }))],
    hazards: [...room.hazards, ...pattern.hazards.map((value) => ({ ...value, id: id(value.id), center: point(value.center) }))],
    pickups: [...room.pickups ?? [], ...pattern.pickups.map((value) => ({ ...value, id: id(value.id), center: point(value.center) }))],
    windZones: [...room.windZones ?? [], ...((pattern as Partial<WorldSectionPattern>).windZones ?? [])
      .map((zone) => ({ ...zone, id: id(zone.id), y: zone.y + originY }))],
    barriers: [...room.barriers ?? [], ...((pattern as Partial<InteractiveSectionPattern>).barriers ?? [])
      .map((value) => ({ ...value, id: id(value.id), y: value.y + originY }))],
    switches: [...room.switches ?? [], ...((pattern as Partial<InteractiveSectionPattern>).switches ?? [])
      .map((value) => ({ ...value, id: id(value.id), center: point(value.center), doorIds: value.doorIds.map(id),
        ...(value.pocketId ? { pocketId: id(value.pocketId) } : {}) }))],
    };
    connections.push(...pattern.connections.map((value) => ({ from: id(value.from), to: id(value.to) })));
    const exit = pattern.pockets.find((value) => value.id === pattern.exitPocketId)!;
    originY += exit.center.y;
    ascentRank += exit.ascentRank ?? 0;
    previousExit = id(pattern.exitPocketId);
  });
  return { room, connections };
}

export function heldAt(room: LaunchRoom, pocketId: string, tick = 0): LaunchState {
  const state = createLaunchState({ ...room, startPocketId: pocketId });
  const pocket = room.pockets.find((candidate) => candidate.id === pocketId)!;
  state.tick = tick;
  state.position = pocketPosition(pocket, tick);
  state.previousPosition = { ...state.position };
  state.checkpoint = { ...state.checkpoint, tick };
  if (pocket.frayTicks) state.pocketExpiryTicks = { [pocketId]: tick + pocket.frayTicks };
  activateLandingSwitches(room, state, pocketId);
  return state;
}

function cloneState(state: LaunchState): LaunchState {
  return JSON.parse(JSON.stringify(state)) as LaunchState;
}

export function flySectionInput(room: LaunchRoom, source: LaunchState, input: SectionInput) {
  let state = cloneState(source);
  const events: LaunchEvent[] = [];
  for (const setup of input.setup ?? []) {
    const result = flySectionInput(room, state, setup);
    state = result.state;
    events.push(...result.events);
    if (state.phase !== 'held') return { state, events };
  }
  // Endless arrivals freeze the caught pocket at its actual phase position.
  // Match that behavior when starting an isolated authored edge there.
  const heldRoom = room.pockets.some((pocket) => pocket.id === source.pocketId && pocket.motion)
    ? { ...room, pockets: room.pockets.map((pocket) => pocket.id === source.pocketId
      ? { ...pocket, motion: undefined, center: { ...source.position } } : pocket) } : room;
  for (let tick = 0; tick < input.waitTicks; tick += 1) events.push(...stepLaunch(heldRoom, state));
  const sourcePocket = heldRoom.pockets.find((pocket) => pocket.id === state.pocketId)!;
  const cameraY = sourcePocket.orbit ? sourcePocket.center.y + sourcePocket.orbit.radius - 480 : state.position.y - 480;
  const actualPull = clampEndlessPull(input.pull, state.position, cameraY, heldRoom.bounds);
  if (!launch(heldRoom, state, { tick: state.tick, pocketId: state.pocketId, pull: actualPull })) return { state, events };
  for (let tick = 0; tick < 960 && state.phase === 'flying'; tick += 1) events.push(...stepLaunch(heldRoom, state));
  return { state, events };
}

export function sectionBallisticPull(room: LaunchRoom, source: LaunchState, targetId: string,
  power: number, waitTicks = 0, targetOffset = 0): LaunchPoint | undefined {
  const target = room.pockets.find((pocket) => pocket.id === targetId)!;
  const sourcePocket = room.pockets.find((pocket) => pocket.id === source.pocketId)!;
  if (sourcePocket.orbit || target.orbit) {
    const anchor = sourcePocket.orbit ? pocketPosition(sourcePocket, source.tick + waitTicks) : source.position;
    const carried = pocketVelocity(sourcePocket, source.tick + waitTicks);
    const speed = power * LAUNCH_POWER - carried.y;
    let seconds = speed / room.gravity;
    let position = target.center;
    for (let iteration = 0; iteration < 8; iteration++) {
      position = pocketPosition(target, source.tick + waitTicks + seconds * LAUNCH_HZ);
      const discriminant = speed ** 2 - 2 * room.gravity * (power + anchor.y - position.y);
      if (discriminant <= 0) return;
      seconds = (speed + Math.sqrt(discriminant)) / room.gravity;
    }
    const x = (position.x + targetOffset - anchor.x - carried.x * seconds) / (1 - LAUNCH_POWER * seconds);
    return Math.hypot(x, power) <= 100 ? { x, y: power } : undefined;
  }
  const discriminant = (power * LAUNCH_POWER) ** 2 - 2 * room.gravity * (power + source.position.y - target.center.y);
  if (discriminant <= 0) return;
  const seconds = (power * LAUNCH_POWER + Math.sqrt(discriminant)) / room.gravity;
  const position = pocketPosition(target, source.tick + waitTicks + seconds * LAUNCH_HZ);
  const x = (position.x + targetOffset - source.position.x) / (1 - LAUNCH_POWER * seconds);
  if (Math.hypot(x, power) > 100) return;
  return { x, y: power };
}

export function solveSectionEdge(room: LaunchRoom, source: LaunchState, targetId: string,
  options: { readonly perturbation?: number; readonly requireBounce?: boolean; readonly pickupId?: string; readonly maxWaitTicks?: number;
    readonly maxSetupShots?: number } = {}): SectionInput {
  const target = room.pockets.find((pocket) => pocket.id === targetId)!;
  const perturbation = options.perturbation ?? 1;
  const offsets = perturbation ? [-perturbation, 0, perturbation] : [0];
  const setupCandidates: { input: SectionInput; state: LaunchState }[] = [];
  const seenSetupStates = new Set<string>();
  const valid = (input: SectionInput) => {
    for (const dx of offsets) for (const dy of offsets) {
      const result = flySectionInput(room, source, { ...input, pull: { x: input.pull.x + dx, y: input.pull.y + dy } });
      if (result.state.phase === 'held' && result.state.pocketId === source.pocketId && setupCandidates.length < 4
        && ((result.state.brokenBarrierIds?.length ?? 0) > (source.brokenBarrierIds?.length ?? 0)
          || (result.state.activatedSwitchIds?.length ?? 0) > (source.activatedSwitchIds?.length ?? 0))) {
        const exact = flySectionInput(room, source, input);
        const key = `${exact.state.brokenBarrierIds?.join(',') ?? ''}|${exact.state.activatedSwitchIds?.join(',') ?? ''}`;
        if (exact.state.phase === 'held' && exact.state.pocketId === source.pocketId && !seenSetupStates.has(key)
          && ((exact.state.brokenBarrierIds?.length ?? 0) > (source.brokenBarrierIds?.length ?? 0)
            || (exact.state.activatedSwitchIds?.length ?? 0) > (source.activatedSwitchIds?.length ?? 0))) {
          seenSetupStates.add(key);
          setupCandidates.push({ input, state: exact.state });
        }
      }
      if (result.state.phase !== 'held' || result.state.pocketId !== targetId
        || (options.requireBounce && !result.events.some((event) => event.type === 'bounce'))
        || (options.pickupId && !result.state.pickupIds.includes(options.pickupId))) return false;
    }
    return true;
  };
  const maxWait = options.maxWaitTicks ?? Math.max(target.motion?.periodTicks ?? 0, target.orbit?.periodTicks ?? 0,
    room.pockets.find((pocket) => pocket.id === source.pocketId)?.orbit?.periodTicks ?? 0,
    room.barriers?.some((value) => value.kind === 'shutter') ? 1440 : 0,
    ...room.hazards.map((hazard) => hazard.motion?.periodTicks ?? 0));
  const targetOffsets = [0, -target.width / 4, target.width / 4, -target.width / 3, target.width / 3];
  const changingInteractiveGeometry = !!target.orbit
    || !!room.pockets.find((pocket) => pocket.id === source.pocketId)?.orbit
    || !!room.barriers?.some((value) => value.kind === 'shutter');
  for (let waitTicks = 0; waitTicks <= maxWait; waitTicks += 12) {
    let hasBallisticCandidate = false;
    if (!options.requireBounce) {
      for (let power = 62; power <= 100; power += 1) for (const offset of targetOffsets) {
        const pull = sectionBallisticPull(room, source, targetId, power, waitTicks, offset);
        if (pull) hasBallisticCandidate = true;
        if (pull && valid({ waitTicks, pull })) return { waitTicks, pull };
      }
    }
    if (!hasBallisticCandidate && room.pockets.find((pocket) => pocket.id === source.pocketId)?.orbit) continue;
    if ((options.maxSetupShots ?? 2) > 0 && setupCandidates.length) {
      for (const candidate of setupCandidates.splice(0)) {
        try {
          const next = solveSectionEdge(room, candidate.state, targetId, { ...options, maxSetupShots: (options.maxSetupShots ?? 2) - 1 });
          return { ...next, setup: [candidate.input, ...next.setup ?? []] };
        } catch { /* A different punch or switch angle may preserve a better recovery. */ }
      }
    }
    // Wind bends flight away from the ballistic estimate. Springs may require an
    // intentional bank, so independently sample legal pull angles as a fallback.
    if (options.requireBounce || room.windZones?.length || room.bumpers.some((bumper) => bumper.springSpeed)
      || (room.barriers?.length && !changingInteractiveGeometry)) {
      for (let power = 66; power <= 98; power += 2) for (let x = -62; x <= 62; x += 2) {
        if (Math.hypot(x, power) <= 100 && valid({ waitTicks, pull: { x, y: power } })) return { waitTicks, pull: { x, y: power } };
      }
    }
  }
  // First inspect all useful release phases. Exhausting thousands of blind bank
  // angles while a shutter is closed or an orbit is low only repeats failures.
  if (changingInteractiveGeometry) for (let waitTicks = 0; waitTicks <= maxWait; waitTicks += 24) {
    for (let power = 66; power <= 98; power += 2) for (let x = -62; x <= 62; x += 2) {
      if (Math.hypot(x, power) <= 100 && valid({ waitTicks, pull: { x, y: power } })) return { waitTicks, pull: { x, y: power } };
    }
  }
  if ((options.maxSetupShots ?? 2) > 0) for (const candidate of setupCandidates) {
    try {
      const next = solveSectionEdge(room, candidate.state, targetId, { ...options, maxSetupShots: (options.maxSetupShots ?? 2) - 1 });
      return { ...next, setup: [candidate.input, ...next.setup ?? []] };
    } catch { /* Preserve the next distinct persistent-state candidate. */ }
  }
  throw new Error(`No section route ${source.pocketId} -> ${targetId}, tick=${source.tick}, bounce=${!!options.requireBounce}`);
}
