/** @jest-environment node */
import { describe, expect, test } from '@jest/globals';

import {
  createEndlessRun, launchEndless, nextEndlessTargets, reviveEndless, stepEndless, type EndlessRun,
} from '../endless';
import { cloneEndlessRun, deserializeEndlessRun, serializeEndlessRun } from '../snapshots';
import { findTargetInput, replayNext } from '../testing/routeSolver';

function take(run: EndlessRun, id: string): void {
  replayNext(run, findTargetInput(run, id));
  expect(run.state.phase).toBe('held');
  expect(run.state.pocketId).toBe(id);
}

function settle(run: EndlessRun): void {
  for (let tick = 0; tick < 180; tick += 1) stepEndless(run);
}

function secondOpening(version: 3 | 4 = 4): EndlessRun {
  const run = createEndlessRun(0, version);
  take(run, 'endless-1');
  take(run, 'endless-2');
  settle(run);
  return run;
}

function resolveFlight(run: EndlessRun): string[] {
  const events: string[] = [];
  for (let tick = 0; tick < 960 && run.state.phase === 'flying'; tick += 1) {
    events.push(...stepEndless(run).map((event) => event.type));
  }
  return events;
}

describe('forgiving downward recovery', () => {
  test('a full vertical launch can return to its source after the camera followed the high arc', () => {
    const run = createEndlessRun(0);
    expect(launchEndless(run, { x: 0, y: 98 })).toBe(true);
    let highestCamera = run.cameraY;
    while (run.state.phase === 'flying') {
      stepEndless(run);
      highestCamera = Math.min(highestCamera, run.cameraY);
    }
    expect(highestCamera).toBeLessThan(-70);
    expect(run.state.phase).toBe('held');
    expect(run.state.pocketId).toBe('endless-0');
    expect(run.cameraY).toBeGreaterThan(highestCamera);
    expect(run.pocketsCaught).toBe(0);
    expect(run.highestPocket).toBe(0);
    expect(run.state.sourcePocketImmune).toBe(true);
  });

  test('an actual short sideways release falls into a pocket below the old camera floor', () => {
    const run = secondOpening();
    const lower = run.room.pockets.find((pocket) => pocket.id === 'endless-1')!;
    const cameraBefore = run.cameraY;
    const inventoryBefore = { ...run.inventory };
    const ledgerBefore = [...run.collectedPickupIds];
    const cursor = { index: run.nextPocketIndex, generatedY: run.lastGeneratedY, section: run.sectionProgress!.nextIndex };
    expect(lower.center.y).toBeGreaterThan(cameraBefore + 600);
    expect(launchEndless(run, { x: 22, y: 0 })).toBe(true);
    expect(resolveFlight(run)).toContain('catch');
    expect(run.state.phase).toBe('held');
    expect(run.state.pocketId).toBe(lower.id);
    expect(run.cameraY).toBeGreaterThan(cameraBefore);
    expect(run.room.bounds.bottom).toBeGreaterThan(lower.center.y + 100);
    expect(run.pocketsCaught).toBe(2);
    expect(run.highestPocket).toBe(2);
    expect(run.inventory).toEqual(inventoryBefore);
    expect(run.collectedPickupIds).toEqual(ledgerBefore);
    expect({ index: run.nextPocketIndex, generatedY: run.lastGeneratedY, section: run.sectionProgress!.nextIndex }).toEqual(cursor);
    expect(nextEndlessTargets(run)).toEqual(['endless-2']);
    expect(deserializeEndlessRun(serializeEndlessRun(run))).toEqual(run);
  });

  test('the historical v3 high-shot rescue keeps its original lower landing after the camera follows the apex', () => {
    const run = secondOpening(3);
    const lower = run.room.pockets.find((pocket) => pocket.id === 'endless-1')!;
    expect(launchEndless(run, { x: 6, y: 95 })).toBe(true);
    let highestCamera = run.cameraY;
    for (let tick = 0; tick < 960 && run.state.phase === 'flying'; tick += 1) {
      stepEndless(run);
      highestCamera = Math.min(highestCamera, run.cameraY);
    }
    expect(lower.center.y).toBeGreaterThan(highestCamera + 600);
    expect(run.state.phase).toBe('held');
    expect(run.state.pocketId).toBe(lower.id);
    expect(run.cameraY).toBeGreaterThan(highestCamera);
    expect(run.highestPocket).toBe(2);
    expect(run.pocketsCaught).toBe(2);
  });

  test('repeated rescue and reclimbing cannot farm score, rewards, or generator output', () => {
    const run = secondOpening();
    const original = cloneEndlessRun(run);
    for (let repeat = 0; repeat < 16; repeat += 1) {
      expect(launchEndless(run, { x: 22, y: 0 })).toBe(true);
      resolveFlight(run);
      expect(run.state.pocketId).toBe('endless-1');
      take(run, 'endless-2');
      settle(run);
      expect(run.pocketsCaught).toBe(original.pocketsCaught);
      expect(run.highestPocket).toBe(original.highestPocket);
      expect(run.inventory).toEqual(original.inventory);
      expect(run.collectedPickupIds).toEqual(original.collectedPickupIds);
      expect(run.sectionProgress).toEqual(original.sectionProgress);
      expect(run.nextPocketIndex).toBe(original.nextPocketIndex);
    }
  });

  test('revive restores the lower rescue checkpoint and its clock without undoing earned progress', () => {
    const run = secondOpening();
    launchEndless(run, { x: 22, y: 0 });
    resolveFlight(run);
    const rescue = cloneEndlessRun(run);
    run.inventory.revive = 1;
    Object.assign(run.state, {
      phase: 'flying', position: { x: 180, y: run.room.bounds.bottom! - 1 },
      velocity: { x: 0, y: 600 }, sourcePocketImmune: false,
    });
    expect(stepEndless(run).some((event) => event.type === 'fail')).toBe(true);
    expect(reviveEndless(run)).toBe(true);
    expect(run.state.pocketId).toBe('endless-1');
    expect(run.state.tick).toBe(rescue.lastCatchSnapshot!.state.tick);
    expect(run.cameraY).toBe(rescue.lastCatchSnapshot!.cameraY);
    expect(run.pocketsCaught).toBe(rescue.pocketsCaught);
    expect(run.highestPocket).toBe(rescue.highestPocket);
    expect(run.sectionProgress).toEqual(rescue.sectionProgress);
    expect(run.collectedPickupIds).toEqual(rescue.collectedPickupIds);
    expect(run.inventory.revive).toBe(0);
    expect(deserializeEndlessRun(serializeEndlessRun(run))).toEqual(run);
  });

  test('retained lower sections remain catchable while recovery memory and journals stay bounded', () => {
    const run = createEndlessRun(42);
    for (let round = 0; round < 5; round += 1) {
      for (let ascent = 0; ascent < 20; ascent += 1) {
        const targets = nextEndlessTargets(run);
        const safe = targets.find((id) => run.room.pockets.find((pocket) => pocket.id === id)?.route !== 'reward') ?? targets[0];
        take(run, safe);
      }
      const lowest = [...run.room.pockets].sort((a, b) => b.center.y - a.center.y)[0];
      const progress = { score: run.pocketsCaught, rank: run.highestPocket, next: run.nextPocketIndex };
      Object.assign(run.state, { phase: 'flying', position: { x: lowest.center.x, y: lowest.center.y - 2 },
        velocity: { x: 0, y: 480 }, sourcePocketImmune: false });
      expect(stepEndless(run)).toContainEqual({ type: 'catch', tick: run.state.tick, id: lowest.id });
      expect({ score: run.pocketsCaught, rank: run.highestPocket, next: run.nextPocketIndex }).toEqual(progress);
      // This edge-case fixture jumps directly to the lip; allow the same camera
      // settling that a real descending flight has already started before aiming.
      settle(run);
      expect(nextEndlessTargets(run).length).toBeGreaterThan(0);
      expect(run.room.pockets.length).toBeLessThanOrEqual(32);
      expect(run.sectionProgress!.sections.length).toBeLessThanOrEqual(5);
      expect(run.collectedPickupIds.length).toBeLessThanOrEqual(6);
      expect(deserializeEndlessRun(serializeEndlessRun(run))).toEqual(run);
    }
  });
});
