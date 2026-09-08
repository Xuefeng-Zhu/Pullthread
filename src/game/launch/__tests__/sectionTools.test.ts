/** @jest-environment node */
import { describe, expect, test } from '@jest/globals';

import {
  advanceEndless, createSectionEndlessRun as createEndlessRun, eligibleTeleportPockets, nextEndlessTargets,
  reviveEndless, stepEndless, teleportEndless, type EndlessRun,
} from '../endless';
import { captureEndlessWorld, cloneEndlessRun, deserializeEndlessRun, serializeEndlessRun } from '../snapshots';
import { createLaunchClock, pocketPosition, resetLaunchClock } from '../simulation';
import type { LaunchPocket } from '../types';

function catchPocket(run: EndlessRun, id: string): void {
  const pocket = run.room.pockets.find((candidate) => candidate.id === id)!;
  const position = pocketPosition(pocket, run.state.tick);
  Object.assign(run.state, {
    phase: 'flying', position: { x: position.x, y: position.y - 2 },
    velocity: { x: 0, y: 480 }, sourcePocketImmune: false,
  });
  expect(stepEndless(run)).toContainEqual({ type: 'catch', tick: run.state.tick, id });
}

function showPocket(run: EndlessRun, pocket: LaunchPocket): void {
  run.cameraY = pocket.center.y - 250;
  run.room = { ...run.room, bounds: { ...run.room.bounds, bottom: run.cameraY + 600 } };
}

function atFork(): EndlessRun {
  const run = createEndlessRun(0);
  catchPocket(run, 'endless-1');
  catchPocket(run, 'endless-2');
  return run;
}

function withFray(): { run: EndlessRun; temporary: LaunchPocket } {
  const run = createEndlessRun(0);
  for (let catches = 0; catches < 80; catches += 1) {
    const temporary = run.room.pockets.find((pocket) => pocket.frayTicks !== undefined);
    if (temporary) return { run, temporary };
    const targets = nextEndlessTargets(run);
    const safe = targets.find((id) => run.room.pockets.find((pocket) => pocket.id === id)?.route !== 'reward') ?? targets[0];
    expect(safe).toBeDefined();
    catchPocket(run, safe);
  }
  throw new Error('Seed zero should generate a fraying section after twelve scored catches.');
}

describe('section gameplay and tools', () => {
  test('gifts leave a full section between appearances, rotate all tools, and survive save/load', () => {
    const run = createEndlessRun(0);
    expect(run.room.pickups).toContainEqual(expect.objectContaining({ id: 'opening-preview', kind: 'preview' }));
    const gifts = new Map<number, string[]>();
    for (let catches = 0; catches < 36; catches += 1) {
      for (const section of run.sectionProgress!.sections) {
        if (!gifts.has(section.index)) gifts.set(section.index, run.room.pickups!
          .filter((pickup) => section.pickupIds.includes(pickup.id)).map((pickup) => pickup.kind));
      }
      expect(deserializeEndlessRun(serializeEndlessRun(run))).toEqual(run);
      const targets = nextEndlessTargets(run);
      const safe = targets.find((id) => run.room.pockets.find((pocket) => pocket.id === id)?.route !== 'reward') ?? targets[0];
      catchPocket(run, safe);
    }
    expect(Array.from({ length: 12 }, (_, index) => gifts.get(index))).toEqual([
      ['preview'], [], ['revive'], [], ['teleport'], [],
      ['preview'], [], ['revive'], [], ['teleport'], [],
    ]);
  });

  test('a previously saved gift on an unscheduled section stays available after resuming', () => {
    const run = atFork();
    const section = run.sectionProgress!.sections.find((candidate) => candidate.index === 1)!;
    const reward = run.room.pockets.find((pocket) => pocket.sectionId === section.id && pocket.route === 'reward')!;
    const historicalGift = { id: `${section.id}-gift`, kind: 'revive' as const,
      center: { x: reward.center.x, y: reward.center.y - 24 }, radius: 17 };
    run.room = { ...run.room, pickups: [...run.room.pickups!, historicalGift] };
    run.sectionProgress!.sections = run.sectionProgress!.sections.map((candidate) => candidate.id === section.id
      ? { ...candidate, pickupIds: [historicalGift.id] } : candidate);
    run.lastCatchSnapshot = captureEndlessWorld(run);
    const restored = deserializeEndlessRun(serializeEndlessRun(run))!;
    expect(restored).not.toBeNull();
    catchPocket(restored, nextEndlessTargets(restored)[0]);
    expect(restored.room.pickups).toContainEqual(historicalGift);
    expect(restored.sectionProgress!.sections.find((candidate) => candidate.id === section.id)?.pickupIds)
      .toEqual([historicalGift.id]);
  });

  test('the historical v2 opening reveals two same-rank destinations with forgiving and rewarding silhouettes', () => {
    const run = atFork();
    expect(run.generationVersion).toBe(2);
    const targets = nextEndlessTargets(run).map((id) => run.room.pockets.find((pocket) => pocket.id === id)!);
    expect(targets).toHaveLength(2);
    expect(targets.map((pocket) => pocket.route).sort()).toEqual(['reward', 'safe']);
    expect(new Set(targets.map((pocket) => pocket.ascentRank)).size).toBe(1);
    expect(targets[0].ascentRank).toBe(3);
    expect(targets.find((pocket) => pocket.route === 'safe')!.width)
      .toBeGreaterThan(targets.find((pocket) => pocket.route === 'reward')!.width);
  });

  test('sibling catches and teleports cannot farm score or prune the sibling route', () => {
    const run = atFork();
    const targets = nextEndlessTargets(run);
    const section = run.sectionProgress!.sections.find((candidate) => candidate.entryPocketId === 'endless-2')!;
    const savedPickupIds = run.room.pickups!.filter((pickup) => section.pickupIds.includes(pickup.id)).map((pickup) => pickup.id);
    catchPocket(run, targets[0]);
    expect(run.pocketsCaught).toBe(3);
    expect(run.highestPocket).toBe(3);
    expect(run.room.pockets.map((pocket) => pocket.id)).toEqual(expect.arrayContaining([...section.pocketIds]));
    expect(run.room.pickups!.map((pickup) => pickup.id)).toEqual(expect.arrayContaining(savedPickupIds));
    catchPocket(run, targets[1]);
    expect(run.pocketsCaught).toBe(3);
    const sibling = run.room.pockets.find((pocket) => pocket.id === targets[0])!;
    showPocket(run, sibling);
    run.inventory.teleport = 1;
    expect(teleportEndless(run, sibling.id)).toBe(true);
    expect(run.inventory.teleport).toBe(0);
    expect(run.pocketsCaught).toBe(3);
    expect(run.highestPocket).toBe(3);
  });

  test('a skipped ascent awards one arrival, and later catching a skipped rank earns nothing', () => {
    const run = atFork();
    const exit = run.room.pockets.find((pocket) => pocket.id === run.sectionProgress!.sections[0].exitPocketId)!;
    showPocket(run, exit);
    expect(teleportEndless(run, exit.id, true)).toBe(true);
    expect(run.pocketsCaught).toBe(3);
    expect(run.highestPocket).toBe(exit.ascentRank);
    const skipped = run.room.pockets.find((pocket) => pocket.ascentRank === 3)!;
    catchPocket(run, skipped.id);
    expect(run.pocketsCaught).toBe(3);
    expect(run.highestPocket).toBe(exit.ascentRank);
  });

  test('teleport starts a first-arrival deadline once and rejects expired destinations before spending', () => {
    const { run, temporary } = withFray();
    expect(run.pocketsCaught).toBeGreaterThanOrEqual(12);
    showPocket(run, temporary);
    expect(teleportEndless(run, temporary.id, true)).toBe(true);
    const expiry = run.state.tick + 480;
    expect(run.state.pocketExpiryTicks?.[temporary.id]).toBe(expiry);
    const safe = run.room.pockets.find((pocket) => pocket.sectionId === temporary.sectionId && pocket.route === 'safe')!;
    showPocket(run, safe);
    expect(teleportEndless(run, safe.id, true)).toBe(true);
    run.state.tick += 80;
    showPocket(run, temporary);
    expect(teleportEndless(run, temporary.id, true)).toBe(true);
    expect(run.state.pocketExpiryTicks?.[temporary.id]).toBe(expiry);
    showPocket(run, safe);
    expect(teleportEndless(run, safe.id, true)).toBe(true);
    const parentId = run.sectionProgress!.sections.flatMap((section) => section.connections)
      .find((edge) => edge.to === temporary.id)!.from;
    const parent = run.room.pockets.find((pocket) => pocket.id === parentId)!;
    showPocket(run, parent);
    expect(teleportEndless(run, parent.id, true)).toBe(true);
    expect(nextEndlessTargets(run)).toContain(temporary.id);
    run.state.tick = expiry;
    showPocket(run, temporary);
    run.inventory.teleport = 2;
    expect(eligibleTeleportPockets(run).map((pocket) => pocket.id)).not.toContain(temporary.id);
    expect(nextEndlessTargets(run)).not.toContain(temporary.id);
    const before = serializeEndlessRun(run);
    expect(teleportEndless(run, temporary.id)).toBe(false);
    expect(teleportEndless(run, temporary.id, true)).toBe(false);
    expect(serializeEndlessRun(run)).toBe(before);
  });

  test('v2 snapshots round-trip independent lifetime maps, routes, and section cursors', () => {
    const { run, temporary } = withFray();
    showPocket(run, temporary);
    expect(teleportEndless(run, temporary.id, true)).toBe(true);
    for (let tick = 0; tick < 50; tick += 1) stepEndless(run);
    const encoded = serializeEndlessRun(run);
    expect(JSON.parse(encoded).version).toBe(2);
    const restored = deserializeEndlessRun(encoded);
    expect(restored).toEqual(run);
    const clone = cloneEndlessRun(run);
    clone.state.pocketExpiryTicks![temporary.id] += 1;
    clone.lastCatchSnapshot!.state.pocketExpiryTicks![temporary.id] += 2;
    expect(run.state.pocketExpiryTicks![temporary.id]).toBe(restored!.state.pocketExpiryTicks![temporary.id]);
    expect(run.lastCatchSnapshot!.state.pocketExpiryTicks![temporary.id])
      .toBe(restored!.lastCatchSnapshot!.state.pocketExpiryTicks![temporary.id]);
  });

  test('revive restores the catch clock and remaining timer while preserving a failed-flight reward exactly once', () => {
    const { run, temporary } = withFray();
    showPocket(run, temporary);
    expect(teleportEndless(run, temporary.id, true)).toBe(true);
    for (let tick = 0; tick < 60; tick += 1) stepEndless(run);
    catchPocket(run, temporary.id);
    const pickup = run.room.pickups![0];
    expect(pickup).toBeDefined();
    const checkpoint = captureEndlessWorld(run);
    const remaining = run.state.pocketExpiryTicks![temporary.id] - run.state.tick;
    expect(remaining).toBe(419);
    run.lastCatchSnapshot = checkpoint;
    const inventoryBefore = { ...run.inventory };
    const y = temporary.center.y - 100;
    run.room = { ...run.room, gravity: 0, bumpers: [],
      pickups: [{ ...pickup, kind: 'preview', center: { x: 120, y }, radius: 4 }],
      hazards: [{ id: 'failure-thorn', center: { x: 180, y }, radius: 4 }],
    };
    Object.assign(run.state, { phase: 'flying', position: { x: 80, y }, velocity: { x: 24000, y: 0 } });
    expect(stepEndless(run).map((event) => event.type)).toEqual(['pickup', 'fail']);
    expect(reviveEndless(run, true)).toBe(true);
    expect(run.state.tick).toBe(checkpoint.state.tick);
    expect(run.state.pocketExpiryTicks![temporary.id] - run.state.tick).toBe(remaining);
    expect(run.sectionProgress).toEqual(checkpoint.sectionProgress);
    expect(run.inventory.preview).toBe(inventoryBefore.preview + 1 + inventoryBefore.revive);
    expect(run.room.pickups!.map((candidate) => candidate.id)).not.toContain(pickup.id);
    expect(run.state.pickupIds).toContain(pickup.id);
    expect(run.collectedPickupIds.filter((id) => id === pickup.id)).toHaveLength(1);
    const restored = deserializeEndlessRun(serializeEndlessRun(run));
    expect(restored).toEqual(run);
    expect(restored!.room.pickups!.map((candidate) => candidate.id)).not.toContain(pickup.id);
  });

  test('resuming a paused foreground clock consumes only new simulation time', () => {
    const { run, temporary } = withFray();
    showPocket(run, temporary);
    expect(teleportEndless(run, temporary.id, true)).toBe(true);
    const clock = createLaunchClock();
    advanceEndless(run, clock, 1 / 240);
    const paused = serializeEndlessRun(run);
    resetLaunchClock(clock);
    resetLaunchClock(clock);
    expect(serializeEndlessRun(run)).toBe(paused);
    advanceEndless(run, clock, 1 / 120);
    expect(run.state.pocketExpiryTicks![temporary.id] - run.state.tick).toBe(479);
  });
});
