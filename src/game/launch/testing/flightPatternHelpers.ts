import type { ChallengePattern } from '../challengeTypes';
import { createEndlessRun, launchEndless, stepEndless } from '../endless';
import { createLaunchState, LAUNCH_HZ, LAUNCH_POWER, pocketPosition } from '../simulation';
import { clampEndlessPull } from '../launchInput';
import type { LaunchPoint, LaunchRoom } from '../types';

/** Test-only room assembly: witnesses are never consulted by live generation. */
export function patternRoom(pattern: ChallengePattern, entryX = pattern.entryX.min): LaunchRoom {
  return {
    id: pattern.id, name: pattern.id, subtitle: '', hint: '', gravity: 700,
    bounds: { width: 360, height: 600, top: Number.NEGATIVE_INFINITY, bottom: 120 },
    startPocketId: 'endless-0', flightTimeoutTicks: null,
    pockets: [
      { id: 'endless-0', center: { x: entryX, y: 0 }, width: 120, kind: 'start' },
      { ...pattern.receiver, id: 'endless-1', kind: 'checkpoint' },
    ],
    bumpers: pattern.bumpers.map((bumper, index) => ({ ...bumper, id: `pattern-bumper-${index}` })),
    hazards: pattern.hazards.map((hazard, index) => ({ ...hazard, id: `pattern-hazard-${index}` })),
  };
}

/** Real endless camera, failure floor and input clamp, starting at the settled held line. */
export function flyPattern(pattern: ChallengePattern, pull: LaunchPoint, entryX = pattern.entryX.min, releaseTick = 0) {
  const run = createEndlessRun(0);
  run.room = patternRoom(pattern, entryX);
  run.state = createLaunchState(run.room);
  run.state.tick = releaseTick;
  run.cameraY = -480;
  const actualPull = clampEndlessPull(pull, run.state.position, run.cameraY, run.room.bounds);
  launchEndless(run, actualPull);
  let bounces = 0;
  let minimumY = 0;
  for (let tick = 0; tick < 960 && run.state.phase === 'flying'; tick += 1) {
    const events = stepEndless(run);
    bounces += events.filter((event) => event.type === 'bounce').length;
    minimumY = Math.min(minimumY, run.state.position.y);
  }
  return {
    caught: run.state.phase === 'held' && run.state.pocketId === 'endless-1',
    phase: run.state.phase, failure: run.state.failure, bounces,
    tick: run.state.tick, minimumY, actualPull, cameraY: run.cameraY,
  };
}

export function aimAtReceiver(pattern: ChallengePattern, entryX: number, pullY: number, releaseTick = 0): LaunchPoint {
  const gravity = 700;
  const speed = pullY * LAUNCH_POWER;
  const discriminant = speed * speed - 2 * gravity * (pullY - pattern.receiver.center.y);
  if (discriminant <= 0) throw new Error('This pull cannot reach the receiver height.');
  const seconds = (speed + Math.sqrt(discriminant)) / gravity;
  const targetX = pocketPosition({ ...pattern.receiver, id: 'target', kind: 'checkpoint' }, releaseTick + seconds * LAUNCH_HZ).x;
  return { x: (targetX - entryX) / (1 - LAUNCH_POWER * seconds), y: pullY };
}

export function perturbations(pull: LaunchPoint, distance = 3): LaunchPoint[] {
  return [-distance, 0, distance].flatMap((x) => [-distance, 0, distance].map((y) => ({ x: pull.x + x, y: pull.y + y })));
}

/** Authored completing inputs stay in verification code, never in live pattern selection. */
export const FLIGHT_TIMING_WITNESSES = [
  { id: 'timing-intro-outward-right', pullY: 79, tick: 0 },
  { id: 'timing-intro-return-right', pullY: 81, tick: 0 },
  { id: 'timing-mixed-outward-right', pullY: 81, tick: 108 },
  { id: 'timing-mixed-return-right', pullY: 85, tick: 0 },
  { id: 'timing-expert-outward-right', pullY: 81, tick: 114 },
  { id: 'timing-expert-return-right', pullY: 85, tick: 42 },
] as const;

export function staticFlightPower(pattern: ChallengePattern): number {
  const band = ['intro', 'mixed', 'expert'].indexOf(pattern.band);
  if (pattern.family === 'recovery') return 76;
  if (pattern.id.includes('arc-high')) return [89, 89, 91][band];
  if (pattern.id.includes('arc-low')) return 72;
  if (pattern.id.includes('reverse-rise')) return [82, 84, 86][band];
  return [72, 72, 76][band];
}

export function flightPatternWitness(pattern: ChallengePattern, entryX = pattern.entryX.min): {
  pull: LaunchPoint; releaseTick: number;
} {
  const timing = FLIGHT_TIMING_WITNESSES.find((input) => input.id === pattern.id.replace('-mirror', ''));
  const releaseTick = timing?.tick ?? 0;
  return {
    pull: aimAtReceiver(pattern, entryX, timing?.pullY ?? staticFlightPower(pattern), releaseTick),
    releaseTick,
  };
}
