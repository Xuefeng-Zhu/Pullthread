/** @jest-environment node */
import { describe, expect, test } from '@jest/globals';

import {
  advanceLaunch,
  createLaunchClock,
  createLaunchState,
  isPocketExpired,
  launch,
  resetLaunchClock,
  retryFromCheckpoint,
  startPocketLifetime,
  stepLaunch,
} from '../simulation';
import type { LaunchEvent, LaunchRoom } from '../types';

function course(startTemporary = false): LaunchRoom {
  return {
    id: 'fray-course', name: 'Fraying pockets', subtitle: '', hint: '',
    bounds: { width: 1000, height: 10000 }, gravity: 700,
    startPocketId: startTemporary ? 'temporary' : 'start',
    pockets: [
      { id: 'start', center: { x: 500, y: 900 }, width: 120, kind: 'start' },
      { id: 'temporary', center: { x: 300, y: 500 }, width: 80, kind: 'checkpoint', frayTicks: 480 },
    ],
    bumpers: [], hazards: [], flightTimeoutTicks: null,
  };
}

describe('temporary pocket lifetimes', () => {
  test('expires exactly four seconds after first arrival and releases with zero velocity', () => {
    const room = course(true);
    const state = createLaunchState(room);
    expect(state.pocketExpiryTicks).toEqual({ temporary: 480 });
    for (let tick = 0; tick < 479; tick += 1) expect(stepLaunch(room, state)).toEqual([]);
    expect(state.phase).toBe('held');
    expect(isPocketExpired(state, room.pockets[1])).toBe(false);
    expect(stepLaunch(room, state)).toEqual([{ type: 'fray', tick: 480, id: 'temporary' }]);
    expect(state.phase).toBe('flying');
    expect(state.velocity).toEqual({ x: 0, y: 0 });
    expect(state.position).toEqual(room.pockets[1].center);
    expect(state.frayedFall).toBe(true);
    expect(isPocketExpired(state, room.pockets[1])).toBe(true);
    expect(stepLaunch(room, state)).toEqual([]);
    expect(state.position.y).toBeGreaterThan(room.pockets[1].center.y);
  });

  test('ordinary held pockets keep unlimited aiming time and legacy state shape', () => {
    const room = course();
    const state = createLaunchState(room);
    for (let tick = 0; tick < 1000; tick += 1) stepLaunch(room, state);
    expect(state.phase).toBe('held');
    expect(state.pocketExpiryTicks).toBeUndefined();
    expect(state.frayedFall).toBeUndefined();
  });

  test('normal catches start the timer once; leaving and recatching preserves its first deadline', () => {
    const room = course();
    const state = createLaunchState(room);
    state.tick = 20;
    state.phase = 'flying';
    state.position = { x: 300, y: 490 };
    state.velocity = { x: 0, y: 2400 };
    expect(stepLaunch(room, state)).toEqual([{ type: 'catch', tick: 21, id: 'temporary' }]);
    expect(state.pocketExpiryTicks).toEqual({ temporary: 501 });
    expect(launch(room, state, { tick: 21, pocketId: 'temporary', pull: { x: 0, y: 50 } })).toBe(true);
    while (state.phase === 'flying') stepLaunch(room, state);
    expect(state.phase).toBe('held');
    expect(state.tick).toBeGreaterThan(21);
    expect(state.pocketExpiryTicks).toEqual({ temporary: 501 });
    startPocketLifetime(state, room.pockets[1]);
    expect(state.pocketExpiryTicks).toEqual({ temporary: 501 });
  });

  test('expired openings reject catches and stale launch inputs', () => {
    const room = course(true);
    const state = createLaunchState(room);
    state.tick = 479;
    state.phase = 'flying';
    state.position = { x: 300, y: 490 };
    state.velocity = { x: 0, y: 2400 };
    state.sourcePocketImmune = false;
    expect(stepLaunch(room, state)).toEqual([]);
    expect(state.phase).toBe('flying');
    expect(state.position.y).toBeGreaterThan(500);
    state.phase = 'held';
    const before = JSON.stringify(state);
    expect(launch(room, state, { tick: 480, pocketId: 'temporary', pull: { x: 0, y: 100 } })).toBe(false);
    expect(JSON.stringify(state)).toBe(before);
  });

  test('the expiry deadline advances while flying and does not restart after a recatch', () => {
    const room = course(true);
    const state = createLaunchState(room);
    state.tick = 479;
    state.phase = 'flying';
    state.position = { x: 100, y: 200 };
    state.velocity = { x: 0, y: 0 };
    expect(stepLaunch(room, state)).toEqual([]);
    expect(isPocketExpired(state, room.pockets[1])).toBe(true);
    startPocketLifetime(state, room.pockets[1]);
    expect(state.pocketExpiryTicks?.temporary).toBe(480);
  });

  test('retry rewinds the deterministic clock and restores remaining time at the latest catch', () => {
    const room = course(true);
    const state = createLaunchState(room);
    state.tick = 100;
    state.phase = 'flying';
    state.position = { x: 300, y: 490 };
    state.velocity = { x: 0, y: 2400 };
    state.sourcePocketImmune = false;
    stepLaunch(room, state);
    expect(state.checkpoint.tick).toBe(101);
    for (let tick = 101; tick < 480; tick += 1) stepLaunch(room, state);
    expect(state.frayedFall).toBe(true);
    retryFromCheckpoint(room, state);
    expect(state.tick).toBe(101);
    expect(state.pocketExpiryTicks?.temporary).toBe(480);
    expect(state.frayedFall).toBe(false);
    expect(isPocketExpired(state, room.pockets[1])).toBe(false);
  });

  test.each([30, 60, 120])('unraveling outcomes are identical at %i FPS', (fps) => {
    function run(renderFps: number) {
      const room = course(true);
      const state = createLaunchState(room);
      const clock = createLaunchClock();
      const events: LaunchEvent[] = [];
      for (let frame = 0; frame < renderFps * 5; frame += 1) {
        advanceLaunch(room, state, clock, 1 / renderFps, (event) => events.push(event));
      }
      return { state, events };
    }
    expect(run(fps)).toEqual(run(120));
  });

  test('discarding paused wall time leaves countdown time unchanged', () => {
    const room = course(true);
    const state = createLaunchState(room);
    const clock = createLaunchClock();
    advanceLaunch(room, state, clock, 0.1);
    resetLaunchClock(clock);
    const ticksRemaining = state.pocketExpiryTicks!.temporary - state.tick;
    resetLaunchClock(clock);
    expect(state.pocketExpiryTicks!.temporary - state.tick).toBe(ticksRemaining);
    advanceLaunch(room, state, clock, 1 / 120);
    expect(state.pocketExpiryTicks!.temporary - state.tick).toBe(ticksRemaining - 1);
  });
});
