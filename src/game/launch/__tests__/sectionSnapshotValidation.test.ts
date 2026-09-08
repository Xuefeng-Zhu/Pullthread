/** @jest-environment node */
import { describe, expect, test } from '@jest/globals';

import { createSectionEndlessRun as createEndlessRun, createLegacyEndlessRun, nextEndlessTargets, stepEndless, teleportEndless, type EndlessRun } from '../endless';
import { deserializeEndlessRun, serializeEndlessRun } from '../snapshots';

function catchNext(run: EndlessRun): void {
  const id = nextEndlessTargets(run)[0];
  const pocket = run.room.pockets.find((candidate) => candidate.id === id)!;
  Object.assign(run.state, { phase: 'flying', position: { x: pocket.center.x, y: pocket.center.y - 2 },
    velocity: { x: 0, y: 480 }, sourcePocketImmune: false });
  expect(stepEndless(run)).toContainEqual({ type: 'catch', id, tick: run.state.tick });
}

function atTemporary(): EndlessRun {
  const run = createEndlessRun(0);
  for (let count = 0; count < 80; count += 1) {
    const temporary = run.room.pockets.find((pocket) => pocket.frayTicks);
    if (temporary) {
      run.cameraY = temporary.center.y - 250;
      run.room = { ...run.room, bounds: { ...run.room.bounds, bottom: run.cameraY + 600 } };
      expect(teleportEndless(run, temporary.id, true)).toBe(true);
      return run;
    }
    catchNext(run);
  }
  throw new Error('No temporary pocket generated.');
}

/** Corrupt external JSON deliberately bypasses static types. */
function corrupt(run: EndlessRun, mutate: (payload: any) => void): string {
  const payload: unknown = JSON.parse(serializeEndlessRun(run));
  mutate(payload);
  return JSON.stringify(payload);
}

describe('version-two snapshot ownership and lifetime validation', () => {
  test('keeps saved wall rules and rejects invalid restitution in either world', () => {
    const run = createEndlessRun(0);
    expect(deserializeEndlessRun(serializeEndlessRun(run))?.room.sideWallRestitution).toBe(0.8);
    const earlier = deserializeEndlessRun(corrupt(run, (payload) => {
      delete payload.run.room.sideWallRestitution;
      delete payload.run.lastCatchSnapshot.room.sideWallRestitution;
    }))!;
    expect(earlier).not.toBeNull();
    expect(earlier.room.sideWallRestitution).toBeUndefined();
    catchNext(earlier);
    expect(earlier.room.sideWallRestitution).toBeUndefined();
    expect(earlier.room.bounds.bottom).toBe(earlier.cameraY + 600);
    for (const restitution of [-0.1, 1.1, null, '0.8', 0.6]) {
      for (const checkpoint of [false, true]) {
        expect(deserializeEndlessRun(corrupt(run, (payload) => {
          const world = checkpoint ? payload.run.lastCatchSnapshot : payload.run;
          world.room.sideWallRestitution = restitution;
        }))).toBeNull();
      }
    }
  });

  test('rejects orphan pocket ownership before a resumed catch can prune its own source', () => {
    const run = createEndlessRun(0);
    const id = run.sectionProgress!.sections[0].pocketIds[0];
    expect(deserializeEndlessRun(corrupt(run, (payload) => {
      payload.run.room.pockets.find((pocket: { id: string }) => pocket.id === id).sectionId = 'missing';
    }))).toBeNull();
    expect(deserializeEndlessRun(corrupt(run, (payload) => {
      payload.run.sectionProgress.sections[0].pocketIds.shift();
    }))).toBeNull();
  });

  test('rejects unowned, missing, and multiply claimed obstacle and reward IDs', () => {
    const run = createEndlessRun(0);
    catchNext(run);
    catchNext(run);
    const mutations: ((payload: any) => void)[] = [
      (payload) => { payload.run.room.hazards.push({ id: 'orphan-thorn', center: { x: 10, y: 10 }, radius: 10 }); },
      (payload) => { payload.run.room.bumpers.push({ id: 'orphan-cushion', center: { x: 10, y: 10 }, radius: 10, restitution: 1 }); },
      (payload) => { payload.run.sectionProgress.sections[0].hazardIds.push('section-0-missing'); },
      (payload) => { payload.run.sectionProgress.sections[0].bumperIds.push('section-0-missing'); },
      (payload) => { payload.run.sectionProgress.sections[0].pickupIds.push('section-0-missing'); },
      (payload) => { payload.run.sectionProgress.sections[0].pickupIds.push(payload.run.sectionProgress.sections[0].pickupIds[0]); },
      (payload) => { payload.run.room.pickups.push({ ...payload.run.room.pickups[0] }); },
      (payload) => { payload.run.room.pickups = payload.run.room.pickups.filter((pickup: { id: string }) => pickup.id !== 'opening-preview'); },
      (payload) => { payload.run.room.pickups = payload.run.room.pickups.filter((pickup: { id: string }) => pickup.id !== payload.run.sectionProgress.sections[0].pickupIds[0]); },
      (payload) => { payload.run.room.pickups.push({ id: 'section-999-future', kind: 'preview', center: { x: 10, y: 10 }, radius: 10 }); },
    ];
    for (const mutate of mutations) expect(deserializeEndlessRun(corrupt(run, mutate))).toBeNull();
  });

  test('rejects cursor or graph corruption that could regenerate IDs or disconnect future routes', () => {
    const run = createEndlessRun(0);
    const mutations: ((payload: any) => void)[] = [
      (payload) => { payload.run.sectionProgress.nextIndex += 1; },
      (payload) => { payload.run.sectionProgress.sections.push({ ...payload.run.sectionProgress.sections[0] }); },
      (payload) => { payload.run.sectionProgress.sections[0].index += 1; payload.run.sectionProgress.nextIndex += 1; },
      (payload) => { payload.run.nextPocketIndex += 1; },
      (payload) => { payload.run.lastGeneratedY += 1; },
      (payload) => { payload.run.sectionProgress.lastFamily = 'gate'; },
      (payload) => { payload.run.sectionProgress.sections[0].connections = []; },
      (payload) => { payload.run.sectionProgress.sections[0].connections[0].to = 'endless-0'; },
      (payload) => { payload.run.sectionProgress.sections[0].exitPocketId = 'endless-2'; },
      (payload) => { payload.run.sectionProgress.sections[0].connections.push(payload.run.sectionProgress.sections[0].connections[0]); },
    ];
    for (const mutate of mutations) expect(deserializeEndlessRun(corrupt(run, mutate))).toBeNull();
  });

  test('current temporary pockets require their deadline in both run and saved catch state', () => {
    const run = atTemporary();
    expect(deserializeEndlessRun(serializeEndlessRun(run))).toEqual(run);
    for (const field of ['state', 'lastCatchSnapshot'] as const) {
      expect(deserializeEndlessRun(corrupt(run, (payload) => {
        const state = field === 'state' ? payload.run.state : payload.run.lastCatchSnapshot.state;
        delete state.pocketExpiryTicks;
      }))).toBeNull();
      expect(deserializeEndlessRun(corrupt(run, (payload) => {
        const state = field === 'state' ? payload.run.state : payload.run.lastCatchSnapshot.state;
        delete state.pocketExpiryTicks[state.pocketId];
      }))).toBeNull();
    }
    expect(deserializeEndlessRun(corrupt(run, (payload) => {
      payload.run.state.pocketExpiryTicks[payload.run.state.pocketId] = payload.run.state.tick;
    }))).toBeNull();
    expect(deserializeEndlessRun(corrupt(run, (payload) => {
      payload.run.state.pocketExpiryTicks[payload.run.state.pocketId] = payload.run.state.tick + 481;
    }))).toBeNull();
    expect(deserializeEndlessRun(corrupt(run, (payload) => {
      payload.run.state.phase = 'flying';
      delete payload.run.state.pocketExpiryTicks;
    }))).toBeNull();
  });

  test('consumed owned rewards remain valid, but divergent ledgers cannot restore duplicate rewards', () => {
    const run = createEndlessRun(0);
    const pickup = run.room.pickups![0];
    run.room = { ...run.room, pickups: run.room.pickups!.filter((candidate) => candidate.id !== pickup.id) };
    run.state.pickupIds.push(pickup.id);
    run.collectedPickupIds.push(pickup.id);
    expect(deserializeEndlessRun(serializeEndlessRun(run))).toEqual(run);
    expect(deserializeEndlessRun(corrupt(run, (payload) => { payload.run.collectedPickupIds = []; }))).toBeNull();
    expect(deserializeEndlessRun(corrupt(run, (payload) => { payload.run.state.pickupIds = []; }))).toBeNull();
    expect(deserializeEndlessRun(corrupt(run, (payload) => { payload.run.room.pickups.push(pickup); }))).toBeNull();
  });

  test('valid windows survive pruning, consumed rewards, and section changes without upgrading legacy runs', () => {
    for (const seed of [0, 7, 31]) {
      const run = createEndlessRun(seed);
      for (let catches = 0; catches < 48; catches += 1) {
        expect(deserializeEndlessRun(serializeEndlessRun(run))).toEqual(run);
        catchNext(run);
      }
    }
    const legacy = createLegacyEndlessRun(0);
    const historical = corrupt(legacy, (payload) => {
      delete payload.run.generationVersion;
      delete payload.run.lastCatchSnapshot.generationVersion;
    });
    expect(deserializeEndlessRun(historical)?.generationVersion).toBeUndefined();
    expect(deserializeEndlessRun(serializeEndlessRun(legacy))).toEqual(legacy);
  });
});
