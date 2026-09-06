/** @jest-environment node */
import { describe, expect, test } from '@jest/globals';

import {
  advanceLaunch,
  BUTTON_RADIUS,
  clampPull,
  createLaunchClock,
  createLaunchState,
  LAUNCH_HZ,
  LAUNCH_POWER,
  LAUNCH_STEP_SECONDS,
  launch,
  MAX_FLIGHT_TICKS,
  MAX_PULL,
  pocketPosition,
  resetLaunchClock,
  retryFromCheckpoint,
  stepLaunch,
} from '../simulation';
import type { LaunchEvent, LaunchInput, LaunchRoom, LaunchState } from '../types';

function room(overrides: Partial<LaunchRoom> = {}): LaunchRoom {
  return {
    id: 'test',
    name: 'Test course',
    subtitle: 'A deterministic test course',
    hint: 'Pull and release',
    bounds: { width: 1000, height: 1000 },
    gravity: 700,
    startPocketId: 'start',
    pockets: [
      { id: 'start', center: { x: 100, y: 800 }, width: 100, kind: 'start' },
      { id: 'goal', center: { x: 400, y: 400 }, width: 100, kind: 'goal' },
    ],
    bumpers: [],
    hazards: [],
    ...overrides,
  };
}

function projectile(course: LaunchRoom, x: number, y: number, vx: number, vy: number): LaunchState {
  return {
    ...createLaunchState(course),
    phase: 'flying',
    position: { x, y },
    previousPosition: { x, y },
    velocity: { x: vx, y: vy },
  };
}

describe('pull and launch', () => {
  test('releases from the stretched position, opposite the quantized pull', () => {
    const course = room();
    const state = createLaunchState(course);
    const accepted = launch(course, state, { tick: 0, pocketId: 'start', pull: { x: -30.004, y: 40.004 } });

    expect(accepted).toBe(true);
    expect(state.position).toEqual({ x: 70, y: 840 });
    expect(state.velocity).toEqual({ x: 30 * LAUNCH_POWER, y: -40 * LAUNCH_POWER });
    expect(state.previousPosition).toEqual(state.position);
    expect(state.launches).toBe(1);
    expect(state.event).toEqual({ type: 'launch', tick: 0, id: 'start' });
  });

  test('limits power radially and rejects taps and invalid, stale or midair inputs without mutation', () => {
    expect(clampPull({ x: 300, y: 400 })).toEqual({ x: 60, y: 80 });
    expect(Math.hypot(...Object.values(clampPull({ x: -1e4, y: 1e4 })))) .toBeCloseTo(MAX_PULL, 8);
    const course = room();
    const state = createLaunchState(course);
    const snapshot = JSON.stringify(state);
    const invalid: LaunchInput[] = [
      { tick: 0, pocketId: 'start', pull: { x: 3, y: 4 } },
      { tick: 0, pocketId: 'start', pull: { x: Number.NaN, y: 50 } },
      { tick: 0, pocketId: 'start', pull: { x: 20, y: Infinity } },
      { tick: 1, pocketId: 'start', pull: { x: -30, y: 50 } },
      { tick: 0, pocketId: 'goal', pull: { x: -30, y: 50 } },
    ];
    invalid.forEach((input) => expect(launch(course, state, input)).toBe(false));
    expect(JSON.stringify(state)).toBe(snapshot);
    expect(launch(course, state, { tick: 0, pocketId: 'start', pull: { x: -30, y: 50 } })).toBe(true);
    const flying = JSON.stringify(state);
    expect(launch(course, state, { tick: 0, pocketId: 'start', pull: { x: -60, y: 50 } })).toBe(false);
    expect(JSON.stringify(state)).toBe(flying);
  });

  test('integrates downward ballistic gravity at normal speed', () => {
    const course = room();
    const state = projectile(course, 500, 100, 120, -100);
    for (let index = 0; index < LAUNCH_HZ / 2; index += 1) stepLaunch(course, state);
    expect(state.tick).toBe(60);
    expect(state.position.x).toBeCloseTo(560, 7);
    expect(state.position.y).toBeCloseTo(100 - 100 * 0.5 + 0.5 * 700 * 0.5 ** 2, 7);
    expect(state.velocity.y).toBeCloseTo(250, 7);
  });
});

describe('swept contacts', () => {
  test('a fast button cannot tunnel through a hazard', () => {
    const course = room({ hazards: [{ id: 'thorn', center: { x: 300, y: 200 }, radius: 5 }] });
    const state = projectile(course, 100, 200, 48000, 0);
    expect(stepLaunch(course, state)).toEqual([{ type: 'fail', tick: 1, reason: 'hazard' }]);
    expect(state.position.x).toBeCloseTo(300 - 5 - BUTTON_RADIUS, 3);
    expect(state.phase).toBe('failed');
  });

  test('the earliest bumper reflects before a farther hazard, independently of authored bumper order', () => {
    const course = room({
      bounds: { width: 2000, height: 1000 },
      bumpers: [
        { id: 'far', center: { x: 900, y: 200 }, radius: 20, restitution: 1 },
        { id: 'near', center: { x: 700, y: 200 }, radius: 20, restitution: 1 },
      ],
      hazards: [{ id: 'far-thorn', center: { x: 800, y: 200 }, radius: 20 }],
    });
    const state = projectile(course, 500, 200, 48000, 0);
    const events = stepLaunch(course, state);
    expect(events).toEqual([{ type: 'bounce', tick: 1, id: 'near' }]);
    expect(state.velocity.x).toBeLessThan(0);
    expect(state.position.x).toBeLessThan(670);
    expect(state.phase).toBe('flying');
  });

  test('a nearer thorn wins over a later catch or bumper', () => {
    const course = room({
      hazards: [{ id: 'near-thorn', center: { x: 400, y: 300 }, radius: 5 }],
      bumpers: [{ id: 'lower-bumper', center: { x: 400, y: 500 }, radius: 20, restitution: 1 }],
    });
    const state = projectile(course, 400, 200, 0, 36000);
    expect(stepLaunch(course, state)[0]).toEqual({ type: 'fail', tick: 1, reason: 'hazard' });
    expect(state.phase).toBe('failed');
  });

  test('captures across the mouth while descending, with generous edge tolerance', () => {
    const course = room();
    const state = projectile(course, 445, 380, 0, 6000);
    expect(stepLaunch(course, state)).toEqual([{ type: 'complete', tick: 1, id: 'goal' }]);
    expect(state.position).toEqual({ x: 400, y: 400 });
    expect(state.velocity).toEqual({ x: 0, y: 0 });
  });

  test('does not capture from underneath, the side, or outside the opening', () => {
    const course = room();
    const attempts = [
      projectile(course, 400, 410, 0, -6000),
      projectile(course, 350, 401, 6000, 0),
      projectile(course, 448, 380, 0, 6000),
    ];
    attempts.forEach((state) => {
      expect(stepLaunch(course, state)).toEqual([]);
      expect(state.phase).toBe('flying');
    });
  });

  test('ignores the stretched source until it has been left, then allows a return catch', () => {
    const course = room();
    const state = createLaunchState(course);
    launch(course, state, { tick: 0, pocketId: 'start', pull: { x: 0, y: 50 } });
    stepLaunch(course, state);
    expect(state.phase).toBe('flying');
    expect(state.sourcePocketImmune).toBe(true);
    const events: LaunchEvent[] = [];
    while (state.phase === 'flying' && state.tick < 200) events.push(...stepLaunch(course, state));
    expect(events).toContainEqual({ type: 'catch', tick: state.tick, id: 'start' });
    expect(state.phase).toBe('held');
  });

  test('moving mouths use the crossing time and keep moving while held', () => {
    const movingGoal = { id: 'goal', center: { x: 400, y: 400 }, width: 50, kind: 'goal' as const,
      motion: { amplitude: 100, periodTicks: 480, phaseTicks: 0 } };
    const course = room({ pockets: [room().pockets[0], movingGoal] });
    const held = createLaunchState(course);
    for (let index = 0; index < 120; index += 1) stepLaunch(course, held);
    expect(held.tick).toBe(120);
    expect(held.phase).toBe('held');
    expect(pocketPosition(movingGoal, held.tick).x).toBeCloseTo(500, 8);

    const hit = projectile(course, 500, 390, 0, 2400);
    hit.tick = 119;
    expect(stepLaunch(course, hit)[0]?.type).toBe('complete');
    const miss = projectile(course, 500, 390, 0, 2400);
    miss.tick = 359;
    expect(stepLaunch(course, miss)).toEqual([]);
  });
});

describe('forgiving retries and clocks', () => {
  test('captures a checkpoint and restores its clock and collected patch after a miss', () => {
    const checkpoint = { id: 'middle', center: { x: 400, y: 400 }, width: 100, kind: 'checkpoint' as const };
    const course = room({ pockets: [...room().pockets, checkpoint].filter((pocket) => pocket.id !== 'goal'),
      patch: { center: { x: 400, y: 350 }, radius: 10 } });
    const state = projectile(course, 400, 300, 0, 6000);
    state.tick = 100;
    stepLaunch(course, state);
    stepLaunch(course, state);
    expect(state.phase).toBe('held');
    expect(state.patchCollected).toBe(true);
    const saved = { ...state.checkpoint };
    expect(saved).toEqual({ pocketId: 'middle', tick: 102, patchCollected: true });
    for (let index = 0; index < 60; index += 1) stepLaunch(course, state);
    launch(course, state, { tick: state.tick, pocketId: 'middle', pull: { x: -100, y: 0 } });
    while (state.phase === 'flying') stepLaunch(course, state);
    expect(state.failure).toBe('out_of_bounds');
    retryFromCheckpoint(course, state);
    expect(state.tick).toBe(saved.tick);
    expect(state.position).toEqual(checkpoint.center);
    expect(state.pocketId).toBe('middle');
    expect(state.patchCollected).toBe(true);
    expect(state.failure).toBeUndefined();
    expect(state.launches).toBe(1);
  });

  test('a patch collected after the checkpoint is lost on retry; restart clears everything', () => {
    const course = room({ patch: { center: { x: 400, y: 350 }, radius: 10 } });
    const state = projectile(course, 400, 300, 0, 2400);
    stepLaunch(course, state);
    stepLaunch(course, state);
    expect(state.patchCollected).toBe(true);
    retryFromCheckpoint(course, state);
    expect(state.patchCollected).toBe(false);
    expect(state.tick).toBe(0);
    expect(state.position).toEqual(course.pockets[0].center);
    state.launches = 5;
    expect(createLaunchState(course).launches).toBe(0);
  });

  test('fails after exactly eight seconds in flight and freezes until retry', () => {
    const course = room({ gravity: 0 });
    const state = projectile(course, 500, 200, 0, 0);
    for (let index = 0; index < MAX_FLIGHT_TICKS - 1; index += 1) stepLaunch(course, state);
    expect(state.phase).toBe('flying');
    expect(stepLaunch(course, state)).toEqual([{ type: 'fail', tick: MAX_FLIGHT_TICKS, reason: 'timeout' }]);
    const final = JSON.stringify(state);
    stepLaunch(course, state);
    expect(JSON.stringify(state)).toBe(final);
  });

  test.each([30, 60, 120])('tick-indexed inputs produce identical results when rendered at %i FPS', (fps) => {
    const course = room({ gravity: 0 });
    const input: LaunchInput = { tick: 120, pocketId: 'start', pull: { x: -30, y: 50 } };
    function run(renderFps: number) {
      const state = createLaunchState(course);
      const clock = createLaunchClock();
      for (let frame = 0; frame < renderFps * 2; frame += 1) {
        if (state.tick === input.tick) launch(course, state, input);
        advanceLaunch(course, state, clock, 1 / renderFps);
      }
      return state;
    }
    expect(run(fps)).toEqual(run(120));
    expect(run(fps).tick).toBe(240);
  });

  test('clears fractional foreground time on pause and rejects invalid frame times', () => {
    const course = room();
    const state = createLaunchState(course);
    const clock = createLaunchClock();
    expect(advanceLaunch(course, state, clock, LAUNCH_STEP_SECONDS / 2)).toBe(0);
    resetLaunchClock(clock);
    expect(clock.accumulator).toBe(0);
    expect(advanceLaunch(course, state, clock, LAUNCH_STEP_SECONDS / 2)).toBe(0);
    expect(state.tick).toBe(0);
    expect(advanceLaunch(course, state, clock, Number.NaN)).toBe(0);
    expect(advanceLaunch(course, state, clock, -1)).toBe(0);
    expect(advanceLaunch(course, state, clock, LAUNCH_STEP_SECONDS / 2)).toBe(1);
    expect(state.tick).toBe(1);
  });

  test('bounds foreground stalls instead of catching up several seconds at once', () => {
    const course = room();
    const state = createLaunchState(course);
    expect(advanceLaunch(course, state, createLaunchClock(), 10)).toBe(12);
    expect(state.tick).toBe(12);
  });
});
