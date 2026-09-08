/** @jest-environment node */
import { describe, expect, test } from '@jest/globals';

import { createWorldEndlessRun, createEndlessRun, nextEndlessTargets, stepEndless, type EndlessRun } from '../endless';
import { pocketPosition } from '../simulation';
import { cloneEndlessRun, deserializeEndlessRun, serializeEndlessRun } from '../snapshots';

function catchNext(run: EndlessRun): void {
  const targets = nextEndlessTargets(run);
  const pocket = run.room.pockets.find((candidate) => targets.includes(candidate.id)
    && candidate.route !== 'reward') ?? run.room.pockets.find((candidate) => targets.includes(candidate.id))!;
  const position = pocketPosition(pocket, run.state.tick + 1);
  Object.assign(run.state, { phase: 'flying', position: { x: position.x, y: position.y - 2 },
    velocity: { x: 0, y: 480 }, sourcePocketImmune: false });
  expect(stepEndless(run)).toContainEqual({ type: 'catch', id: pocket.id, tick: run.state.tick });
}

function until(run: EndlessRun, predicate: (run: EndlessRun) => boolean): EndlessRun {
  for (let index = 0; index < 160 && !predicate(run); index += 1) catchNext(run);
  expect(predicate(run)).toBe(true);
  return run;
}

/** External JSON corruption intentionally bypasses the TypeScript contract. */
function corrupt(run: EndlessRun, mutate: (payload: any) => void): string {
  const payload: unknown = JSON.parse(serializeEndlessRun(run));
  mutate(payload);
  return JSON.stringify(payload);
}

describe('version-three world journal validation', () => {
  test('round-trips all milestones, introduction counters, mixed sections and pruned geometry', () => {
    for (const seed of [0, 7]) {
      const run = createWorldEndlessRun(seed);
      for (let catches = 0; catches <= 140; catches += 1) {
        expect(JSON.parse(serializeEndlessRun(run)).version).toBe(3);
        expect(deserializeEndlessRun(serializeEndlessRun(run))).toEqual(run);
        if (catches < 140) catchNext(run);
      }
      expect(run.sectionProgress!.introductions).toEqual([3, 3, 3, 3]);
      expect(run.sectionProgress!.sections.length).toBeLessThanOrEqual(8);
    }
  });

  test('clones wind, stage records and introduction progress without aliasing saved catches', () => {
    const run = until(createWorldEndlessRun(0), (candidate) => !!candidate.room.windZones?.length);
    const before = serializeEndlessRun(run);
    const clone = cloneEndlessRun(run);
    clone.sectionProgress!.introductions![0] = 0;
    const wind = clone.room.windZones![0];
    clone.room = { ...clone.room, windZones: [{ ...wind, x: wind.x + 1 }] };
    clone.sectionProgress!.sections = clone.sectionProgress!.sections.slice(1);
    clone.lastCatchSnapshot!.sectionProgress!.introductions![1] = 0;
    expect(serializeEndlessRun(run)).toBe(before);
  });

  test('rejects missing and inconsistent progression metadata in either world', () => {
    const run = createWorldEndlessRun(0);
    const mutations: ((world: any) => void)[] = [
      (world) => { delete world.sectionProgress.introductions; },
      (world) => { world.sectionProgress.introductions = [0, 0, 0]; },
      (world) => { world.sectionProgress.introductions = [1, 0, 0, 0]; },
      (world) => { world.sectionProgress.introductions = [-1, 0, 0, 0]; },
      (world) => { world.sectionProgress.introductions = [4, 0, 0, 0]; },
      (world) => { delete world.sectionProgress.sections[0].worldStage; },
      (world) => { world.sectionProgress.sections[0].worldStage = 1; },
      (world) => { world.sectionProgress.sections[0].worldStage = -1; },
      (world) => { delete world.sectionProgress.sections[0].mechanics; },
      (world) => { world.sectionProgress.sections[0].mechanics = ['wind']; },
      (world) => { world.sectionProgress.sections[0].mechanics = ['gate', 'gate']; },
      (world) => { world.sectionProgress.sections[0].mechanics = ['gate', 'fray', 'sway']; },
      (world) => { world.sectionProgress.sections[0].introduction = 'unknown'; },
      (world) => { delete world.sectionProgress.sections[0].windZoneIds; },
      (world) => { delete world.room.windZones; },
    ];
    for (const mutate of mutations) {
      for (const checkpoint of [false, true]) {
        expect(deserializeEndlessRun(corrupt(run, (payload) => mutate(checkpoint ? payload.run.lastCatchSnapshot : payload.run)))).toBeNull();
      }
    }
  });

  test('rejects invalid wind physics, overlapping regions and unowned or multiply owned IDs', () => {
    const run = until(createWorldEndlessRun(0), (candidate) => !!candidate.room.windZones?.length);
    const mutations: ((world: any) => void)[] = [
      (world) => { world.room.windZones[0].x = null; },
      (world) => { world.room.windZones[0].y = '0'; },
      (world) => { world.room.windZones[0].width = 0; },
      (world) => { world.room.windZones[0].height = -150; },
      (world) => { world.room.windZones[0].accelerationX = 121; },
      (world) => { world.room.windZones[0].accelerationX = -121; },
      (world) => { world.room.windZones[0].accelerationX = null; },
      (world) => { world.room.windZones.push({ ...world.room.windZones[0] }); },
      (world) => {
        const zone = world.room.windZones[0];
        const section = world.sectionProgress.sections.find((item: any) => item.windZoneIds.includes(zone.id));
        section.windZoneIds.push(`${section.id}-overlap`);
        world.room.windZones.push({ ...zone, id: `${section.id}-overlap`, x: zone.x + 1 });
      },
      (world) => { world.room.windZones[0].id = 'orphan-wind'; },
      (world) => { world.sectionProgress.sections.forEach((section: any) => { section.windZoneIds = []; }); },
      (world) => {
        const section = world.sectionProgress.sections.find((item: any) => item.windZoneIds.length);
        section.windZoneIds.push(section.windZoneIds[0]);
      },
      (world) => {
        const section = world.sectionProgress.sections.find((item: any) => item.windZoneIds.length);
        section.mechanics = [];
        delete section.introduction;
      },
    ];
    for (const mutate of mutations) {
      for (const checkpoint of [false, true]) {
        expect(deserializeEndlessRun(corrupt(run, (payload) => mutate(checkpoint ? payload.run.lastCatchSnapshot : payload.run)))).toBeNull();
      }
    }
  });

  test('rejects invalid spring strengths, scissors variants and contradictory introduction counters', () => {
    const spring = until(createWorldEndlessRun(0), (run) => run.room.bumpers.some((bumper) => bumper.springSpeed !== undefined));
    for (const speed of [-1, 0, 851, null, '650']) {
      expect(deserializeEndlessRun(corrupt(spring, (payload) => {
        payload.run.room.bumpers.find((bumper: any) => bumper.springSpeed !== undefined).springSpeed = speed;
      }))).toBeNull();
    }
    const scissors = until(createWorldEndlessRun(0), (run) => run.room.hazards.some((hazard) => hazard.visual === 'scissors'));
    expect(deserializeEndlessRun(corrupt(scissors, (payload) => {
      payload.run.room.hazards.find((hazard: any) => hazard.visual === 'scissors').visual = 'invisible';
    }))).toBeNull();
    expect(deserializeEndlessRun(corrupt(scissors, (payload) => {
      payload.run.sectionProgress.introductions[3] = 0;
    }))).toBeNull();
  });

  test.each([1, 2] as const)('historical v%i worlds retain their version and reject new world physics', (version) => {
    const run = createEndlessRun(0, version);
    expect(deserializeEndlessRun(serializeEndlessRun(run))).toEqual(run);
    const mutations: ((world: any) => void)[] = [
      (world) => { world.room.windZones = []; },
      (world) => { world.room.bumpers.push({ id: 'new-spring', center: { x: 320, y: 10 }, radius: 26, restitution: 1, springSpeed: 650 }); },
      (world) => { world.room.hazards.push({ id: 'new-scissors', center: { x: 250, y: 10 }, radius: 18, visual: 'scissors' }); },
      (world) => { world.sectionProgress ??= {}; world.sectionProgress.introductions = [0, 0, 0, 0]; },
    ];
    for (const mutate of mutations) {
      for (const checkpoint of [false, true]) {
        expect(deserializeEndlessRun(corrupt(run, (payload) => mutate(checkpoint ? payload.run.lastCatchSnapshot : payload.run)))).toBeNull();
      }
    }
    if (version === 1) {
      const historical = corrupt(run, (payload) => {
        delete payload.run.generationVersion;
        delete payload.run.lastCatchSnapshot.generationVersion;
      });
      expect(deserializeEndlessRun(historical)?.generationVersion).toBeUndefined();
    }
  });
});
