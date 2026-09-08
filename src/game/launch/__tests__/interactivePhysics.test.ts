/** @jest-environment node */
import { describe, expect, test } from '@jest/globals';

import { barrierIsActive, shutterPhase, sweepCircleRectangle } from '../interactivePhysics';
import { activateLandingSwitches, BUTTON_RADIUS, createLaunchState, launch, launchVelocity, pocketPosition, pocketVelocity, stepLaunch } from '../simulation';
import type { LaunchBarrier, LaunchPoint, LaunchPocket, LaunchRoom, LaunchState } from '../types';

function course(overrides: Partial<LaunchRoom> = {}): LaunchRoom {
  return { id: 'interactive-physics', name: '', subtitle: '', hint: '', gravity: 0,
    bounds: { width: 1000, height: 1000 }, flightTimeoutTicks: null, startPocketId: 'start',
    pockets: [{ id: 'start', center: { x: 100, y: 900 }, width: 120, kind: 'start' }],
    bumpers: [], hazards: [], barriers: [], switches: [], windZones: [], ...overrides };
}

function flying(room: LaunchRoom, position: LaunchPoint, velocity: LaunchPoint, tick = 0): LaunchState {
  return { ...createLaunchState(room), tick, phase: 'flying', position: { ...position }, previousPosition: { ...position },
    velocity: { ...velocity }, brokenBarrierIds: [], activatedSwitchIds: [] };
}

const rectangle = { x: 100, y: 100, width: 40, height: 30 };
const cloth: LaunchBarrier = { id: 'cloth', kind: 'tearable', x: 200, y: 100, width: 20, height: 200 };

describe('exact swept disc against rectangular fabric', () => {
  test.each([
    [{ x: 50, y: 115 }, { x: 200, y: 115 }, { x: -1, y: 0 }, { x: 90, y: 115 }, 40 / 150],
    [{ x: 200, y: 115 }, { x: 50, y: 115 }, { x: 1, y: 0 }, { x: 150, y: 115 }, 50 / 150],
    [{ x: 120, y: 50 }, { x: 120, y: 200 }, { x: 0, y: -1 }, { x: 120, y: 90 }, 40 / 150],
    [{ x: 120, y: 200 }, { x: 120, y: 50 }, { x: 0, y: 1 }, { x: 120, y: 140 }, 60 / 150],
  ] satisfies [LaunchPoint, LaunchPoint, LaunchPoint, LaunchPoint, number][])('finds the first flat-face contact from %j', (start, end, normal, position, time) => {
    const hit = sweepCircleRectangle(start, end, rectangle, 10)!;
    expect(hit.normal).toEqual(normal);
    expect(hit.position).toEqual(position);
    expect(hit.time).toBeCloseTo(time, 12);
  });

  test('uses the rounded corner arc rather than a square expanded bounding box', () => {
    expect(sweepCircleRectangle({ x: 88, y: 92 }, { x: 92, y: 92 }, rectangle, 10)).toBeUndefined();
    const hit = sweepCircleRectangle({ x: 70, y: 70 }, { x: 100, y: 100 }, rectangle, 10)!;
    expect(hit.time).toBeCloseTo((30 - 10 / Math.sqrt(2)) / 30, 12);
    expect(hit.position.x).toBeCloseTo(100 - 10 / Math.sqrt(2), 12);
    expect(hit.position.y).toBeCloseTo(hit.position.x, 12);
    expect(hit.normal.x).toBeCloseTo(-1 / Math.sqrt(2), 12);
    expect(hit.normal.y).toBeCloseTo(-1 / Math.sqrt(2), 12);
    expect(sweepCircleRectangle({ x: 70, y: 90 }, { x: 130, y: 90 }, rectangle, 10)).toBeUndefined();
  });

  test('resolves initial overlap to the nearest actual face or corner', () => {
    expect(sweepCircleRectangle({ x: 95, y: 115 }, { x: 85, y: 115 }, rectangle, 10))
      .toEqual({ time: 0, normal: { x: -1, y: 0 }, position: { x: 90, y: 115 } });
    expect(sweepCircleRectangle({ x: 120, y: 115 }, { x: 120, y: 115 }, rectangle, 10))
      .toEqual({ time: 0, normal: { x: 0, y: -1 }, position: { x: 120, y: 90 } });
    const corner = sweepCircleRectangle({ x: 95, y: 95 }, { x: 95, y: 95 }, rectangle, 10)!;
    expect(corner.position.x).toBeCloseTo(100 - 10 / Math.sqrt(2), 12);
    expect(corner.position.y).toBeCloseTo(corner.position.x, 12);
    expect(sweepCircleRectangle({ x: 50, y: 50 }, { x: 50, y: 50 }, rectangle, 10)).toBeUndefined();
  });

  test.each(['solid', 'thorns'] as const)('a fast projectile cannot tunnel through a two-unit %s strip', (kind) => {
    const room = course({ barriers: [{ id: 'strip', kind, x: 200, y: 100, width: 2, height: 200 }] });
    const state = flying(room, { x: 100, y: 200 }, { x: 48000, y: 0 });
    const events = stepLaunch(room, state);
    if (kind === 'thorns') {
      expect(events).toEqual([{ type: 'fail', reason: 'hazard', tick: 1 }]);
      expect(state.position.x).toBe(190);
    } else {
      expect(events).toEqual([{ type: 'bounce', id: 'strip', tick: 1 }]);
      expect(state.velocity.x).toBeCloseTo(-26400, 9);
      expect(state.position.x).toBeLessThan(190);
    }
  });

  test('an outward-moving overlap is depenetrated once without reversing its velocity', () => {
    const room = course({ barriers: [{ id: 'solid', kind: 'solid', ...rectangle }] });
    const state = flying(room, { x: 95, y: 115 }, { x: -120, y: 0 });
    expect(stepLaunch(room, state)).toEqual([{ type: 'bounce', tick: 1, id: 'solid' }]);
    expect(state.position.x).toBeLessThan(90);
    expect(state.velocity).toEqual({ x: -120, y: 0 });
    expect(stepLaunch(room, state)).toEqual([]);
  });

  test('a slow vertical fall cannot settle forever on top of a fabric wall', () => {
    const wall: LaunchBarrier = { id: 'horizontal-wall', kind: 'solid', x: 100, y: 300, width: 200, height: 20 };
    const room = course({ gravity: 700, barriers: [wall] });
    const state = flying(room, { x: 200, y: 250 }, { x: 0, y: 80 });
    const events = [];

    for (let tick = 0; tick < 1200 && state.phase === 'flying'; tick += 1) {
      events.push(...stepLaunch(room, state));
    }

    expect(events.some((event) => event.type === 'bounce' && event.id === wall.id)).toBe(true);
    expect(state.phase).not.toBe('flying');
  });

  test.each([
    { side: 'left', wallX: 0, startX: 40, direction: 1 },
    { side: 'right', wallX: 190, startX: 320, direction: -1 },
  ])('a resting bounce escapes inward when a fabric wall meets the $side rail', ({ wallX, startX, direction }) => {
    const wall: LaunchBarrier = { id: 'rail-wall', kind: 'solid', x: wallX, y: 300, width: 170, height: 20 };
    const room = course({ bounds: { width: 360, height: 1000 }, gravity: 700,
      sideWallRestitution: 0.8, barriers: [wall] });
    const state = flying(room, { x: startX, y: 250 }, { x: 0, y: 80 });
    const events = [];
    let farthestInward = direction * state.position.x;

    for (let tick = 0; tick < 480 && state.phase === 'flying'; tick += 1) {
      events.push(...stepLaunch(room, state));
      farthestInward = Math.max(farthestInward, direction * state.position.x);
    }

    expect(events.filter((event) => event.type === 'bounce' && event.id === wall.id).length).toBeLessThanOrEqual(4);
    const innerEdge = direction > 0 ? wall.x + wall.width + BUTTON_RADIUS : -(wall.x - BUTTON_RADIUS);
    expect(farthestInward).toBeGreaterThan(innerEdge);
    expect(state.phase).not.toBe('flying');
  });
});

describe('impact-driven cloth and solid barriers', () => {
  test.each([399.99, 400, 600])('the cloth threshold uses incoming normal speed %s', (speed) => {
    const room = course({ barriers: [cloth] });
    const state = flying(room, { x: 189.5, y: 150 }, { x: speed, y: 120 });
    const events = stepLaunch(room, state);
    expect(state.velocity.y).toBe(120);
    if (speed < 400) {
      expect(events).toEqual([{ type: 'bounce', tick: 1, id: 'cloth' }]);
      expect(state.velocity.x).toBeCloseTo(-speed * 0.55, 10);
      expect(state.brokenBarrierIds).toEqual([]);
    } else {
      expect(events).toEqual([{ type: 'break', tick: 1, id: 'cloth' }]);
      expect(state.velocity.x).toBeCloseTo(speed * 0.75, 10);
      expect(state.brokenBarrierIds).toEqual(['cloth']);
      expect(state.position.x).toBeGreaterThan(190);
    }
  });

  test('high tangential speed cannot substitute for the required 400 normal impact', () => {
    const room = course({ barriers: [cloth] });
    const state = flying(room, { x: 189.5, y: 150 }, { x: 399, y: 900 });
    expect(stepLaunch(room, state)).toEqual([{ type: 'bounce', tick: 1, id: 'cloth' }]);
    expect(state.velocity.y).toBe(900);
    expect(state.brokenBarrierIds).toEqual([]);
  });

  test.each(['tearable', 'solid'] as const)('a %s corner preserves tangent while changing only the normal component', (kind) => {
    const room = course({ barriers: [{ ...cloth, kind }] });
    const normal = { x: -1 / Math.sqrt(2), y: -1 / Math.sqrt(2) };
    const tangent = { x: -normal.y, y: normal.x };
    const state = flying(room, { x: cloth.x + normal.x * BUTTON_RADIUS, y: cloth.y + normal.y * BUTTON_RADIUS },
      { x: -500 * normal.x + 150 * tangent.x, y: -500 * normal.y + 150 * tangent.y });
    const events = stepLaunch(room, state);
    expect(events).toEqual([{ type: kind === 'tearable' ? 'break' : 'bounce', tick: 1, id: 'cloth' }]);
    expect(state.velocity.x * normal.x + state.velocity.y * normal.y).toBeCloseTo(kind === 'tearable' ? -375 : 275, 8);
    expect(state.velocity.x * tangent.x + state.velocity.y * tangent.y).toBeCloseTo(150, 8);
  });

  test('a tear persists for later crossings and never awards a duplicate break', () => {
    const room = course({ barriers: [cloth] });
    const state = flying(room, { x: 189.5, y: 150 }, { x: 400, y: 0 });
    stepLaunch(room, state);
    const broken = state.brokenBarrierIds;
    state.position = { x: 170, y: 150 };
    state.velocity = { x: 600, y: 0 };
    for (let tick = 0; tick < 14; tick += 1) expect(stepLaunch(room, state)).toEqual([]);
    expect(state.position.x).toBeCloseTo(240, 10);
    expect(state.velocity.x).toBe(600);
    expect(state.brokenBarrierIds).toBe(broken);
    expect(barrierIsActive(cloth, room, state, state.tick)).toBe(false);
  });
});

describe('switch contact ordering and shutters', () => {
  test.each([{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }])('a switch triggers from direction %j without altering flight', (direction) => {
    const sensor = { id: 'switch', center: { x: 300, y: 300 }, radius: 8, doorIds: ['door'] };
    const room = course({ gravity: 700, switches: [sensor], barriers: [{ id: 'door', kind: 'door', x: 800, y: 100, width: 20, height: 100 }] });
    const position = { x: 300 - direction.x * 34, y: 300 - direction.y * 34 };
    const velocity = { x: direction.x * 8160, y: direction.y * 8160 };
    const state = flying(room, position, velocity);
    const baseline = flying(room, position, velocity);
    expect(stepLaunch(room, state)).toEqual([{ type: 'switch', tick: 1, id: 'switch' }]);
    stepLaunch({ ...room, switches: [] }, baseline);
    expect(state.position).toEqual(baseline.position);
    expect(state.velocity).toEqual(baseline.velocity);
    expect(state.activatedSwitchIds).toEqual(['switch']);
    state.position = position;
    state.velocity = velocity;
    expect(stepLaunch(room, state)).toEqual([]);
  });

  test.each([1, -1])('an earlier switch opens its linked door before a later collision in the same tick (%s)', (direction) => {
    const door: LaunchBarrier = { id: 'door', kind: 'door', x: 200, y: 150, width: 12, height: 100 };
    const other: LaunchBarrier = { id: 'other', kind: 'door', x: 700, y: 150, width: 12, height: 100 };
    const room = course({ barriers: [door, other], switches: [{ id: 'switch', center: { x: direction > 0 ? 160 : 240, y: 200 }, radius: 8, doorIds: ['door'] }] });
    const startX = direction > 0 ? 120 : 280;
    const state = flying(room, { x: startX, y: 200 }, { x: direction * 14400, y: 0 });
    expect(stepLaunch(room, state)).toEqual([{ type: 'switch', tick: 1, id: 'switch' }]);
    expect(state.position.x).toBe(startX + direction * 120);
    expect(barrierIsActive(door, room, state, 1)).toBe(false);
    expect(barrierIsActive(other, room, state, 1)).toBe(true);
  });

  test('an unrelated door remains solid later in the same switched flight', () => {
    const room = course({ barriers: [
      { id: 'linked', kind: 'door', x: 200, y: 150, width: 12, height: 100 },
      { id: 'unrelated', kind: 'door', x: 300, y: 150, width: 12, height: 100 },
    ], switches: [{ id: 'switch', center: { x: 160, y: 200 }, radius: 8, doorIds: ['linked'] }] });
    const state = flying(room, { x: 120, y: 200 }, { x: 33600, y: 0 });
    expect(stepLaunch(room, state)).toEqual([{ type: 'switch', tick: 1, id: 'switch' }, { type: 'bounce', tick: 1, id: 'unrelated' }]);
    expect(state.position.x).toBeLessThan(290);
  });

  test('a barrier encountered before its switch cannot be opened through the wall', () => {
    const room = course({ barriers: [{ id: 'door', kind: 'door', x: 200, y: 150, width: 12, height: 100 }],
      switches: [{ id: 'switch', center: { x: 250, y: 200 }, radius: 8, doorIds: ['door'] }] });
    const state = flying(room, { x: 150, y: 200 }, { x: 18000, y: 0 });
    expect(stepLaunch(room, state)).toEqual([{ type: 'bounce', tick: 1, id: 'door' }]);
    expect(state.activatedSwitchIds).toEqual([]);
  });

  test('landing-linked switches activate once without requiring the button to overlap their visual center', () => {
    const room = course({ barriers: [{ id: 'door', kind: 'door', x: 800, y: 400, width: 20, height: 100 }],
      switches: [{ id: 'land-switch', center: { x: 800, y: 200 }, radius: 8, doorIds: ['door'], pocketId: 'start' }] });
    const state = createLaunchState(room);
    state.tick = 40;
    expect(activateLandingSwitches(room, state, 'start')).toEqual([{ type: 'switch', tick: 40, id: 'land-switch' }]);
    expect(activateLandingSwitches(room, state, 'start')).toEqual([]);
    expect(state.activatedSwitchIds).toEqual(['land-switch']);
  });

  test.each([['a-pocket', 'z-switch'], ['z-pocket', 'a-switch']])('a simultaneous physical switch and wide-pocket catch is independent of IDs (%s, %s)', (pocketId, switchId) => {
    const base = course();
    const room = { ...base, pockets: [...base.pockets, { id: pocketId, center: { x: 500, y: 300 }, width: 120, kind: 'checkpoint' as const }],
      barriers: [{ id: 'door', kind: 'door' as const, x: 800, y: 400, width: 20, height: 100 }],
      switches: [{ id: switchId, center: { x: 550, y: 318 }, radius: 8, doorIds: ['door'] }] };
    const state = flying(room, { x: 550, y: 298 }, { x: 0, y: 480 });
    const events = stepLaunch(room, state);
    expect(events).toContainEqual({ type: 'switch', tick: 1, id: switchId });
    expect(events).toContainEqual({ type: 'catch', tick: 1, id: pocketId });
    expect(state.activatedSwitchIds).toEqual([switchId]);
  });

  test('a lethal contact still wins over a simultaneous switch', () => {
    const room = course({ barriers: [{ id: 'thorns', kind: 'thorns', x: 200, y: 150, width: 20, height: 100 }],
      switches: [{ id: 'switch', center: { x: 208, y: 200 }, radius: 8, doorIds: [] }] });
    const state = flying(room, { x: 180, y: 200 }, { x: 2400, y: 0 });
    expect(stepLaunch(room, state)).toEqual([{ type: 'fail', reason: 'hazard', tick: 1 }]);
    expect(state.activatedSwitchIds).toEqual([]);
  });

  test.each([0, 90])('shutters switch from open to warning to closed on their precise phase boundaries (offset %s)', (phaseTicks) => {
    const shutter: LaunchBarrier = { id: 'shutter', kind: 'shutter', x: 200, y: 150, width: 20, height: 100, phaseTicks };
    for (const [phase, expected] of [[0, 'open'], [239, 'open'], [240, 'warning'], [329, 'warning'], [330, 'closed'], [479, 'closed'], [480, 'open']] as const) {
      const tick = phase - phaseTicks;
      expect(shutterPhase(shutter, tick)).toBe(expected);
      const room = course({ barriers: [shutter] });
      const state = flying(room, { x: 210, y: 200 }, { x: 0, y: 0 }, tick - 1);
      const events = stepLaunch(room, state);
      expect(events).toEqual(expected === 'closed' ? [{ type: 'fail', reason: 'hazard', tick }] : []);
      expect(barrierIsActive(shutter, room, state, tick)).toBe(expected === 'closed');
    }
  });
});

describe('orbit momentum and relative catches', () => {
  const hoop: LaunchPocket = { id: 'hoop', center: { x: 500, y: 500 }, width: 104, kind: 'checkpoint',
    orbit: { radius: 48, periodTicks: 720, phaseTicks: 0 } };

  test.each([1, -1] as const)('analytic hoop velocity follows its full orbit in direction %s', (direction) => {
    const pocket = { ...hoop, orbit: { ...hoop.orbit!, direction, phaseTicks: 137 } };
    for (const tick of [0, 180, 360, 540, 720]) {
      const position = pocketPosition(pocket, tick);
      const velocity = pocketVelocity(pocket, tick);
      expect(Math.hypot(position.x - 500, position.y - 500)).toBeCloseTo(48, 10);
      expect(Math.hypot(velocity.x, velocity.y)).toBeCloseTo(48 * Math.PI * 2 / 6, 10);
      expect((position.x - 500) * velocity.x + (position.y - 500) * velocity.y).toBeCloseTo(0, 9);
      const before = pocketPosition(pocket, tick - 0.001), after = pocketPosition(pocket, tick + 0.001);
      expect(velocity.x).toBeCloseTo((after.x - before.x) / (0.002 / 120), 6);
      expect(velocity.y).toBeCloseTo((after.y - before.y) / (0.002 / 120), 6);
    }
  });

  test('launch adds orbital tangent momentum and caps only orbital releases at 850', () => {
    const pocket = { ...hoop, orbit: { radius: 72, periodTicks: 240, phaseTicks: 0 } };
    const room = course({ pockets: [pocket], startPocketId: pocket.id });
    const state = createLaunchState(room);
    const pull = { x: 0, y: -100 };
    expect(launch(room, state, { tick: 0, pocketId: pocket.id, pull })).toBe(true);
    expect(state.position).toEqual({ x: 572, y: 400 });
    expect(state.velocity.x).toBeCloseTo(0, 12);
    expect(state.velocity.y).toBe(850);
    const ordinary = { ...hoop, orbit: undefined, motion: { amplitude: 50, periodTicks: 480, phaseTicks: 0 } };
    expect(pocketVelocity(ordinary, 0)).toEqual({ x: 0, y: 0 });
    expect(launchVelocity(ordinary, 0, { x: -20, y: 70 })).toEqual({ x: 150, y: -525 });
  });

  test.each([0, 180, 360, 540])('catches a relative downward crossing and keeps orbiting after landing at phase %s', (tick) => {
    const room = course();
    const withHoop = { ...room, pockets: [...room.pockets, hoop] };
    const from = pocketPosition(hoop, tick), to = pocketPosition(hoop, tick + 1);
    const state = flying(withHoop, { x: from.x, y: from.y - 0.05 },
      { x: (to.x - from.x) * 120, y: (to.y - from.y + 0.1) * 120 }, tick);
    if (tick === 360) expect(state.velocity.y).toBeLessThan(0);
    expect(stepLaunch(withHoop, state)).toEqual([{ type: 'catch', tick: tick + 1, id: 'hoop' }]);
    expect(state.position).toEqual(to);
    for (let frame = 0; frame < 120; frame += 1) expect(stepLaunch(withHoop, state)).toEqual([]);
    expect(state.position).toEqual(pocketPosition(hoop, tick + 121));
    expect(state.position).not.toEqual(to);
    expect(state.phase).toBe('held');
  });

  test.each([0, 180, 360, 540])('rejects relative upward crossings and catches beyond the mouth at phase %s', (tick) => {
    const base = course();
    const room = { ...base, pockets: [...base.pockets, hoop] };
    const from = pocketPosition(hoop, tick), to = pocketPosition(hoop, tick + 1);
    const rising = flying(room, { x: from.x, y: from.y + 0.05 },
      { x: (to.x - from.x) * 120, y: (to.y - from.y - 0.1) * 120 }, tick);
    expect(stepLaunch(room, rising)).toEqual([]);
    expect(rising.phase).toBe('flying');
    const outside = flying(room, { x: from.x + hoop.width / 2, y: from.y - 0.05 },
      { x: (to.x - from.x) * 120, y: (to.y - from.y + 0.1) * 120 }, tick);
    expect(stepLaunch(room, outside)).toEqual([]);
    expect(outside.phase).toBe('flying');
  });
});
