/** @jest-environment node */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { describe, expect, test } from '@jest/globals';

import { ENDLESS_PROGRESS_STORAGE_KEY, resetEndlessProgressStoreForTests, useEndlessProgressStore } from '../../../store/useEndlessProgressStore';
import { createWorldEndlessRun, nextEndlessTargets, reviveEndless, stepEndless, teleportEndless, type EndlessRun } from '../endless';
import { INTRODUCED_MECHANICS, worldForStage, worldStageForScore } from '../progression';
import { cloneEndlessRun, deserializeEndlessRun, serializeEndlessRun } from '../snapshots';
import { pocketPosition } from '../simulation';
import { findTargetInput, replayNext } from '../testing/routeSolver';
import type { LaunchPocket } from '../types';

function safeTarget(run: EndlessRun): LaunchPocket {
  const targets = nextEndlessTargets(run);
  return run.room.pockets.find((pocket) => targets.includes(pocket.id) && pocket.route !== 'reward')
    ?? run.room.pockets.find((pocket) => targets.includes(pocket.id))!;
}

/** Start immediately before a genuine falling catch; generation still runs through stepEndless. */
function catchPocket(run: EndlessRun, pocket = safeTarget(run)): void {
  const position = pocketPosition(pocket, run.state.tick + 1);
  Object.assign(run.state, { phase: 'flying', position: { x: position.x, y: position.y - 2 },
    velocity: { x: 0, y: 480 }, sourcePocketImmune: false });
  expect(stepEndless(run)).toContainEqual({ type: 'catch', id: pocket.id, tick: run.state.tick });
}

function toScore(run: EndlessRun, score: number): EndlessRun {
  for (let index = 0; index < score && run.pocketsCaught < score; index += 1) catchPocket(run);
  expect(run.pocketsCaught).toBe(score);
  return run;
}

function showPocket(run: EndlessRun, pocket: LaunchPocket): void {
  run.cameraY = pocket.center.y - 250;
}

function objects(run: EndlessRun) {
  return [...run.room.pockets, ...run.room.bumpers, ...run.room.hazards,
    ...run.room.pickups ?? [], ...run.room.windZones ?? []];
}

describe('scored-pocket world progression', () => {
  test('all six exact milestones change world after the catch without rewriting retained geometry', () => {
    const run = createWorldEndlessRun(0);
    const names = ['Sewing Table', 'Felt Garden', 'Patchwork Sky', 'Bobbin Workshop', 'Moonlit Quilt', 'Sewing Table', 'Felt Garden'];
    for (let stage = 1; stage <= 6; stage += 1) {
      toScore(run, stage * 20 - 1);
      expect(worldStageForScore(run.pocketsCaught)).toBe(stage - 1);
      expect(worldForStage(worldStageForScore(run.pocketsCaught)).name).toBe(names[stage - 1]);
      const oldSections = new Map(run.sectionProgress!.sections.map((section) => [section.id, section]));
      const oldObjects = new Map(objects(run).map((object) => [object.id, { reference: object, data: JSON.stringify(object) }]));
      const target = safeTarget(run);
      const input = findTargetInput(run, target.id);
      expect(replayNext(run, input)).toContainEqual(expect.objectContaining({ type: 'catch', id: target.id }));
      expect(run.pocketsCaught).toBe(stage * 20);
      expect(worldStageForScore(run.pocketsCaught)).toBe(stage);
      expect(worldForStage(worldStageForScore(run.pocketsCaught)).name).toBe(names[stage]);
      let retained = 0;
      for (const object of objects(run)) {
        const old = oldObjects.get(object.id);
        if (!old) continue;
        retained += 1;
        expect(object).toBe(old.reference);
        expect(JSON.stringify(object)).toBe(old.data);
      }
      expect(retained).toBeGreaterThan(0);
      for (const [id, old] of oldObjects) {
        // Even pruned objects are never edited in place at a milestone.
        expect(JSON.stringify(old.reference)).toBe(old.data);
        expect(old.reference.id).toBe(id);
      }
      for (const section of run.sectionProgress!.sections) {
        if (oldSections.has(section.id)) expect(section).toBe(oldSections.get(section.id));
        else expect(section.worldStage).toBe(stage);
      }
    }
  });

  test('revisiting a pocket at 19 or 20 leaves both the stage and introduction counters unchanged', () => {
    const run = toScore(createWorldEndlessRun(0), 19);
    for (const score of [19, 20]) {
      toScore(run, score);
      const before = { score: run.pocketsCaught, highest: run.highestPocket,
        stage: worldStageForScore(run.pocketsCaught), introductions: [...run.sectionProgress!.introductions!] };
      const current = run.room.pockets.find((pocket) => pocket.id === run.state.pocketId)!;
      catchPocket(run, current);
      expect({ score: run.pocketsCaught, highest: run.highestPocket,
        stage: worldStageForScore(run.pocketsCaught), introductions: run.sectionProgress!.introductions }).toEqual(before);
    }
  });

  test('skipping ranks by teleport scores one catch and neither height nor later skipped catches unlock a world', () => {
    const run = toScore(createWorldEndlessRun(7), 18);
    const earlierHighest = run.highestPocket;
    const target = run.room.pockets.filter((pocket) => pocket.ascentRank! > earlierHighest + 1 && !pocket.frayTicks)
      .sort((left, right) => right.ascentRank! - left.ascentRank!)[0];
    expect(target.ascentRank).toBeGreaterThanOrEqual(20);
    showPocket(run, target);
    run.inventory.teleport = 1;
    expect(teleportEndless(run, target.id)).toBe(true);
    expect(run.inventory.teleport).toBe(0);
    expect(run.pocketsCaught).toBe(19);
    expect(run.highestPocket).toBe(target.ascentRank);
    expect(worldStageForScore(run.pocketsCaught)).toBe(0);
    expect(run.sectionProgress!.introductions).toEqual([0, 0, 0, 0]);
    const skipped = run.room.pockets.find((pocket) => pocket.ascentRank! > earlierHighest
      && pocket.ascentRank! < target.ascentRank! && !pocket.frayTicks)!;
    catchPocket(run, skipped);
    expect(run.pocketsCaught).toBe(19);
    expect(worldStageForScore(run.pocketsCaught)).toBe(0);
    const next = run.room.pockets.find((pocket) => pocket.ascentRank === run.highestPocket + 1 && !pocket.frayTicks)!;
    showPocket(run, next);
    expect(teleportEndless(run, next.id, true)).toBe(true);
    expect(run.pocketsCaught).toBe(20);
    expect(worldForStage(worldStageForScore(run.pocketsCaught)).name).toBe('Felt Garden');
  });

  test('revive restores the scored world and its introduction progress without generating another lesson', () => {
    const run = toScore(createWorldEndlessRun(0), 82);
    const checkpoint = cloneEndlessRun(run);
    Object.assign(run.state, { phase: 'flying', position: { x: 180, y: run.room.bounds.bottom! + 20 },
      velocity: { x: 0, y: 40 }, sourcePocketImmune: false });
    expect(stepEndless(run)).toContainEqual(expect.objectContaining({ type: 'fail' }));
    expect(reviveEndless(run, true)).toBe(true);
    expect(run.pocketsCaught).toBe(checkpoint.pocketsCaught);
    expect(run.highestPocket).toBe(checkpoint.highestPocket);
    expect(run.sectionProgress).toEqual(checkpoint.sectionProgress);
    expect(run.room.pockets).toEqual(checkpoint.room.pockets);
    expect(worldForStage(worldStageForScore(run.pocketsCaught)).name).toBe('Moonlit Quilt');
    expect(deserializeEndlessRun(serializeEndlessRun(run))).toEqual(run);
    const resumed = deserializeEndlessRun(serializeEndlessRun(run))!;
    catchPocket(run);
    catchPocket(resumed);
    expect(resumed).toEqual(run);
  });

  test('saved continuation never duplicates lessons and retains bounded world ownership over 360 catches', () => {
    let run = createWorldEndlessRun(31);
    const uninterrupted = cloneEndlessRun(run);
    const lessons = new Map<string, string>();
    const seen = new Set<string>();
    const remember = () => {
      for (const section of run.sectionProgress!.sections) {
        if (seen.has(section.id)) continue;
        seen.add(section.id);
        if (section.introduction) lessons.set(section.id, section.introduction);
      }
    };
    remember();
    for (let count = 1; count <= 360; count += 1) {
      catchPocket(run);
      catchPocket(uninterrupted);
      remember();
      expect(run.pocketsCaught).toBe(count);
      expect(run.room.pockets.length).toBeLessThanOrEqual(32);
      expect(run.sectionProgress!.sections.length).toBeLessThanOrEqual(8);
      expect(run.room.bumpers.length).toBeLessThanOrEqual(64);
      expect(run.room.hazards.length).toBeLessThanOrEqual(64);
      expect(run.room.windZones!.length).toBeLessThanOrEqual(8);
      expect(run.collectedPickupIds.length).toBeLessThanOrEqual(8);
      if (count % 7 === 0 || count % 20 === 19) {
        run = deserializeEndlessRun(serializeEndlessRun(cloneEndlessRun(run)))!;
        expect(run).not.toBeNull();
        expect(run).toEqual(uninterrupted);
      }
    }
    expect(run.sectionProgress!.introductions).toEqual([3, 3, 3, 3]);
    for (const mechanic of INTRODUCED_MECHANICS) {
      expect([...lessons.values()].filter((introduction) => introduction === mechanic)).toHaveLength(3);
    }
    expect(lessons.size).toBe(12);
  });

  test('a fresh run resets world progress while the durable best score remains intact', async () => {
    await resetEndlessProgressStoreForTests();
    const previous = toScore(createWorldEndlessRun(0), 120);
    useEndlessProgressStore.getState().recordScore(previous.pocketsCaught);
    await Promise.resolve();
    await Promise.resolve();
    const persisted = await AsyncStorage.getItem(ENDLESS_PROGRESS_STORAGE_KEY);
    expect(JSON.parse(persisted!).state.bestPockets).toBe(120);
    const fresh = createWorldEndlessRun(previous.seed);
    useEndlessProgressStore.getState().recordScore(fresh.pocketsCaught);
    expect(fresh.pocketsCaught).toBe(0);
    expect(fresh.sectionProgress!.introductions).toEqual([0, 0, 0, 0]);
    expect(worldForStage(worldStageForScore(fresh.pocketsCaught)).name).toBe('Sewing Table');
    expect(useEndlessProgressStore.getState().bestPockets).toBe(120);
    expect(await AsyncStorage.getItem(ENDLESS_PROGRESS_STORAGE_KEY)).toBe(persisted);
    await resetEndlessProgressStoreForTests();
  });
});
