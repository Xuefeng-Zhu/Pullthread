/** @jest-environment node */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { describe, expect, test } from '@jest/globals';

import { ENDLESS_PROGRESS_STORAGE_KEY, resetEndlessProgressStoreForTests, useEndlessProgressStore } from '../../../store/useEndlessProgressStore';
import { createEndlessRun, createWorldEndlessRun, nextEndlessTargets, stepEndless, teleportEndless, type EndlessRun } from '../endless';
import { worldStageForScore } from '../progression';
import { deserializeEndlessRun, serializeEndlessRun } from '../snapshots';
import { barrierIsActive, pocketPosition } from '../simulation';
import type { LaunchPocket } from '../types';

function catchPocket(run: EndlessRun, target?: LaunchPocket): void {
  const targets = nextEndlessTargets(run);
  const pocket = target ?? run.room.pockets.find((candidate) => targets.includes(candidate.id) && candidate.route !== 'reward')
    ?? run.room.pockets.find((candidate) => targets.includes(candidate.id))!;
  const center = pocketPosition(pocket, run.state.tick + 1);
  Object.assign(run.state, { phase: 'flying', position: { x: center.x, y: center.y - 2 },
    velocity: { x: 0, y: 480 }, sourcePocketImmune: false });
  expect(stepEndless(run)).toContainEqual({ type: 'catch', id: pocket.id, tick: run.state.tick });
}

function progress(run: EndlessRun, condition: (run: EndlessRun) => boolean): EndlessRun {
  for (let count = 0; count < 160 && !condition(run); count += 1) catchPocket(run);
  expect(condition(run)).toBe(true);
  return run;
}

function show(run: EndlessRun, pocket: LaunchPocket): void {
  run.cameraY = pocketPosition(pocket, run.state.tick).y - 250;
}

describe('version-four milestone and tool compatibility', () => {
  test('crosses 19/20 through 119/120 only on a scored catch without rewriting retained objects', () => {
    const run = createEndlessRun(0);
    for (let stage = 1; stage <= 6; stage += 1) {
      progress(run, (candidate) => candidate.pocketsCaught === stage * 20 - 1);
      expect(worldStageForScore(run.pocketsCaught)).toBe(stage - 1);
      const objects = [...run.room.pockets, ...run.room.barriers!, ...run.room.switches!];
      const originals = new Map(objects.map((object) => [object.id, { reference: object, data: JSON.stringify(object) }]));
      const current = run.room.pockets.find((pocket) => pocket.id === run.state.pocketId)!;
      const beforeIntroductions = [...run.sectionProgress!.introductions!];
      catchPocket(run, current);
      expect(run.pocketsCaught).toBe(stage * 20 - 1);
      expect(run.sectionProgress!.introductions).toEqual(beforeIntroductions);
      catchPocket(run);
      expect(run.pocketsCaught).toBe(stage * 20);
      expect(worldStageForScore(run.pocketsCaught)).toBe(stage);
      for (const object of [...run.room.pockets, ...run.room.barriers!, ...run.room.switches!]) {
        const before = originals.get(object.id);
        if (before) { expect(object).toBe(before.reference); expect(JSON.stringify(object)).toBe(before.data); }
      }
      expect(deserializeEndlessRun(serializeEndlessRun(run))).toEqual(run);
    }
  });

  test('teleport skips ranks for one point and skipped or revisited arrivals never advance a world', () => {
    const run = progress(createEndlessRun(7), (candidate) => candidate.pocketsCaught === 18);
    const previousHighest = run.highestPocket;
    const target = run.room.pockets.filter((pocket) => pocket.ascentRank! > previousHighest + 1 && !pocket.orbit)
      .sort((left, right) => right.ascentRank! - left.ascentRank!)[0];
    show(run, target);
    expect(teleportEndless(run, target.id, true)).toBe(true);
    expect(run.highestPocket).toBeGreaterThanOrEqual(20);
    expect(run.pocketsCaught).toBe(19);
    expect(worldStageForScore(run.pocketsCaught)).toBe(0);
    expect(run.sectionProgress!.introductions).toEqual([0, 0, 0, 0]);
    const skipped = run.room.pockets.find((pocket) => pocket.ascentRank! > previousHighest && pocket.ascentRank! < target.ascentRank!)!;
    catchPocket(run, skipped);
    expect(run.pocketsCaught).toBe(19);
    const next = run.room.pockets.find((pocket) => pocket.ascentRank === run.highestPocket + 1)!;
    show(run, next);
    expect(teleportEndless(run, next.id, true)).toBe(true);
    expect(run.pocketsCaught).toBe(20);
    expect(worldStageForScore(run.pocketsCaught)).toBe(1);
    expect(deserializeEndlessRun(serializeEndlessRun(run))).toEqual(run);
  });

  test('teleport preserves a v4 hoop orbit while historical v3 sway still freezes at its caught position', () => {
    const current = progress(createEndlessRun(0), (run) => run.room.pockets.some((pocket) => pocket.orbit));
    const hoop = current.room.pockets.find((pocket) => pocket.orbit)!;
    const pivot = { ...hoop.center };
    show(current, hoop);
    expect(teleportEndless(current, hoop.id, true)).toBe(true);
    expect(current.room.pockets.find((pocket) => pocket.id === hoop.id)?.orbit).toEqual(hoop.orbit);
    const arrival = { ...current.state.position };
    const resumed = deserializeEndlessRun(serializeEndlessRun(current))!;
    for (let tick = 0; tick < 30; tick += 1) { stepEndless(current); stepEndless(resumed); }
    expect(current.state.position).not.toEqual(arrival);
    expect(current.room.pockets.find((pocket) => pocket.id === hoop.id)?.center).toEqual(pivot);
    expect(resumed).toEqual(current);
    const historical = progress(createWorldEndlessRun(0), (run) => run.room.pockets.some((pocket) => pocket.motion));
    const sway = historical.room.pockets.find((pocket) => pocket.motion)!;
    show(historical, sway);
    expect(teleportEndless(historical, sway.id, true)).toBe(true);
    const frozen = { ...historical.state.position };
    for (let tick = 0; tick < 30; tick += 1) stepEndless(historical);
    expect(historical.state.position).toEqual(frozen);
    expect(historical.room.pockets.find((pocket) => pocket.id === sway.id)?.motion).toBeUndefined();
    expect(deserializeEndlessRun(serializeEndlessRun(historical))?.generationVersion).toBe(3);
  });

  test('landing on a switch by teleport opens its linked door once and persists through a return landing', () => {
    const run = progress(createEndlessRun(0), (candidate) => !!candidate.room.switches?.some((button) => button.pocketId));
    const button = run.room.switches!.find((candidate) => candidate.pocketId)!;
    const target = run.room.pockets.find((pocket) => pocket.id === button.pocketId)!;
    const door = run.room.barriers!.find((barrier) => barrier.id === button.doorIds[0])!;
    expect(barrierIsActive(door, run.room, run.state, run.state.tick)).toBe(true);
    show(run, target);
    expect(teleportEndless(run, target.id, true)).toBe(true);
    const score = run.pocketsCaught;
    expect(run.state.activatedSwitchIds).toContain(button.id);
    expect(barrierIsActive(door, run.room, run.state, run.state.tick)).toBe(false);
    catchPocket(run, target);
    expect(run.pocketsCaught).toBe(score);
    expect(run.state.activatedSwitchIds!.filter((id) => id === button.id)).toHaveLength(1);
    expect(deserializeEndlessRun(serializeEndlessRun(run))).toEqual(run);
  });

  test('a new v4 run clears world and interaction progress while preserving the durable best', async () => {
    await resetEndlessProgressStoreForTests();
    const previous = progress(createEndlessRun(0), (run) => run.pocketsCaught === 100);
    useEndlessProgressStore.getState().recordScore(previous.pocketsCaught);
    await Promise.resolve();
    await Promise.resolve();
    const persisted = await AsyncStorage.getItem(ENDLESS_PROGRESS_STORAGE_KEY);
    expect(JSON.parse(persisted!).state.bestPockets).toBe(100);
    const fresh = createEndlessRun(previous.seed);
    useEndlessProgressStore.getState().recordScore(fresh.pocketsCaught);
    expect(fresh.generationVersion).toBe(4);
    expect(fresh.pocketsCaught).toBe(0);
    expect(fresh.sectionProgress!.introductions).toEqual([0, 0, 0, 0]);
    expect(fresh.state.brokenBarrierIds).toEqual([]);
    expect(fresh.state.activatedSwitchIds).toEqual([]);
    expect(useEndlessProgressStore.getState().bestPockets).toBe(100);
    expect(await AsyncStorage.getItem(ENDLESS_PROGRESS_STORAGE_KEY)).toBe(persisted);
    await resetEndlessProgressStoreForTests();
  });
});
