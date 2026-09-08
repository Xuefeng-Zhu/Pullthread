/** @jest-environment node */
import { describe, expect, test } from '@jest/globals';
import { advanceEndless, createEndlessRun, launchEndless, stepEndless, type EndlessRun } from '../endless';
import { predictEndlessLaunch } from '../prediction';
import { cloneEndlessRun, serializeEndlessRun } from '../snapshots';
import { createLaunchClock, createLaunchState, pocketPosition } from '../simulation';
import type { LaunchBarrier, LaunchEvent, LaunchPoint } from '../types';

function fixture(kind: LaunchBarrier['kind'], tick = 0): EndlessRun {
  const run = createEndlessRun(21);
  const id = 'section-0-panel';
  run.room = { ...run.room, pockets: [
    { ...run.room.pockets[0], center: { x: 180, y: 400 }, width: 144 },
    { ...run.room.pockets[1], center: { x: 180, y: 150 }, width: 144 },
  ], barriers: [{ id, x: 20, y: 230, width: 320, height: 12, kind }],
  switches: kind === 'door' ? [{ id: 'section-0-switch', center: { x: 180, y: 300 }, radius: 14, doorIds: [id] }] : [],
  pickups: [], bumpers: [], hazards: [] };
  run.sectionProgress!.sections = run.sectionProgress!.sections.map((section, index) => index ? section : {
    ...section, barrierIds: [id], switchIds: run.room.switches!.map((sensor) => sensor.id),
  });
  run.state = createLaunchState(run.room);
  run.state.tick = tick;
  return run;
}

function parity(run: EndlessRun, pull: LaunchPoint) {
  const before = serializeEndlessRun(run);
  const prediction = predictEndlessLaunch(run, pull);
  const actual = cloneEndlessRun(run);
  expect(launchEndless(actual, pull)).toBe(true);
  const points = [{ ...actual.state.position }];
  const observed: LaunchEvent[] = [];
  for (let tick = 1; tick <= prediction.ticks; tick++) {
    const events = stepEndless(actual);
    observed.push(...events);
    if (tick % 4 === 0 || events.some((event) => ['bounce', 'catch', 'fail', 'break', 'switch'].includes(event.type))) {
      points.push({ ...actual.state.position });
    }
  }
  expect(prediction.points).toEqual(points);
  expect(prediction.outcome).toBe(actual.state.phase === 'held' ? 'catch' : actual.state.phase === 'failed' ? 'fail' : 'horizon');
  expect(prediction.pocketId).toBe(actual.state.phase === 'held' ? actual.state.pocketId : undefined);
  expect(prediction.failure).toBe(actual.state.failure);
  expect(serializeEndlessRun(run)).toBe(before);
  return { actual, observed, prediction };
}

describe('interactive flight Preview and fixed clock', () => {
  test('an orbital catch frames every future phase with full bottom pull clearance before the camera freezes', () => {
    for (const arrivalTick of [0, 90, 180, 270, 360, 450, 540, 630]) {
      const run = fixture('solid');
      const pocket = { ...run.room.pockets[0], center: { x: 180, y: -400 }, width: 104,
        orbit: { radius: 48, periodTicks: 720, phaseTicks: 0 } };
      run.room = { ...run.room, pockets: [pocket], barriers: [] };
      run.state = createLaunchState(run.room);
      run.state.tick = arrivalTick;
      run.state.position = pocketPosition(pocket, arrivalTick);
      run.cameraY = arrivalTick % 180 === 0 ? 0 : -1200;
      stepEndless(run);
      const camera = run.cameraY;
      for (let tick = 0; tick < 720; tick++) {
        stepEndless(run, true);
        expect(run.cameraY).toBe(camera);
        const screenY = run.state.position.y - camera;
        expect(screenY).toBeGreaterThanOrEqual(12);
        expect(screenY + 100 + 10).toBeLessThanOrEqual(600);
      }
    }
  });

  test('a permanent tear changes the next Preview after recovering from the first shot', () => {
    const run = fixture('tearable');
    const first = parity(run, { x: 0, y: 100 });
    expect(first.observed.some((event) => event.type === 'break')).toBe(true);
    expect(first.actual.state.pocketId).toBe('endless-0');
    expect(first.actual.state.brokenBarrierIds).toContain('section-0-panel');
    const second = parity(first.actual, { x: 0, y: 100 });
    expect(second.actual.state.pocketId).toBe('endless-1');
    expect(second.observed.some((event) => event.type === 'break')).toBe(false);
  });

  test('Preview hits a switch and passes its door without mutating the real run', () => {
    const run = fixture('door');
    const result = parity(run, { x: 0, y: 100 });
    expect(result.observed.some((event) => event.type === 'switch')).toBe(true);
    expect(result.actual.state.pocketId).toBe('endless-1');
    expect(run.state.activatedSwitchIds).toEqual([]);
  });

  test.each([0, 90, 180, 240, 329, 330, 479])('Preview uses the same shutter clock at phase %i', (tick) => {
    parity(fixture('shutter', tick), { x: 0, y: 100 });
  });

  test.each(['tearable', 'door', 'solid', 'shutter'] as const)('%s interactions are identical at 30, 60 and 120 FPS', (kind) => {
    const results = [30, 60, 120].map((fps) => {
      const run = fixture(kind);
      const clock = createLaunchClock();
      expect(launchEndless(run, { x: 0, y: 100 })).toBe(true);
      const events: LaunchEvent[] = [];
      for (let frame = 0; frame < fps * 3; frame++) advanceEndless(run, clock, 1 / fps, (event) => events.push(event));
      return { state: run.state, camera: run.cameraY, events };
    });
    expect(results[0]).toEqual(results[1]);
    expect(results[1]).toEqual(results[2]);
  });
});
