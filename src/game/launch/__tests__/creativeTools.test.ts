/** @jest-environment node */
import { describe, expect, test } from '@jest/globals';
import { createEndlessRun, launchEndless, reviveEndless, stepEndless } from '../endless';
import { sweepCircleCapsule, shutterPhase } from '../interactivePhysics';
import { applyEndlessTool, getToolPlacement, validateToolUse } from '../tools';
import { advanceLaunch, createLaunchClock, createLaunchState, hazardPosition, launch, pocketPosition, pocketVelocity, stepLaunch } from '../simulation';
import { clearFlightToolEffects, effectivePockets, integrateFlightVertical } from '../toolEffects';
import { cloneEndlessRun, deserializeEndlessRun, serializeEndlessRun } from '../snapshots';
import { predictEndlessLaunch } from '../prediction';
import type { LaunchRoom, LaunchState } from '../types';
import { grantFreeTool } from '../toolInventory';

const room = (extra: Partial<LaunchRoom> = {}): LaunchRoom => ({ id: 'creative-course', name: '', subtitle: '', hint: '',
  bounds: { width: 1000, height: 1000 }, gravity: 700, startPocketId: 'start',
  pockets: [{ id: 'start', center: { x: 100, y: 850 }, width: 80, kind: 'start' }], bumpers: [], hazards: [], ...extra });
const flying = (course: LaunchRoom, position = { x: 500, y: 300 }, velocity = { x: 0, y: 600 }): LaunchState =>
  ({ ...createLaunchState(course), phase: 'flying', position, previousPosition: { ...position }, velocity, sourcePocketImmune: false });

describe('creative tool world validation and lifecycle', () => {
  test('initial legal placements are deterministic, require charges, and cannot stack their own kind', () => {
    const run = createEndlessRun(0);
    expect(getToolPlacement(run, 'bounce', { x: 300, y: 480 }, 0)).toEqual({ tool: 'bounce', position: { x: 300, y: 480 }, angle: 0 });
    expect(getToolPlacement(run, 'stitch', { x: 80, y: 250 })).toEqual({ tool: 'stitch', position: { x: 80, y: 250 } });
    const use = { tool: 'bounce' as const, position: { x: 300, y: 480 }, angle: 0 };
    expect(applyEndlessTool(run, use)).toBe(false);
    grantFreeTool(run, 'bounce');
    grantFreeTool(run, 'bounce');
    expect(applyEndlessTool(run, use)).toBe(true);
    expect(applyEndlessTool(run, use)).toBe(false);
    expect(run.inventory.bounce).toBe(1);
    expect(launchEndless(run, { x: 0, y: 0 })).toBe(false);
    expect(run.state.toolEffects?.bounce?.spent).toBe(false);
    expect(validateToolUse(run, { ...use, angle: 180 })).toBe(false);
  });

  test('stitch catches for zero score, checkpoints, supports velcro and one departure without recatching', () => {
    const run = createEndlessRun(0);
    expect(applyEndlessTool(run, { tool: 'stitch', position: { x: 80, y: 250 } }, true)).toBe(true);
    const stitch = run.state.stitchedPocket!.pocket;
    expect(applyEndlessTool(run, { tool: 'velcro', targetId: stitch.id }, true)).toBe(true);
    const before = { caught: run.pocketsCaught, rank: run.highestPocket, cursor: run.nextPocketIndex, introductions: [...run.sectionProgress!.introductions!] };
    Object.assign(run.state, { phase: 'flying', position: { x: 80, y: 268 }, velocity: { x: 0, y: -720 }, sourcePocketImmune: false });
    expect(stepEndless(run).some((event) => event.type === 'catch' && event.id === stitch.id)).toBe(true);
    expect(run.state.toolEffects).toBeUndefined();
    expect({ caught: run.pocketsCaught, rank: run.highestPocket, cursor: run.nextPocketIndex, introductions: run.sectionProgress!.introductions }).toEqual(before);
    expect(run.lastCatchSnapshot?.state.pocketId).toBe(stitch.id);
    expect(deserializeEndlessRun(serializeEndlessRun(run))?.state.pocketId).toBe(stitch.id);
    expect(launchEndless(run, { x: 0, y: 50 })).toBe(true);
    expect(run.state.stitchedPocket?.spent).toBe(true);
    Object.assign(run.state, { position: { x: 80, y: 245 }, velocity: { x: 0, y: 720 }, sourcePocketImmune: false });
    expect(stepEndless(run).some((event) => event.type === 'catch' && event.id === stitch.id)).toBe(false);
    run.state.phase = 'failed';
    expect(reviveEndless(run, true)).toBe(true);
    expect(run.state.pocketId).toBe(stitch.id);
    expect(run.state.stitchedPocket?.spent).toBe(false);
    expect(validateToolUse(run, { tool: 'stitch', position: { x: 300, y: 500 } })).toBe(false);
  });

  test('Preview runs the same modified flight and cannot spend or mutate the prepared live tools', () => {
    const run = createEndlessRun(0);
    applyEndlessTool(run, { tool: 'sail' }, true);
    applyEndlessTool(run, { tool: 'needle' }, true);
    applyEndlessTool(run, { tool: 'bounce', position: { x: 300, y: 480 }, angle: 0 }, true);
    const before = serializeEndlessRun(run), pull = { x: -20, y: 80 };
    const prediction = predictEndlessLaunch(run, pull);
    expect(serializeEndlessRun(run)).toBe(before);
    const actual = cloneEndlessRun(run);
    expect(launchEndless(actual, pull)).toBe(true);
    for (let ticks = 0; ticks < 960 && actual.state.phase === 'flying'; ticks++) stepEndless(actual);
    expect(prediction.outcome).toBe(actual.state.phase === 'held' ? 'catch' : actual.state.phase === 'failed' ? 'fail' : 'horizon');
    if (prediction.outcome === 'catch') expect(prediction.pocketId).toBe(actual.state.pocketId);
  });

  test('all six validated tools act together: pin and pierce thorns, slow descent, bank, and velcro-catch the stitched checkpoint', () => {
    const run = createEndlessRun(0);
    const thorn = { id: 'moving-thorn', center: { x: 180, y: 280 }, radius: 6,
      motion: { amplitude: 60, periodTicks: 240, phaseTicks: 0 } };
    run.room = { ...run.room, bounds: { ...run.room.bounds, width: 600, height: 600 },
      pockets: [run.room.pockets[0]], hazards: [thorn], bumpers: [], barriers: [], switches: [], pickups: [] };
    expect(applyEndlessTool(run, { tool: 'bounce', position: { x: 180, y: 330 }, angle: 45 }, true)).toBe(true);
    expect(applyEndlessTool(run, { tool: 'pin', targetId: thorn.id }, true)).toBe(true);
    expect(applyEndlessTool(run, { tool: 'stitch', position: { x: 360, y: 430 } }, true)).toBe(true);
    const stitch = run.state.stitchedPocket!.pocket;
    expect(applyEndlessTool(run, { tool: 'velcro', targetId: stitch.id }, true)).toBe(true);
    expect(applyEndlessTool(run, { tool: 'sail' }, true)).toBe(true);
    expect(applyEndlessTool(run, { tool: 'needle' }, true)).toBe(true);
    expect(applyEndlessTool(run, { tool: 'preview' }, true)).toBe(true);
    expect(launchEndless(run, { x: 0, y: 80 })).toBe(true);
    // Start this collision fixture above the pin and cushion with a fast downward flight.
    Object.assign(run.state, { position: { x: 180, y: 250 }, previousPosition: { x: 180, y: 250 },
      velocity: { x: 0, y: 600 }, sourcePocketImmune: false });
    const events = [];
    let beforeCatchY = Infinity;
    for (let tick = 0; tick < 400 && run.state.phase === 'flying'; tick++) {
      expect(hazardPosition(thorn, run.state.tick, run.state)).toEqual(thorn.center);
      beforeCatchY = run.state.position.y;
      events.push(...stepEndless(run));
      if (run.state.phase === 'flying') expect(run.state.velocity.y).toBeLessThanOrEqual(180);
    }
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'tool', kind: 'needle', id: thorn.id }),
      expect.objectContaining({ type: 'bounce', id: 'tool-bounce' }),
      expect.objectContaining({ type: 'catch', id: stitch.id }),
    ]));
    expect(run.state.pocketId).toBe(stitch.id);
    expect(beforeCatchY).toBeLessThan(stitch.center.y - 5);
    expect(run.pocketsCaught).toBe(0);
    expect(run.state.toolEffects).toBeUndefined();
    expect(run.state.toolPhaseOffsets?.[thorn.id]).toBeGreaterThan(0);
  });

  test('placement reserves a stitched launch envelope in either preparation order', () => {
    const stitchFirst = createEndlessRun(0);
    expect(applyEndlessTool(stitchFirst, { tool: 'stitch', position: { x: 80, y: 250 } }, true)).toBe(true);
    expect(validateToolUse(stitchFirst, { tool: 'bounce', position: { x: 80, y: 170 }, angle: 0 })).toBe(false);
    const bounceFirst = createEndlessRun(0);
    expect(applyEndlessTool(bounceFirst, { tool: 'bounce', position: { x: 80, y: 170 }, angle: 0 }, true)).toBe(true);
    expect(validateToolUse(bounceFirst, { tool: 'stitch', position: { x: 80, y: 250 } })).toBe(false);
  });

  test.each(Array.from({ length: 64 }, (_, mask) => mask))('Preview exactly matches live generated-world flight for creative subset %i', (mask) => {
    const run = createEndlessRun(0);
    run.room = { ...run.room, pockets: run.room.pockets.map((pocket) => pocket.id === 'endless-1'
      ? { ...pocket, orbit: { radius: 30, periodTicks: 480, phaseTicks: 0 } } : pocket),
    hazards: [...run.room.hazards, { id: 'test-thorn', center: { x: 105, y: 421 }, radius: 10 }] };
    run.state.toolEffects = {};
    if (mask & 1) run.state.toolEffects.bounce = { position: { x: 135, y: 365 }, angle: 45, spent: false };
    if (mask & 2) run.state.toolEffects.pin = { targetId: 'endless-1', startedTick: 0 };
    if (mask & 4) run.state.toolEffects.velcro = { targetId: 'endless-1' };
    if (mask & 8) run.state.toolEffects.sail = true;
    if (mask & 16) run.state.toolEffects.needle = {};
    if (mask & 32) run.state.stitchedPocket = { pocket: { id: 'tool-stitch-0-0', center: { x: 240, y: 510 }, width: 80, kind: 'checkpoint' }, spent: false, originPocketId: 'endless-0' };
    const before = JSON.stringify(run), pull = { x: -20, y: 80 };
    const prediction = predictEndlessLaunch(run, pull);
    expect(JSON.stringify(run)).toBe(before);
    const actual = cloneEndlessRun(run);
    expect(launchEndless(actual, pull)).toBe(true);
    const bounces: { tick: number; id: string }[] = [];
    let ticks = 0;
    for (; ticks < 960 && actual.state.phase === 'flying'; ticks++) {
      for (const event of stepEndless(actual)) if (event.type === 'bounce') bounces.push({ tick: event.tick, id: event.id });
    }
    expect(prediction.ticks).toBe(ticks);
    expect(prediction.bounces.map(({ tick, id }) => ({ tick, id }))).toEqual(bounces);
    expect(prediction.outcome).toBe(actual.state.phase === 'held' ? 'catch' : actual.state.phase === 'failed' ? 'fail' : 'horizon');
    if (prediction.outcome === 'catch') expect(prediction.pocketId).toBe(actual.state.pocketId);
    expect(prediction.failure).toBe(actual.state.failure);
  });
});

describe('creative collisions and clocks', () => {
  test('rotated capsule has rounded ends and rotates the rebound normal', () => {
    const patch = { position: { x: 500, y: 400 }, length: 72, thickness: 12, angle: 45 };
    const hit = sweepCircleCapsule({ x: 500, y: 300 }, { x: 500, y: 500 }, patch, 10)!;
    expect(hit.normal.x).toBeCloseTo(Math.SQRT1_2);
    expect(hit.normal.y).toBeCloseTo(-Math.SQRT1_2);
    expect(sweepCircleCapsule({ x: 545, y: 383 }, { x: 545, y: 385 }, { ...patch, angle: 0 }, 10)).toBeUndefined();
    const course = room({ gravity: 0 });
    const state = flying(course, { x: 500, y: 395 }, { x: 0, y: 600 });
    state.toolEffects = { bounce: { position: { x: 500, y: 420 }, angle: 45, spent: false } };
    const events = Array.from({ length: 12 }, () => stepLaunch(course, state)).flat();
    expect(events.filter((event) => event.type === 'bounce' && event.id === 'tool-bounce')).toHaveLength(1);
    expect(state.velocity.x).toBeGreaterThan(500);
    expect(Math.hypot(state.velocity.x, state.velocity.y)).toBeLessThanOrEqual(600);
    expect(state.toolEffects.bounce?.spent).toBe(true);
  });

  test('pin freezes one local phase and resumes the same orbit position and shutter phase', () => {
    const pocket = { id: 'orbit', center: { x: 500, y: 400 }, width: 80, kind: 'checkpoint' as const,
      orbit: { radius: 50, periodTicks: 480, phaseTicks: 0 } };
    const state = createLaunchState(room());
    state.tick = 120; state.toolEffects = { pin: { targetId: pocket.id, startedTick: 120 } };
    const pinned = pocketPosition(pocket, 120, state);
    state.tick = 390;
    expect(pocketPosition(pocket, 390, state)).toEqual(pinned);
    expect(pocketVelocity(pocket, 390, state)).toEqual({ x: 0, y: 0 });
    clearFlightToolEffects(state);
    expect(pocketPosition(pocket, 390, state)).toEqual(pinned);
    expect(pocketVelocity(pocket, 390, state)).not.toEqual({ x: 0, y: 0 });
    const shutter = { id: 'zip', kind: 'shutter' as const, x: 400, y: 200, width: 80, height: 12 };
    state.toolEffects = { pin: { targetId: shutter.id, startedTick: 260 } };
    expect(shutterPhase(shutter, 400, state)).toBe('warning');
    expect(shutterPhase(shutter, 400)).toBe('closed');
  });

  test('sail changes only descent, integrates an apex, caps terminal speed and resets after an upward rebound', () => {
    expect(integrateFlightVertical(-700, 0.5, 700, true)).toEqual(integrateFlightVertical(-700, 0.5, 700));
    expect(integrateFlightVertical(-70, 0.2, 700, true)).toEqual({ distance: -3.5 + 1.225, velocity: 24.5 });
    expect(integrateFlightVertical(500, 1, 700, true)).toEqual({ distance: 180, velocity: 180 });
    expect(integrateFlightVertical(-350, 0.1, 700, true).velocity).toBe(-280);
  });

  test('needle passes exactly one thorn object without disturbing the flight and never passes scissors or shutters', () => {
    const thorn = { id: 'thorn', center: { x: 500, y: 320 }, radius: 14 };
    const plain = room({ gravity: 0 }), blocked = room({ gravity: 0, hazards: [thorn] });
    const a = flying(plain), b = flying(blocked); b.toolEffects = { needle: {} };
    for (let tick = 0; tick < 12; tick++) { stepLaunch(plain, a); stepLaunch(blocked, b); }
    expect(b.position).toEqual(a.position); expect(b.velocity).toEqual(a.velocity);
    expect(b.toolEffects.needle?.piercedId).toBe('thorn');
    const second = room({ gravity: 0, hazards: [thorn, { ...thorn, id: 'other', center: { x: 500, y: 370 } }] });
    const c = flying(second); c.toolEffects = { needle: {} };
    for (let tick = 0; tick < 20; tick++) stepLaunch(second, c);
    expect(c.phase).toBe('failed');
    for (const obstacle of [room({ hazards: [{ ...thorn, visual: 'scissors' }] }),
      room({ barriers: [{ id: 'zip', kind: 'shutter', x: 480, y: 320, width: 40, height: 12, phaseTicks: 350 }] })]) {
      const state = flying(obstacle); state.toolEffects = { needle: {} };
      for (let tick = 0; tick < 20; tick++) stepLaunch(obstacle, state);
      expect(state.phase).toBe('failed');
    }
  });

  test('velcro accepts relative ascent but earlier solid barriers and lethal contacts retain priority', () => {
    const target = { id: 'target', center: { x: 500, y: 400 }, width: 80, kind: 'checkpoint' as const };
    for (const blocker of [false, true]) {
      const course = room({ pockets: [...room().pockets, target], barriers: blocker ? [{ id: 'wall', kind: 'solid', x: 450, y: 425, width: 100, height: 12 }] : [] });
      const state = flying(course, { x: 500, y: 460 }, { x: 0, y: -720 });
      state.toolEffects = { velcro: { targetId: target.id } };
      for (let tick = 0; tick < 16; tick++) stepLaunch(course, state);
      expect(state.pocketId === target.id).toBe(!blocker);
    }
    const course = room({ pockets: [...room().pockets, target], hazards: [{ id: 'thorn', center: target.center, radius: 30 }] });
    const state = flying(course, { x: 500, y: 460 }, { x: 0, y: -720 });
    state.toolEffects = { velcro: { targetId: target.id } };
    for (let tick = 0; tick < 16; tick++) stepLaunch(course, state);
    expect(state.phase).toBe('failed');
  });

  test.each(Array.from({ length: 64 }, (_, mask) => mask))('all creative subset %i stays deterministic at 30/60/120 FPS', (mask) => {
    const course = room({ pockets: [...room().pockets, { id: 'target', center: { x: 600, y: 780 }, width: 80, kind: 'checkpoint',
      orbit: { radius: 30, periodTicks: 480, phaseTicks: 0 } }],
      hazards: [{ id: 'thorn', center: { x: 260, y: 730 }, radius: 14 }],
      windZones: [{ id: 'wind', x: 250, y: 600, width: 500, height: 300, accelerationX: 100 }],
      barriers: [{ id: 'shutter', kind: 'shutter', x: 850, y: 500, width: 12, height: 200 },
        { id: 'cloth', kind: 'tearable', x: 900, y: 800, width: 12, height: 100 }],
      bumpers: [{ id: 'spring', center: { x: 750, y: 850 }, radius: 26, restitution: 0.9, springSpeed: 650 }], sideWallRestitution: 0.8 });
    const initial = createLaunchState(course); initial.toolEffects = {};
    if (mask & 1) initial.toolEffects.bounce = { position: { x: 430, y: 710 }, angle: 135, spent: false };
    if (mask & 2) initial.toolEffects.pin = { targetId: 'target', startedTick: 0 };
    if (mask & 4) initial.toolEffects.velcro = { targetId: 'target' };
    if (mask & 8) initial.toolEffects.sail = true;
    if (mask & 16) initial.toolEffects.needle = {};
    if (mask & 32) initial.stitchedPocket = { pocket: { id: 'tool-stitch-0-0', center: { x: 650, y: 820 }, width: 80, kind: 'checkpoint' }, spent: false, originPocketId: 'start' };
    const results = [30, 60, 120].map((fps) => {
      const state: LaunchState = JSON.parse(JSON.stringify(initial));
      expect(launch(course, state, { tick: 0, pocketId: 'start', pull: { x: -60, y: 75 } })).toBe(true);
      const clock = createLaunchClock();
      for (let frame = 0; frame < fps * 6; frame++) advanceLaunch(course, state, clock, 1 / fps);
      return state;
    });
    expect(results[0]).toEqual(results[1]); expect(results[1]).toEqual(results[2]);
    expect(effectivePockets(course, results[0]).length).toBe(course.pockets.length + (mask & 32 ? 1 : 0));
  });
});
