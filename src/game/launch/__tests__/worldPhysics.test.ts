/** @jest-environment node */
import { describe, expect, test } from '@jest/globals';
import { advanceLaunch, createLaunchClock, createLaunchState, LAUNCH_STEP_SECONDS, stepLaunch, windAccelerationAt } from '../simulation';
import type { LaunchRoom } from '../types';

function course(overrides: Partial<LaunchRoom> = {}): LaunchRoom {
  return { id: 'world-physics', name: 'World physics', subtitle: '', hint: '', gravity: 0,
    bounds: { width: 1000, height: 1000 }, startPocketId: 'start',
    pockets: [{ id: 'start', center: { x: 100, y: 800 }, width: 104, kind: 'start' }],
    bumpers: [], hazards: [], windZones: [{ id: 'wind', x: 100, y: 100, width: 100, height: 150, accelerationX: 100 }],
    ...overrides };
}
function flying(room: LaunchRoom, x = 120, y = 140, vx = 0, vy = 0) {
  return { ...createLaunchState(room), phase: 'flying' as const, position: { x, y },
    previousPosition: { x, y }, velocity: { x: vx, y: vy } };
}

describe('world forces on the fixed simulation clock', () => {
  test('wind applies once per flight tick and has precise nonoverlapping boundaries', () => {
    const room = course();
    const state = flying(room);
    stepLaunch(room, state);
    expect(state.velocity.x).toBeCloseTo(100 * LAUNCH_STEP_SECONDS, 12);
    expect(state.position.x).toBeCloseTo(120 + 100 * LAUNCH_STEP_SECONDS ** 2, 12);
    expect(windAccelerationAt(room.windZones, { x: 100, y: 100 })).toBe(100);
    for (const point of [{ x: 200, y: 100 }, { x: 100, y: 250 }, { x: 99.99, y: 140 }]) {
      expect(windAccelerationAt(room.windZones, point)).toBe(0);
    }
    const held = createLaunchState({ ...room, windZones: [{ ...room.windZones![0], y: 700 }] });
    stepLaunch(room, held);
    expect(held.velocity).toEqual({ x: 0, y: 0 });
  });

  test('entering and leaving a ribbon samples the beginning of each tick', () => {
    const room = course();
    const state = flying(room, 99, 140, 240);
    stepLaunch(room, state);
    expect(state.velocity.x).toBe(240);
    stepLaunch(room, state);
    expect(state.velocity.x).toBeCloseTo(240 + 100 / 120, 12);
    state.position.x = 199;
    stepLaunch(room, state);
    const exitSpeed = state.velocity.x;
    expect(state.position.x).toBeGreaterThan(200);
    stepLaunch(room, state);
    expect(state.velocity.x).toBe(exitSpeed);
  });

  test('mirrored wind and release produce mirrored flight', () => {
    const left = course();
    const right = course({ windZones: [{ ...left.windZones![0], x: 800, accelerationX: -100 }] });
    const a = flying(left, 140, 140, 15, 10);
    const b = flying(right, 860, 140, -15, 10);
    for (let tick = 0; tick < 120; tick++) {
      stepLaunch(left, a); stepLaunch(right, b);
      expect(a.position.x + b.position.x).toBeCloseTo(1000, 9);
      expect(a.position.y).toBe(b.position.y);
      expect(a.velocity.x).toBe(-b.velocity.x);
    }
  });

  test('wind kicks remain identical with pickups and multiple contacts in the same tick', () => {
    const room = course({ windZones: [{ id: 'wind', x: 0, y: 100, width: 100, height: 150, accelerationX: -100 }],
      sideWallRestitution: 0.8 });
    const withPickup = { ...room, pickups: [{ id: 'gift', kind: 'preview' as const, radius: 1, center: { x: 11, y: 140 } }] };
    const a = flying(room, 11, 140, -240);
    const b = flying(withPickup, 11, 140, -240);
    expect(stepLaunch(room, a).some((event) => event.type === 'bounce')).toBe(true);
    expect(stepLaunch(withPickup, b).some((event) => event.type === 'pickup')).toBe(true);
    expect(a.position).toEqual(b.position);
    expect(a.velocity).toEqual(b.velocity);
    expect(a.velocity.x).toBeCloseTo((240 + 100 / 120) * 0.8, 10);
  });

  test('30, 60 and 120 FPS deliver identical wind and spring simulation', () => {
    const room = course({ gravity: 700, bumpers: [{ id: 'spring', center: { x: 150, y: 300 }, radius: 26, restitution: 0.8, springSpeed: 650 }] });
    const states = [30, 60, 120].map((fps) => {
      const state = flying(room, 125, 140, 15, 50);
      const clock = createLaunchClock();
      for (let frame = 0; frame < fps; frame++) advanceLaunch(room, state, clock, 1 / fps);
      return state;
    });
    expect(states[0]).toEqual(states[1]);
    expect(states[1]).toEqual(states[2]);
  });

  test('springs preserve at least650 outward speed and cap total rebound at850', () => {
    const room = course({ windZones: [], bumpers: [{ id: 'spring', center: { x: 200, y: 200 }, radius: 26, restitution: 0.8, springSpeed: 650 }] });
    const state = flying(room, 164, 200, 120, 900);
    const events = stepLaunch(room, state);
    expect(events.filter((event) => event.type === 'bounce')).toHaveLength(1);
    expect(state.velocity.x).toBeLessThanOrEqual(-649.99);
    expect(Math.hypot(state.velocity.x, state.velocity.y)).toBeCloseTo(850, 9);
    const normal = flying(room, 164, 200, 120, 0);
    stepLaunch(room, normal);
    expect(normal.velocity.x).toBeCloseTo(-650, 9);
    const speed = { ...normal.velocity };
    expect(stepLaunch(room, normal)).toEqual([]);
    expect(normal.velocity).toEqual(speed);
  });

  test('ordinary cushions retain restitution and a new collision can boost again', () => {
    const spring = { id: 'spring', center: { x: 200, y: 200 }, radius: 26, restitution: 0.8, springSpeed: 650 };
    const room = course({ windZones: [], bumpers: [spring] });
    const ordinary = { ...room, bumpers: [{ ...spring, springSpeed: undefined }] };
    const state = flying(ordinary, 163.99, 200, 120);
    stepLaunch(ordinary, state);
    expect(state.velocity.x).toBeCloseTo(-96, 10);
    state.position = { x: 163.99, y: 200 };
    state.velocity = { x: 120, y: 0 };
    expect(stepLaunch(room, state).some((event) => event.type === 'bounce')).toBe(true);
    expect(state.velocity.x).toBeCloseTo(-650, 10);
  });
});
