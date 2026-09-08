/** @jest-environment node */
import { describe, expect, test } from '@jest/globals';

import { createEndlessRun, launchEndless, stepEndless } from '../endless';
import { predictEndlessLaunch } from '../prediction';
import {
  advanceLaunch, BUTTON_RADIUS, createLaunchClock, createLaunchState, LAUNCH_STEP_SECONDS, launch, stepLaunch,
} from '../simulation';
import type { LaunchEvent, LaunchRoom, LaunchState } from '../types';

function room(overrides: Partial<LaunchRoom> = {}): LaunchRoom {
  return {
    id: 'wall-course', name: 'Soft fabric edges', subtitle: '', hint: '',
    bounds: { width: 360, height: 1000 }, sideWallRestitution: 0.8,
    gravity: 700, flightTimeoutTicks: null, startPocketId: 'start',
    pockets: [{ id: 'start', center: { x: 180, y: 800 }, width: 120, kind: 'start' }],
    bumpers: [], hazards: [], ...overrides,
  };
}

function projectile(course: LaunchRoom, x: number, y: number, vx: number, vy: number): LaunchState {
  return { ...createLaunchState(course), phase: 'flying', position: { x, y }, previousPosition: { x, y }, velocity: { x: vx, y: vy } };
}

describe('forgiving side walls', () => {
  test.each<[string, number, number, number, number]>([
    ['left', 20, -2400, 18, 1920],
    ['right', 340, 2400, 342, -1920],
  ])('%s wall reflects horizontal speed and completes the remaining flight time', (side, x, vx, expectedX, expectedVx) => {
    const course = room();
    const state = projectile(course, x, 200, vx, -100);
    expect(stepLaunch(course, state)).toEqual([{ type: 'bounce', tick: 1, id: `wall-${side}` }]);
    expect(state.position.x).toBeCloseTo(expectedX, 8);
    expect(state.velocity.x).toBe(expectedVx);
    expect(state.velocity.y).toBeCloseTo(-100 + 700 * LAUNCH_STEP_SECONDS, 8);
    expect(state.position.y).toBeCloseTo(200 - 100 * LAUNCH_STEP_SECONDS + 350 * LAUNCH_STEP_SECONDS ** 2, 8);
    expect(state.phase).toBe('flying');
    expect(state.failure).toBeUndefined();
  });

  test('very fast flights sweep multiple walls in one tick without tunneling or losing vertical time', () => {
    const course = room({ sideWallRestitution: 1 });
    const state = projectile(course, 180, 200, 120000, 120);
    expect(stepLaunch(course, state)).toEqual([
      { type: 'bounce', tick: 1, id: 'wall-right' },
      { type: 'bounce', tick: 1, id: 'wall-left' },
      { type: 'bounce', tick: 1, id: 'wall-right' },
    ]);
    expect(state.position.x).toBeCloseTo(200, 8);
    expect(state.velocity.x).toBe(-120000);
    expect(state.position.y).toBeCloseTo(201 + 350 * LAUNCH_STEP_SECONDS ** 2, 8);
    expect(state.velocity.y).toBeCloseTo(120 + 700 * LAUNCH_STEP_SECONDS, 8);
  });

  test('zero restitution and exact-boundary contacts cannot create repeated zero-time collisions', () => {
    const course = room({ sideWallRestitution: 0, gravity: 0 });
    const state = projectile(course, BUTTON_RADIUS, 200, -1200, 120);
    expect(stepLaunch(course, state)).toEqual([{ type: 'bounce', tick: 1, id: 'wall-left' }]);
    expect(state.position).toEqual({ x: BUTTON_RADIUS, y: 201 });
    expect(state.velocity).toEqual({ x: 0, y: 120 });
    expect(stepLaunch(course, state)).toEqual([]);
    expect(state.position.y).toBe(202);
  });

  test.each<[string, number, number, number]>([
    ['left', 35, -100, 750],
    ['right', 325, 100, -750],
  ])('a pull stretched beyond the %s wall resumes inward instead of dying or reversing outward', (side, x, pullX, vx) => {
    const course = room({ gravity: 0, pockets: [{ id: 'start', center: { x, y: 800 }, width: 60, kind: 'start' }] });
    const state = createLaunchState(course);
    expect(launch(course, state, { tick: 0, pocketId: 'start', pull: { x: pullX, y: 0 } })).toBe(true);
    expect(stepLaunch(course, state)).toEqual([{ type: 'bounce', tick: 1, id: `wall-${side}` }]);
    expect(state.velocity.x).toBe(vx);
    expect(state.position.x).toBeCloseTo((side === 'left' ? 10 : 350) + vx * LAUNCH_STEP_SECONDS, 8);
    expect(state.phase).toBe('flying');
  });

  test('a thorn encountered before the wall remains lethal', () => {
    const course = room({ gravity: 0, hazards: [{ id: 'thorn', center: { x: 300, y: 200 }, radius: 5 }] });
    const state = projectile(course, 180, 200, 48000, 0);
    expect(stepLaunch(course, state)).toEqual([{ type: 'fail', tick: 1, reason: 'hazard' }]);
    expect(state.position.x).toBeCloseTo(285, 8);
  });

  test('a returning flight can hit a thorn after its wall bounce during the same tick', () => {
    const course = room({ gravity: 0, sideWallRestitution: 1,
      hazards: [{ id: 'thorn', center: { x: 320, y: 245 }, radius: 5 }] });
    const state = projectile(course, 330, 200, 9600, 7200);
    expect(stepLaunch(course, state)).toEqual([
      { type: 'bounce', tick: 1, id: 'wall-right' },
      { type: 'fail', tick: 1, reason: 'hazard' },
    ]);
    expect(state.position.x).toBeLessThan(350);
    expect(state.position.y).toBeGreaterThan(225);
  });

  test('lower pockets catch a falling button after a missed launch and wall bounce', () => {
    const course = room({ pockets: [
      { id: 'start', center: { x: 100, y: 300 }, width: 80, kind: 'start' },
      { id: 'lower', center: { x: 180, y: 600 }, width: 330, kind: 'checkpoint' },
    ] });
    const state = createLaunchState(course);
    expect(launch(course, state, { tick: 0, pocketId: 'start', pull: { x: 100, y: 0 } })).toBe(true);
    const events: LaunchEvent[] = [];
    for (let tick = 0; tick < 240 && state.phase === 'flying'; tick += 1) events.push(...stepLaunch(course, state));
    expect(events.some((event) => event.type === 'bounce' && event.id.startsWith('wall-'))).toBe(true);
    expect(events).toContainEqual({ type: 'catch', tick: state.tick, id: 'lower' });
    expect(state.phase).toBe('held');
    expect(state.pocketId).toBe('lower');
  });

  test('leaving the source mouth clears immunity and permits falling back after wall bounces', () => {
    const course = room({ pockets: [{ id: 'start', center: { x: 180, y: 500 }, width: 330, kind: 'start' }] });
    const state = createLaunchState(course);
    expect(launch(course, state, { tick: 0, pocketId: 'start', pull: { x: 70, y: 70 } })).toBe(true);
    const events: LaunchEvent[] = [];
    let leftSource = false;
    for (let tick = 0; tick < 300 && state.phase === 'flying'; tick += 1) {
      events.push(...stepLaunch(course, state));
      leftSource ||= !state.sourcePocketImmune;
    }
    expect(leftSource).toBe(true);
    expect(events.some((event) => event.type === 'bounce' && event.id.startsWith('wall-'))).toBe(true);
    expect(events).toContainEqual({ type: 'catch', tick: state.tick, id: 'start' });
    expect(state.phase).toBe('held');
  });

  test('omitted wall restitution preserves the old lethal side boundary', () => {
    const course = room({ sideWallRestitution: undefined, gravity: 0 });
    const state = projectile(course, 340, 200, 4800, 0);
    expect(stepLaunch(course, state)).toEqual([{ type: 'fail', tick: 1, reason: 'out_of_bounds' }]);
    expect(state.position.x).toBe(370);
  });

  test('the lower death boundary remains lethal when there is no catching pocket', () => {
    const course = room();
    const state = projectile(course, 180, 1000, 0, 4800);
    expect(stepLaunch(course, state)).toEqual([{ type: 'fail', tick: 1, reason: 'out_of_bounds' }]);
  });

  test('new endless runs keep lower receivers alive below the flight peak while legacy runs retain their old floor', () => {
    const current = createEndlessRun(0);
    const legacy = createEndlessRun(0, 1);
    for (const run of [current, legacy]) {
      expect(launchEndless(run, { x: 0, y: 98 })).toBe(true);
      for (let tick = 0; tick < 500 && run.state.phase === 'flying'; tick += 1) stepEndless(run);
    }
    expect(current.state.phase).toBe('held');
    expect(current.state.pocketId).toBe('endless-0');
    expect(current.pocketsCaught).toBe(0);
    expect(current.room.bounds.bottom).toBe(600);
    expect(current.cameraY).toBeGreaterThan(-10);
    expect(legacy.state.phase).toBe('failed');
    expect(legacy.state.failure).toBe('out_of_bounds');
    expect(legacy.room.sideWallRestitution).toBeUndefined();
    expect(legacy.room.bounds.bottom).toBeLessThan(490);
  });

  test.each([30, 60, 120])('wall bounces have deterministic outcomes at %i FPS', (fps) => {
    function run(renderFps: number) {
      const course = room({ gravity: 0, sideWallRestitution: 1 });
      const state = projectile(course, 180, 200, 750, 0);
      const events: LaunchEvent[] = [];
      const clock = createLaunchClock();
      for (let frame = 0; frame < renderFps * 2; frame += 1) advanceLaunch(course, state, clock, 1 / renderFps, (event) => events.push(event));
      return { state, events };
    }
    expect(run(fps)).toEqual(run(120));
  });

  test('Preview reports the same wall bounce and landing as the shared endless simulation', () => {
    const run = createEndlessRun(0);
    run.room = { ...run.room, sideWallRestitution: 0.8 };
    // Match the touch layer's valid clamped pull at the starting anchor.
    const pull = { x: -68, y: 20 };
    const prediction = predictEndlessLaunch(run, pull);
    expect(prediction.bounces.some((bounce) => bounce.id.startsWith('wall-'))).toBe(true);
    expect(launchEndless(run, pull)).toBe(true);
    const events: LaunchEvent[] = [];
    let ticks = 0;
    while (run.state.phase === 'flying' && ticks < 960) { events.push(...stepEndless(run)); ticks += 1; }
    expect(prediction.ticks).toBe(ticks);
    expect(prediction.bounces.map((bounce) => bounce.id)).toEqual(events.filter((event) => event.type === 'bounce').map((event) => event.id));
    expect(prediction.outcome).toBe(run.state.phase === 'held' ? 'catch' : 'fail');
    if (run.state.phase === 'held') expect(prediction.pocketId).toBe(run.state.pocketId);
    else expect(prediction.failure).toBe(run.state.failure);
  });
});
