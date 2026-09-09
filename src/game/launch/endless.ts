import {
  BUTTON_RADIUS,
  LAUNCH_STEP_SECONDS,
  MAX_FRAME_SECONDS,
  createLaunchState,
  launch,
  pocketPosition,
  resetLaunchClock,
  stepLaunch,
  isPocketExpired,
  startPocketLifetime,
  activateLandingSwitches,
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
import { emptyToolInventory } from '../../commerce/contracts';
import { clearFlightToolEffects, effectivePockets, pruneToolPhaseOffsets } from './toolEffects';
import { pickupPlacement, scheduledPickupKind } from './pickups';
import { grantFreeTool, spendFreeTool } from './toolInventory';
import { captureEndlessWorld, restoreEndlessWorld } from './snapshots';
import type { SectionFamily } from './sections';
import { updateSectionWindow } from './sectionWindow';
import { updateInteractiveWindow } from './interactiveWindow';
import type { IntroducedMechanic, IntroductionProgress, WorldMechanic } from './progression';
import type { InteractiveIntroduction, InteractiveMechanic } from './interactiveProgression';

export const ENDLESS_WIDTH = 360;
export const ENDLESS_HEIGHT = 600;
export const ENDLESS_START_Y = 490;
const LOOK_AHEAD = 5;
const KEEP_BEHIND = 2;
const CAMERA_EASING = 0.08;
/** Leave room below the oldest retained catch for its pull and a readable miss. */
const RECOVERY_FLOOR_CLEARANCE = 110;

interface OwnedChallenge extends ActiveChallenge {
  readonly index: number;
  readonly bumperIds: readonly string[];
  readonly hazardIds: readonly string[];
  readonly pickupIds: readonly string[];
}

export interface OwnedSection {
  readonly id: string;
  readonly index: number;
  readonly patternId: string;
  readonly family: SectionFamily;
  readonly startRank: number;
  readonly endRank: number;
  readonly entryPocketId: string;
  readonly exitPocketId: string;
  readonly pocketIds: readonly string[];
  readonly bumperIds: readonly string[];
  readonly hazardIds: readonly string[];
  readonly pickupIds: readonly string[];
  readonly connections: readonly { from: string; to: string }[];
  readonly cue: string;
  readonly worldStage?: number;
  readonly mechanics?: readonly (WorldMechanic | InteractiveMechanic)[];
  readonly introduction?: IntroducedMechanic | InteractiveIntroduction;
  readonly windZoneIds?: readonly string[];
  readonly barrierIds?: readonly string[];
  readonly switchIds?: readonly string[];
}

export interface SectionProgress {
  nextIndex: number;
  lastFamily?: SectionFamily;
  sections: readonly OwnedSection[];
  introductions?: IntroductionProgress;
}

export interface EndlessRun {
  /** Missing on historical version-one journals. Never upgrade a run mid-flight. */
  readonly generationVersion?: 1 | 2 | 3 | 4 | 5 | 6;
  sectionProgress?: SectionProgress;
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
  /** Version six stores at most three free charges, oldest pickup first. */
  freeToolQueue?: ToolKind[];
  reviveUsed: boolean;
  previewActive: boolean;
  collectedPickupIds: string[];
  lastCatchSnapshot: EndlessWorldSnapshot | null;
}

/** A checkpoint contains world/clock/generator data, never another checkpoint or inventory. */
export type EndlessWorldSnapshot = Omit<EndlessRun,
  'inventory' | 'freeToolQueue' | 'reviveUsed' | 'previewActive' | 'collectedPickupIds' | 'lastCatchSnapshot'>;

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
  const sourceId = run.state.stitchedPocket?.pocket.id === run.state.pocketId
    ? run.state.stitchedPocket.originPocketId : run.state.pocketId;
  if ((run.generationVersion ?? 1) >= 2) {
    const section = run.sectionProgress?.sections.find((item) => item.connections.some((edge) => edge.from === sourceId));
    if (section) {
      const hasPickup = run.room.pickups?.some((pickup) => section.pickupIds.includes(pickup.id));
      const cue = hasPickup || (run.generationVersion ?? 1) >= 4 || (run.generationVersion === 3 && section.mechanics?.length) ? section.cue : {
        fork: 'Choose the roomy pockets, or try the narrower star lane.',
        cushion: 'The side cushions can bounce you back toward the pockets.',
        gate: 'Watch the moving thorns. Wait for your route to open.',
        fray: 'Loose stitches last four seconds after landing. The wide route has no timer.',
      }[section.family];
      return { pocketId: run.nextPocketId, patternId: section.patternId,
        ...(section.introduction ? { introductionKey: section.id } : {}),
        family: section.family === 'cushion' ? 'bank' : section.family === 'gate' ? 'timing' : 'arc',
        band: run.pocketsCaught < 7 ? 'intro' : run.pocketsCaught < 15 ? 'mixed' : 'expert', cue };
    }
  }
  return run.challenges.find((challenge) => challenge.pocketId === run.nextPocketId);
}

/** Both authored choices are hints, never a restriction on physically legal catches. */
export function nextEndlessTargets(run: EndlessRun): readonly string[] {
  if ((run.generationVersion ?? 1) < 2) return [run.nextPocketId];
  const sourceId = run.state.stitchedPocket?.pocket.id === run.state.pocketId
    ? run.state.stitchedPocket.originPocketId : run.state.pocketId;
  const ids = run.sectionProgress?.sections.flatMap((section) =>
    section.connections.filter((edge) => edge.from === sourceId).map((edge) => edge.to)) ?? [];
  if (!ids.length && sourceId === 'endless-0') ids.push('endless-1');
  if (!ids.length && sourceId === 'endless-1') ids.push('endless-2');
  if (run.state.stitchedPocket && !run.state.stitchedPocket.spent && run.state.stitchedPocket.pocket.id !== run.state.pocketId) ids.push(run.state.stitchedPocket.pocket.id);
  return [...new Set(ids)].filter((id) => {
    const pocket = effectivePockets(run.room, run.state).find((candidate) => candidate.id === id);
    return pocket && !isPocketExpired(run.state, pocket);
  });
}

function updateLegacyWindow(run: EndlessRun): void {
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

function updateWindow(run: EndlessRun): void {
  if ((run.generationVersion ?? 1) >= 4) updateInteractiveWindow(run);
  else if ((run.generationVersion ?? 1) >= 2) updateSectionWindow(run);
  else updateLegacyWindow(run);
}

/** Kept for version-one run continuation and historical route verification. */
export function createLegacyEndlessRun(seed: number): EndlessRun { return createEndlessRun(seed, 1); }

/** Historical section rules remain available for saved version-two runs. */
export function createSectionEndlessRun(seed: number): EndlessRun { return createEndlessRun(seed, 2); }

/** Historical stitched worlds retain their original mechanics and selection. */
export function createWorldEndlessRun(seed: number): EndlessRun { return createEndlessRun(seed, 3); }

export function createEndlessRun(seed: number, generationVersion: 1 | 2 | 3 | 4 | 5 | 6 = 6): EndlessRun {
  const stableSeed = Number.isFinite(seed) ? seed >>> 0 : 0;
  const room: LaunchRoom = {
    id: 'endless-climb',
    name: 'Pull & Launch',
    subtitle: 'How high can one little button climb?',
    hint: generationVersion >= 2
      ? 'Pull down and away, then let go. Bounce off the padded sides. Lower pockets can catch a miss.'
      : 'Pull down and away, then let go. Keep catching pockets. A fall ends your climb.',
    bounds: { width: ENDLESS_WIDTH, height: ENDLESS_HEIGHT, top: Number.NEGATIVE_INFINITY, bottom: ENDLESS_HEIGHT },
    gravity: 700,
    flightTimeoutTicks: null,
    ...(generationVersion >= 2 ? { sideWallRestitution: 0.8 } : {}),
    startPocketId: pocketId(0),
    pockets: [{ id: pocketId(0), center: { x: 80, y: ENDLESS_START_Y }, width: 78, kind: 'start' }],
    bumpers: [],
    hazards: [],
    pickups: [],
    ...(generationVersion >= 3 ? { windZones: [] } : {}),
    ...(generationVersion >= 4 ? { barriers: [], switches: [] } : {}),
  };
  const run: EndlessRun = {
    generationVersion,
    ...(generationVersion >= 2 ? { sectionProgress: { nextIndex: 0, sections: [], ...(generationVersion >= 3 ? { introductions: [0, 0, 0, 0] as IntroductionProgress } : {}) } } : {}),
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
    inventory: emptyToolInventory(),
    ...(generationVersion >= 6 ? { freeToolQueue: [] } : {}),
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
  const pocket = effectivePockets(run.room, run.state).find((candidate) => candidate.id === id)!;
  const stitchedArrival = run.state.stitchedPocket?.pocket.id === id;
  const position = pocketPosition(pocket, run.state.tick, run.state);
  Object.assign(run.state, {
    pocketId: id, phase: 'held', position, previousPosition: { ...position },
    velocity: { x: 0, y: 0 }, flightTicks: 0, sourcePocketImmune: true, failure: undefined,
    checkpoint: { pocketId: id, tick: run.state.tick, patchCollected: run.state.patchCollected },
  });
  // The exact caught position is also the stationary anchor for teleport arrivals.
  run.room = { ...run.room, pockets: run.room.pockets.map((candidate) => candidate.id === id && candidate.motion ? {
    ...candidate, motion: undefined, center: { ...position },
  } : candidate) };
  startPocketLifetime(run.state, pocket);
  activateLandingSwitches(run.room, run.state, id);
  clearFlightToolEffects(run.state);
  if (!stitchedArrival) {
    run.state.stitchedPocket = undefined;
    run.state.stitchUsedSinceAuthored = undefined;
  }
  if (run.state.frayedFall !== undefined) run.state.frayedFall = false;
  const index = stitchedArrival ? run.highestPocket : (run.generationVersion ?? 1) >= 2 ? pocket.ascentRank! : pocketIndex(id);
  if (index > run.highestPocket) {
    run.pocketsCaught += 1;
    run.highestPocket = index;
  }
  if (!stitchedArrival) updateWindow(run);
  pruneToolPhaseOffsets(run.room, run.state);
}

function updateView(run: EndlessRun, cameraFrozen: boolean): void {
  run.height = Math.max(run.height, Math.round(ENDLESS_START_Y - run.state.position.y));
  // The room stores the physics choice so an existing journal/replay keeps its
  // rules. New section runs can recover beneath the peak of a missed launch.
  const forgiving = run.room.sideWallRestitution !== undefined;
  if (!cameraFrozen && run.state.phase !== 'failed') {
    const followLine = run.state.phase === 'held' ? 480 : 320;
    let target = Math.min(run.cameraY, run.state.position.y - followLine);
    if (forgiving) {
      if (run.state.phase === 'held') {
        const held = effectivePockets(run.room, run.state).find((pocket) => pocket.id === run.state.pocketId);
        const lowestAnchor = held?.orbit ? held.center.y + held.orbit.radius : run.state.position.y;
        target = Math.min(0, lowestAnchor - followLine);
      }
      else if (run.state.velocity.y > 0) {
        // A dead zone prevents the camera reversing at the exact flight apex.
        target = Math.min(0, Math.max(run.cameraY, run.state.position.y - 380));
      }
    }
    const distance = target - run.cameraY;
    run.cameraY = Math.abs(distance) < 0.05 ? target : run.cameraY + distance * CAMERA_EASING;
    const heldOrbit = run.state.phase === 'held'
      ? run.room.pockets.find((pocket) => pocket.id === run.state.pocketId && pocket.orbit) : undefined;
    if (heldOrbit?.orbit) {
      // A catch can happen at the top of the orbit. Frame its complete future
      // travel before the next gesture freezes the camera, including full pull.
      run.cameraY = Math.max(heldOrbit.center.y + heldOrbit.orbit.radius - 480,
        Math.min(run.cameraY, heldOrbit.center.y - heldOrbit.orbit.radius - 12));
    }
  }
  const bottom = forgiving
    ? Math.max(...effectivePockets(run.room, run.state).map((pocket) => pocket.center.y + (pocket.orbit?.radius ?? 0))) + RECOVERY_FLOOR_CLEARANCE
    : run.cameraY + ENDLESS_HEIGHT;
  if (bottom !== run.room.bounds.bottom) {
    run.room = { ...run.room, bounds: { ...run.room.bounds, bottom } };
  }
}

function collect(run: EndlessRun, event: Extract<LaunchEvent, { type: 'pickup' }>): LaunchEvent[] {
  if (run.collectedPickupIds.includes(event.id)) return [];
  run.collectedPickupIds.push(event.id);
  const award = event.kind === 'revive' && (run.reviveUsed || run.inventory.revive > 0) ? 'preview' : event.kind;
  const replacedKind = grantFreeTool(run, award);
  run.room = { ...run.room, pickups: run.room.pickups?.filter((pickup) => pickup.id !== event.id) };
  return [{ ...event, kind: award, ...(award !== event.kind ? { convertedFrom: 'revive' as const } : {}),
    ...(replacedKind ? { replacedKind } : {}) }];
}

export function stepEndless(run: EndlessRun, cameraFrozen = false): LaunchEvent[] {
  if (run.state.phase === 'failed' || run.state.phase === 'complete') return [];
  const events = stepLaunch(run.room, run.state).flatMap((event) => event.type === 'pickup' ? collect(run, event) : [event]);
  if (events.length) run.state.event = events[events.length - 1];
  const caught = events.some((event) => event.type === 'catch');
  if (caught) arrive(run, run.state.pocketId);
  else if (events.some((event) => event.type === 'fail' || event.type === 'complete')) {
    clearFlightToolEffects(run.state);
    if (run.state.stitchedPocket?.pocket.id !== run.state.pocketId) run.state.stitchedPocket = undefined;
  }
  updateView(run, cameraFrozen);
  if (caught) run.lastCatchSnapshot = captureEndlessWorld(run);
  return events;
}

function spend(run: EndlessRun, kind: ToolKind, paid: boolean): boolean {
  if (paid) return true;
  return spendFreeTool(run, kind);
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
  return effectivePockets(run.room, run.state).filter((pocket) => {
    if (run.state.stitchedPocket?.spent && pocket.id === run.state.stitchedPocket.pocket.id) return false;
    const position = pocketPosition(pocket, run.state.tick, run.state);
    return !isPocketExpired(run.state, pocket) && pocket.id !== run.state.pocketId && position.y - BUTTON_RADIUS >= run.cameraY
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
  if (run.freeToolQueue) run.freeToolQueue = run.freeToolQueue.map((kind) => kind === 'revive' ? 'preview' : kind);
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
  cameraFrozen: boolean | (() => boolean) = false,
  onStep?: () => void,
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
    stepEndless(run, typeof cameraFrozen === 'function' ? cameraFrozen() : cameraFrozen).forEach((event) => onEvent?.(event));
    onStep?.();
    steps += 1;
  }
  return steps;
}
