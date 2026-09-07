import {
  BUTTON_RADIUS,
  LAUNCH_STEP_SECONDS,
  MAX_FRAME_SECONDS,
  createLaunchState,
  launch,
  pocketPosition,
  resetLaunchClock,
  stepLaunch,
} from './simulation';
import type {
  LaunchBumper,
  LaunchClock,
  LaunchEvent,
  LaunchHazard,
  LaunchPocket,
  LaunchPickup,
  LaunchPoint,
  LaunchRoom,
  LaunchState,
} from './types';
import { chooseChallenge } from './challenges';
import type { ActiveChallenge, AnchorRange, ChallengeFamily, ChallengePattern } from './challengeTypes';
import type { ToolKind } from '../../commerce/contracts';
import { pickupPlacement, scheduledPickupKind } from './pickups';
import { captureEndlessWorld, restoreEndlessWorld } from './snapshots';

export const ENDLESS_WIDTH = 360;
export const ENDLESS_HEIGHT = 600;
export const ENDLESS_START_Y = 490;
const LOOK_AHEAD = 5;
const KEEP_BEHIND = 2;
const CAMERA_EASING = 0.08;

interface OwnedChallenge extends ActiveChallenge {
  readonly index: number;
  readonly bumperIds: readonly string[];
  readonly hazardIds: readonly string[];
  readonly pickupIds: readonly string[];
}

export interface EndlessRun {
  readonly seed: number;
  room: LaunchRoom;
  state: LaunchState;
  cameraY: number;
  highestPocket: number;
  /** Successful catches that advance the run, excluding skipped and revisited pockets. */
  pocketsCaught: number;
  /** Greatest ascent in world pixels, including the peak of a flight. */
  height: number;
  nextPocketId: string;
  /** Constant-size generation cursor; no lifetime list of visited pockets is stored. */
  nextPocketIndex: number;
  lastGeneratedY: number;
  lastExitX: AnchorRange;
  lastFamily: ChallengeFamily;
  lastPatternId: string;
  challenges: readonly OwnedChallenge[];
  inventory: Record<ToolKind, number>;
  reviveUsed: boolean;
  previewActive: boolean;
  collectedPickupIds: string[];
  lastCatchSnapshot: EndlessWorldSnapshot | null;
}

/** A checkpoint contains world/clock/generator data, never another checkpoint or inventory. */
export type EndlessWorldSnapshot = Omit<EndlessRun,
  'inventory' | 'reviveUsed' | 'previewActive' | 'collectedPickupIds' | 'lastCatchSnapshot'>;

function pocketId(index: number): string {
  return `endless-${index}`;
}

function pocketIndex(id: string): number {
  return Number(id.slice('endless-'.length));
}

function opening(index: number): ChallengePattern {
  // Keep the second warm-up on the right so the next mirrored arc's thorns
  // remain beside its arrival path, with a generous opening for a light pull.
  const x = index === 1 ? 240 : 260;
  return {
    id: `opening-${index}`, family: 'opening', band: 'intro',
    entryX: { min: index === 1 ? 80 : 240, max: index === 1 ? 80 : 240 },
    exitX: { min: x, max: x },
    receiver: { center: { x, y: index === 1 ? -100 : -135 }, width: 144 },
    bumpers: [], hazards: [],
  };
}

export function nextEndlessChallenge(run: EndlessRun): ActiveChallenge | undefined {
  return run.challenges.find((challenge) => challenge.pocketId === run.nextPocketId);
}

function updateWindow(run: EndlessRun): void {
  const pockets = [...run.room.pockets];
  const bumpers: LaunchBumper[] = [...run.room.bumpers];
  const hazards: LaunchHazard[] = [...run.room.hazards];
  const pickups: LaunchPickup[] = [...run.room.pickups ?? []];
  while (run.nextPocketIndex <= run.highestPocket + LOOK_AHEAD) {
    const index = run.nextPocketIndex;
    const pattern = index < 3 ? opening(index)
      : chooseChallenge(run.seed, index, run.lastExitX, run.lastFamily, run.lastPatternId);
    const originY = run.lastGeneratedY;
    const translated = (point: LaunchPoint) => ({ x: point.x, y: point.y + originY });
    const pocket: LaunchPocket = {
      ...pattern.receiver, id: pocketId(index), kind: 'checkpoint',
      center: translated(pattern.receiver.center),
    };
    const ownedBumpers = pattern.bumpers.map((bumper, number) => ({
      ...bumper, id: `endless-bumper-${index}-${number}`, center: translated(bumper.center),
    }));
    const ownedHazards = pattern.hazards.map((hazard, number) => ({
      ...hazard, id: `endless-thorns-${index}-${number}`, center: translated(hazard.center),
    }));
    const scheduled = scheduledPickupKind(index);
    const kind = scheduled === 'revive' && (run.reviveUsed || run.inventory.revive > 0) ? 'preview' : scheduled;
    const placement = kind ? pickupPlacement(pattern) : undefined;
    const ownedPickups: LaunchPickup[] = kind && placement ? [{
      ...placement, id: `endless-pickup-${index}`, kind, center: translated(placement.center),
    }] : [];
    pockets.push(pocket);
    bumpers.push(...ownedBumpers);
    hazards.push(...ownedHazards);
    pickups.push(...ownedPickups);
    run.challenges = [...run.challenges, {
      index, pocketId: pocket.id, patternId: pattern.id, family: pattern.family,
      band: pattern.band, cue: pattern.cue,
      bumperIds: ownedBumpers.map((bumper) => bumper.id), hazardIds: ownedHazards.map((hazard) => hazard.id),
      pickupIds: ownedPickups.map((pickup) => pickup.id),
    }];
    run.lastGeneratedY = pocket.center.y;
    run.lastExitX = pattern.exitX;
    run.lastFamily = pattern.family;
    run.lastPatternId = pattern.id;
    run.nextPocketIndex += 1;
  }
  const minimumIndex = Math.max(0, run.highestPocket - KEEP_BEHIND);
  const oldestVisibleY = run.cameraY + ENDLESS_HEIGHT + 80;
  const retainedPockets = pockets.filter((pocket) =>
    pocket.id === run.state.pocketId ||
    (pocketIndex(pocket.id) >= minimumIndex && pocket.center.y <= oldestVisibleY),
  );
  // Index-based retention bounds memory even when the camera is frozen during a gesture.
  run.challenges = run.challenges.filter((challenge) => challenge.index >= minimumIndex);
  const retainedBumpers = new Set(run.challenges.flatMap((challenge) => challenge.bumperIds));
  const retainedHazards = new Set(run.challenges.flatMap((challenge) => challenge.hazardIds));
  const retainedPickups = new Set(run.challenges.flatMap((challenge) => challenge.pickupIds));
  // Old checkpoint geometry can no longer regenerate IDs below this window.
  run.collectedPickupIds = run.collectedPickupIds.filter((id) =>
    Number(id.slice(id.lastIndexOf('-') + 1)) >= minimumIndex);
  run.state.pickupIds = [...run.collectedPickupIds];
  run.room = {
    ...run.room,
    pockets: retainedPockets,
    bumpers: bumpers.filter((bumper) => retainedBumpers.has(bumper.id)),
    hazards: hazards.filter((hazard) => retainedHazards.has(hazard.id)),
    pickups: pickups.filter((pickup) => retainedPickups.has(pickup.id) && !run.collectedPickupIds.includes(pickup.id)),
  };
  run.nextPocketId = pocketId(run.highestPocket + 1);
}

export function createEndlessRun(seed: number): EndlessRun {
  const stableSeed = Number.isFinite(seed) ? seed >>> 0 : 0;
  const room: LaunchRoom = {
    id: 'endless-climb',
    name: 'Pull & Launch',
    subtitle: 'How high can one little button climb?',
    hint: 'Pull down and away, then let go. Keep catching pockets. A fall ends your climb.',
    bounds: { width: ENDLESS_WIDTH, height: ENDLESS_HEIGHT, top: Number.NEGATIVE_INFINITY, bottom: ENDLESS_HEIGHT },
    gravity: 700,
    flightTimeoutTicks: null,
    startPocketId: pocketId(0),
    pockets: [{ id: pocketId(0), center: { x: 80, y: ENDLESS_START_Y }, width: 78, kind: 'start' }],
    bumpers: [],
    hazards: [],
    pickups: [],
  };
  const run: EndlessRun = {
    seed: stableSeed,
    room,
    state: createLaunchState(room),
    cameraY: 0,
    highestPocket: 0,
    pocketsCaught: 0,
    height: 0,
    nextPocketId: pocketId(1),
    nextPocketIndex: 1,
    lastGeneratedY: ENDLESS_START_Y,
    lastExitX: { min: 80, max: 80 },
    lastFamily: 'opening',
    lastPatternId: 'opening-0',
    challenges: [],
    inventory: { preview: 0, teleport: 0, revive: 0 },
    reviveUsed: false,
    previewActive: false,
    collectedPickupIds: [],
    lastCatchSnapshot: null,
  };
  updateWindow(run);
  run.lastCatchSnapshot = captureEndlessWorld(run);
  return run;
}

export function launchEndless(run: EndlessRun, pull: LaunchPoint): boolean {
  const launched = launch(run.room, run.state, { tick: run.state.tick, pocketId: run.state.pocketId, pull });
  if (launched) run.previewActive = false;
  return launched;
}

function arrive(run: EndlessRun, id: string): void {
  const pocket = run.room.pockets.find((candidate) => candidate.id === id)!;
  const position = pocketPosition(pocket, run.state.tick);
  Object.assign(run.state, {
    pocketId: id, phase: 'held', position, previousPosition: { ...position },
    velocity: { x: 0, y: 0 }, flightTicks: 0, sourcePocketImmune: true, failure: undefined,
    checkpoint: { pocketId: id, tick: run.state.tick, patchCollected: run.state.patchCollected },
  });
  // The exact caught position is also the stationary anchor for teleport arrivals.
  run.room = { ...run.room, pockets: run.room.pockets.map((candidate) => candidate.id === id && candidate.motion ? {
    id: candidate.id, kind: candidate.kind, width: candidate.width, center: { ...position },
  } : candidate) };
  const index = pocketIndex(id);
  if (index > run.highestPocket) {
    run.pocketsCaught += 1;
    run.highestPocket = index;
  }
  updateWindow(run);
}

function updateView(run: EndlessRun, cameraFrozen: boolean): void {
  run.height = Math.max(run.height, Math.round(ENDLESS_START_Y - run.state.position.y));
  if (!cameraFrozen && run.state.phase !== 'failed') {
    const followLine = run.state.phase === 'held' ? 480 : 320;
    const target = Math.min(run.cameraY, run.state.position.y - followLine);
    const distance = target - run.cameraY;
    run.cameraY = Math.abs(distance) < 0.05 ? target : run.cameraY + distance * CAMERA_EASING;
  }
  const bottom = run.cameraY + ENDLESS_HEIGHT;
  if (bottom !== run.room.bounds.bottom) {
    run.room = { ...run.room, bounds: { ...run.room.bounds, bottom } };
  }
}

function collect(run: EndlessRun, event: Extract<LaunchEvent, { type: 'pickup' }>): LaunchEvent[] {
  if (run.collectedPickupIds.includes(event.id)) return [];
  run.collectedPickupIds.push(event.id);
  const award = event.kind === 'revive' && (run.reviveUsed || run.inventory.revive > 0) ? 'preview' : event.kind;
  run.inventory[award] += 1;
  run.room = { ...run.room, pickups: run.room.pickups?.filter((pickup) => pickup.id !== event.id) };
  return [{ ...event, kind: award, ...(award !== event.kind ? { convertedFrom: 'revive' as const } : {}) }];
}

export function stepEndless(run: EndlessRun, cameraFrozen = false): LaunchEvent[] {
  if (run.state.phase === 'failed' || run.state.phase === 'complete') return [];
  const events = stepLaunch(run.room, run.state).flatMap((event) => event.type === 'pickup' ? collect(run, event) : [event]);
  if (events.length) run.state.event = events[events.length - 1];
  const caught = events.some((event) => event.type === 'catch');
  if (caught) arrive(run, run.state.pocketId);
  updateView(run, cameraFrozen);
  if (caught) run.lastCatchSnapshot = captureEndlessWorld(run);
  return events;
}

function spend(run: EndlessRun, kind: ToolKind, paid: boolean): boolean {
  if (paid) return true;
  if (run.inventory[kind] <= 0) return false;
  run.inventory[kind] -= 1;
  return true;
}

export function activatePreview(run: EndlessRun, paid = false): boolean {
  if (run.state.phase !== 'held' || run.previewActive || !spend(run, 'preview', paid)) return false;
  run.previewActive = true;
  run.state.event = { type: 'tool', tick: run.state.tick, id: run.state.pocketId, kind: 'preview' };
  return true;
}

export function eligibleTeleportPockets(run: EndlessRun): readonly LaunchPocket[] {
  if (run.state.phase === 'failed' || run.state.phase === 'complete') return [];
  const bottom = Math.min(run.cameraY + ENDLESS_HEIGHT, run.room.bounds.bottom ?? Number.POSITIVE_INFINITY);
  return run.room.pockets.filter((pocket) => {
    const position = pocketPosition(pocket, run.state.tick);
    return pocket.id !== run.state.pocketId && position.y - BUTTON_RADIUS >= run.cameraY
      && position.y + BUTTON_RADIUS <= bottom && position.x - pocket.width / 2 >= 0
      && position.x + pocket.width / 2 <= run.room.bounds.width;
  });
}

export function teleportEndless(run: EndlessRun, pocketId: string, paid = false): boolean {
  if (!eligibleTeleportPockets(run).some((pocket) => pocket.id === pocketId) || !spend(run, 'teleport', paid)) return false;
  arrive(run, pocketId);
  run.state.event = { type: 'tool', tick: run.state.tick, id: pocketId, kind: 'teleport' };
  updateView(run, false);
  run.lastCatchSnapshot = captureEndlessWorld(run);
  return true;
}

export function reviveEndless(run: EndlessRun, paid = false): boolean {
  if (run.state.phase !== 'failed' || run.reviveUsed || !run.lastCatchSnapshot || !spend(run, 'revive', paid)) return false;
  const checkpoint = run.lastCatchSnapshot;
  restoreEndlessWorld(run, checkpoint);
  run.reviveUsed = true;
  run.previewActive = false;
  // A second revive can never be used in this run, including a retained free
  // charge when an externally authorized paid activation was applied.
  run.inventory.preview += run.inventory.revive;
  run.inventory.revive = 0;
  run.state.pickupIds = [...run.collectedPickupIds];
  run.room = { ...run.room, pickups: run.room.pickups?.filter((pickup) => !run.collectedPickupIds.includes(pickup.id)) };
  run.state.event = { type: 'tool', tick: run.state.tick, id: run.state.pocketId, kind: 'revive' };
  return true;
}

export function advanceEndless(
  run: EndlessRun,
  clock: LaunchClock,
  elapsedSeconds: number,
  onEvent?: (event: LaunchEvent) => void,
  cameraFrozen = false,
): number {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) return 0;
  clock.accumulator += Math.min(elapsedSeconds, MAX_FRAME_SECONDS);
  let steps = 0;
  while (clock.accumulator + 1e-8 >= LAUNCH_STEP_SECONDS) {
    clock.accumulator = Math.max(0, clock.accumulator - LAUNCH_STEP_SECONDS);
    if (run.state.phase === 'failed' || run.state.phase === 'complete') {
      resetLaunchClock(clock);
      break;
    }
    stepEndless(run, cameraFrozen).forEach((event) => onEvent?.(event));
    steps += 1;
  }
  return steps;
}
