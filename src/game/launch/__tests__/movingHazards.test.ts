/** @jest-environment node */
import { describe, expect, test } from '@jest/globals';

import { advanceLaunch, createLaunchClock, createLaunchState, hazardPosition, stepLaunch } from '../simulation';
import type { LaunchEvent, LaunchHazard, LaunchRoom } from '../types';

function course(hazard: LaunchHazard): LaunchRoom {
  return {
    id: 'gate-course', name: 'Moving gates', subtitle: '', hint: '',
    bounds: { width: 2000, height: 2000 }, gravity: 0, flightTimeoutTicks: null,
    startPocketId: 'start',
    pockets: [{ id: 'start', center: { x: 1000, y: 1800 }, width: 100, kind: 'start' }],
    bumpers: [], hazards: [hazard],
  };
}

describe('deterministic moving hazards', () => {
  test('positions share the pocket sine clock and support either movement axis', () => {
    const hazard: LaunchHazard = {
      id: 'gate', center: { x: 100, y: 200 }, radius: 10,
      motion: { amplitude: 80, periodTicks: 480, phaseTicks: 0 },
    };
    expect(hazardPosition(hazard, 0)).toEqual(hazard.center);
    expect(hazardPosition(hazard, 120)).toEqual({ x: 180, y: 200 });
    expect(hazardPosition({ ...hazard, motion: { ...hazard.motion!, axis: 'y' } }, 120)).toEqual({ x: 100, y: 280 });
    expect(hazardPosition({ ...hazard, motion: undefined }, 120)).toEqual(hazard.center);
  });

  test('a moving hazard cannot tunnel through a stationary airborne button', () => {
    const room = course({
      id: 'gate', center: { x: 100, y: 200 }, radius: 10,
      motion: { amplitude: 200, periodTicks: 4, phaseTicks: 0 },
    });
    const state = createLaunchState(room);
    state.phase = 'flying';
    state.position = { x: 200, y: 200 };
    expect(stepLaunch(room, state)).toEqual([{ type: 'fail', tick: 1, reason: 'hazard' }]);
    expect(state.position).toEqual({ x: 200, y: 200 });
  });

  test('relative motion preserves a miss when obstacle and button travel together', () => {
    const room = course({
      id: 'gate', center: { x: 100, y: 200 }, radius: 10,
      motion: { amplitude: 200, periodTicks: 4, phaseTicks: 0 },
    });
    const state = createLaunchState(room);
    state.phase = 'flying';
    state.position = { x: 200, y: 200 };
    state.velocity = { x: 24000, y: 0 };
    expect(stepLaunch(room, state)).toEqual([]);
    expect(state.position).toEqual({ x: 400, y: 200 });
    expect(state.phase).toBe('flying');
  });

  test('sweeps the correct fractional hazard path after a bumper bounce', () => {
    const room: LaunchRoom = {
      ...course({
        id: 'gate', center: { x: 500, y: 100 }, radius: 10,
        motion: { amplitude: 100, periodTicks: 4, phaseTicks: 0, axis: 'y' },
      }),
      bumpers: [{ id: 'cushion', center: { x: 700, y: 200 }, radius: 20, restitution: 1 }],
    };
    const state = createLaunchState(room);
    state.phase = 'flying';
    state.position = { x: 500, y: 200 };
    state.velocity = { x: 48000, y: 0 };
    expect(stepLaunch(room, state)).toEqual([
      { type: 'bounce', tick: 1, id: 'cushion' },
      { type: 'fail', tick: 1, reason: 'hazard' },
    ]);
    expect(state.position.x).toBeLessThan(530);
    expect(state.position.x).toBeGreaterThan(500);
  });

  test.each([30, 60, 120])('moving obstacle collision results match at %i FPS', (fps) => {
    function run(renderFps: number) {
      const room = course({
        id: 'gate', center: { x: 100, y: 200 }, radius: 10,
        motion: { amplitude: 200, periodTicks: 480, phaseTicks: 0 },
      });
      const state = createLaunchState(room);
      state.phase = 'flying';
      state.position = { x: 200, y: 200 };
      const clock = createLaunchClock();
      const events: LaunchEvent[] = [];
      for (let frame = 0; frame < renderFps; frame += 1) {
        advanceLaunch(room, state, clock, 1 / renderFps, (event) => events.push(event));
      }
      return { state, events };
    }
    expect(run(fps)).toEqual(run(120));
    expect(run(fps).state.failure).toBe('hazard');
  });
});
