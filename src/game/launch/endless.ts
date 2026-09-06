import {
  LAUNCH_STEP_SECONDS,
  MAX_FRAME_SECONDS,
  createLaunchState,
  launch,
  resetLaunchClock,
  stepLaunch,
} from './simulation';
import type {
  LaunchBumper,
  LaunchClock,
  LaunchEvent,
  LaunchHazard,
  LaunchPocket,
  LaunchPoint,
  LaunchRoom,
  LaunchState,
} from './types';
import { chooseChallenge } from './challenges';
import type { ActiveChallenge, AnchorRange, ChallengeFamily, ChallengePattern } from './challengeTypes';

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
}

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
    pockets.push(pocket);
    bumpers.push(...ownedBumpers);
    hazards.push(...ownedHazards);
    run.challenges = [...run.challenges, {
      index, pocketId: pocket.id, patternId: pattern.id, family: pattern.family,
      band: pattern.band, cue: pattern.cue,
      bumperIds: ownedBumpers.map((bumper) => bumper.id), hazardIds: ownedHazards.map((hazard) => hazard.id),
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
  run.room = {
    ...run.room,
    pockets: retainedPockets,
    bumpers: bumpers.filter((bumper) => retainedBumpers.has(bumper.id)),
    hazards: hazards.filter((hazard) => retainedHazards.has(hazard.id)),
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
  };
  updateWindow(run);
  return run;
}

export function launchEndless(run: EndlessRun, pull: LaunchPoint): boolean {
  return launch(run.room, run.state, { tick: run.state.tick, pocketId: run.state.pocketId, pull });
}

export function stepEndless(run: EndlessRun, cameraFrozen = false): LaunchEvent[] {
  if (run.state.phase === 'failed' || run.state.phase === 'complete') return [];
  const events = stepLaunch(run.room, run.state);
  if (events.some((event) => event.type === 'catch')) {
    const caughtId = run.state.pocketId;
    // A moving receiver becomes a stable launch pocket at the actual caught position.
    run.room = {
      ...run.room,
      pockets: run.room.pockets.map((pocket) => pocket.id === caughtId && pocket.motion ? {
        id: pocket.id,
        kind: pocket.kind,
        width: pocket.width,
        center: { ...run.state.position },
      } : pocket),
    };
    const caughtIndex = pocketIndex(caughtId);
    if (caughtIndex > run.highestPocket) {
      run.pocketsCaught += 1;
      run.highestPocket = caughtIndex;
    }
    updateWindow(run);
  }
  run.height = Math.max(run.height, Math.round(ENDLESS_START_Y - run.state.position.y));
  if (!cameraFrozen && !events.some((event) => event.type === 'fail')) {
    const followLine = run.state.phase === 'held' ? 480 : 320;
    const target = Math.min(run.cameraY, run.state.position.y - followLine);
    const distance = target - run.cameraY;
    run.cameraY = Math.abs(distance) < 0.05 ? target : run.cameraY + distance * CAMERA_EASING;
  }
  const bottom = run.cameraY + ENDLESS_HEIGHT;
  if (bottom !== run.room.bounds.bottom) {
    run.room = { ...run.room, bounds: { ...run.room.bounds, bottom } };
  }
  return events;
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
