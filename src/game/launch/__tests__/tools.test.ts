/** @jest-environment node */
import { describe, expect, test } from '@jest/globals';
import { emptyToolInventory } from '../../../commerce/contracts';
import {
  activatePreview, createEndlessRun, createLegacyEndlessRun, eligibleTeleportPockets, launchEndless, reviveEndless,
  stepEndless, teleportEndless, type EndlessRun,
} from '../endless';
import { scheduledPickupKind } from '../pickups';
import { captureEndlessWorld, cloneEndlessRun } from '../snapshots';
import { pocketPosition } from '../simulation';
import { findNextInput, replayNext } from '../testing/routeSolver';
import type { LaunchEvent, LaunchPickup } from '../types';
import { grantFreeTool } from '../toolInventory';

function finish(run: EndlessRun): LaunchEvent[] {
  const events: LaunchEvent[] = [];
  for (let tick = 0; tick < 960 && run.state.phase === 'flying'; tick += 1) events.push(...stepEndless(run));
  return events;
}

function pickupFlight(kind: LaunchPickup['kind'], simultaneousHazard = false): EndlessRun {
  const run = createEndlessRun(0);
  run.room = { ...run.room, gravity: 0, bumpers: [],
    hazards: [{ id: 'thorn', center: { x: simultaneousHazard ? 120 : 180, y: 200 }, radius: 4 }],
    pickups: [{ id: 'endless-pickup-2', kind, center: { x: 120, y: 200 }, radius: 4 }],
  };
  Object.assign(run.state, { phase: 'flying', position: { x: 80, y: 200 }, velocity: { x: 24000, y: 0 } });
  return run;
}

describe('run tools and airborne collectibles', () => {
  test('the named schedule is sparse, repeatable, and never attaches a pickup to the first catch', () => {
    expect(Array.from({ length: 35 }, (_, index) => [index, scheduledPickupKind(index)])
      .filter(([, kind]) => kind)).toEqual([
      [2, 'preview'], [4, 'revive'], [6, 'teleport'], [10, 'preview'], [14, 'teleport'],
      [19, 'revive'], [24, 'preview'], [29, 'teleport'], [34, 'revive'],
    ]);
    expect(createEndlessRun(0).inventory).toEqual(emptyToolInventory());
  });

  test('swept contact collects before a later hazard in the same fast tick, without granting score', () => {
    const run = pickupFlight('preview');
    expect(stepEndless(run).map((event) => event.type)).toEqual(['pickup', 'fail']);
    expect(run.inventory.preview).toBe(1);
    expect(run.state.phase).toBe('failed');
    expect(run.pocketsCaught).toBe(0);
    expect(run.collectedPickupIds).toEqual(['endless-pickup-2']);
    expect(run.room.pickups).toEqual([]);
    expect(stepEndless(run)).toEqual([]);
    expect(run.inventory.preview).toBe(1);
    const simultaneous = pickupFlight('preview', true);
    expect(stepEndless(simultaneous).map((event) => event.type)).toEqual(['fail']);
    expect(simultaneous.inventory.preview).toBe(0);
  });

  test('a passive pickup does not change any physical position, velocity, capture tick or scrolling floor', () => {
    const withPickup = createEndlessRun(0);
    withPickup.room = { ...withPickup.room, pickups: [{
      id: 'endless-pickup-2', kind: 'preview', center: { x: 135, y: 379 }, radius: 10,
    }] };
    const withoutPickup = cloneEndlessRun(withPickup);
    withoutPickup.room = { ...withoutPickup.room, pickups: [] };
    for (const run of [withPickup, withoutPickup]) launchEndless(run, { x: -24, y: 72 });
    while (withPickup.state.phase === 'flying') {
      stepEndless(withPickup);
      stepEndless(withoutPickup);
      expect(withPickup.state.position).toEqual(withoutPickup.state.position);
      expect(withPickup.state.velocity).toEqual(withoutPickup.state.velocity);
      expect(withPickup.state.phase).toEqual(withoutPickup.state.phase);
      expect(withPickup.cameraY).toBe(withoutPickup.cameraY);
    }
    expect(withPickup.inventory.preview).toBe(1);
    expect(withoutPickup.inventory.preview).toBe(0);
  });

  test('an already visible revive keeps its icon, then awards Preview if another revive is owned or used', () => {
    for (const used of [false, true]) {
      const run = pickupFlight('revive');
      run.reviveUsed = used;
      if (!used) grantFreeTool(run, 'revive');
      expect(run.room.pickups![0].kind).toBe('revive');
      expect(stepEndless(run)[0]).toMatchObject({ type: 'pickup', kind: 'preview', convertedFrom: 'revive' });
      expect(run.inventory.preview).toBe(1);
      expect(run.inventory.revive).toBe(used ? 0 : 1);
    }
  });

  test('legacy generation substitutes future revive pickups, without changing an existing visible one', () => {
    const run = createLegacyEndlessRun(0);
    expect(run.room.pickups!.find((pickup) => pickup.id === 'endless-pickup-4')!.kind).toBe('revive');
    run.reviveUsed = true;
    for (let index = 0; index < 14; index += 1) replayNext(run, findNextInput(run));
    expect(run.room.pickups!.find((pickup) => pickup.id === 'endless-pickup-19')!.kind).toBe('preview');
  });

  test('Preview spends once, survives invalid releases, and ends on the next successful launch', () => {
    const run = createEndlessRun(0);
    expect(activatePreview(run)).toBe(false);
    grantFreeTool(run, 'preview');
    grantFreeTool(run, 'preview');
    expect(activatePreview(run)).toBe(true);
    expect(activatePreview(run)).toBe(false);
    expect(run.inventory.preview).toBe(1);
    expect(launchEndless(run, { x: 0, y: 0 })).toBe(false);
    expect(run.previewActive).toBe(true);
    expect(launchEndless(run, { x: -24, y: 72 })).toBe(true);
    expect(run.previewActive).toBe(false);
    expect(activatePreview(run, true)).toBe(false);
    expect(run.inventory.preview).toBe(1);
  });

  test('externally authorized activations leave free inventory intact and cannot bypass invalid game state', () => {
    const run = createEndlessRun(0);
    expect(activatePreview(run, true)).toBe(true);
    expect(run.inventory.preview).toBe(0);
    expect(teleportEndless(run, 'endless-0', true)).toBe(false);
    expect(teleportEndless(run, 'missing', true)).toBe(false);
    expect(reviveEndless(run, true)).toBe(false);
    expect(teleportEndless(run, 'endless-1', true)).toBe(true);
    expect(run.inventory.teleport).toBe(0);
    expect(run.previewActive).toBe(true);
  });

  test('Teleport can catch in midflight, scores one advancing arrival, and does not farm skipped or older pockets', () => {
    const run = createEndlessRun(0, 5);
    run.inventory.teleport = 4;
    expect(launchEndless(run, { x: -24, y: 72 })).toBe(true);
    expect(teleportEndless(run, 'endless-2')).toBe(true);
    expect(run.state.phase).toBe('held');
    expect(run.highestPocket).toBe(2);
    expect(run.pocketsCaught).toBe(1);
    expect(run.inventory.teleport).toBe(3);
    expect(teleportEndless(run, 'endless-1')).toBe(true);
    expect(teleportEndless(run, 'endless-2')).toBe(true);
    expect(run.pocketsCaught).toBe(1);
    expect(run.highestPocket).toBe(2);
    expect(run.state.velocity).toEqual({ x: 0, y: 0 });
    expect(run.state.flightTicks).toBe(0);
    expect(run.lastCatchSnapshot!.state.pocketId).toBe('endless-2');
  });

  test('Teleport freezes a moving destination at the live clock and requires its entire opening above the floor', () => {
    const run = createEndlessRun(0);
    const target = { ...run.room.pockets[1], motion: { amplitude: 35, periodTicks: 360, phaseTicks: 0 } };
    run.room = { ...run.room, pockets: [run.room.pockets[0], target] };
    run.state.tick = 45;
    const actualPosition = pocketPosition(target, run.state.tick);
    expect(teleportEndless(run, target.id, true)).toBe(true);
    expect(run.state.position).toEqual(actualPosition);
    expect(run.room.pockets.find((pocket) => pocket.id === target.id)!.motion).toBeUndefined();
    for (let tick = 0; tick < 90; tick += 1) stepEndless(run);
    expect(run.state.position).toEqual(actualPosition);

    const unavailable = createEndlessRun(0);
    grantFreeTool(unavailable, 'teleport');
    unavailable.room = { ...unavailable.room, pockets: [...unavailable.room.pockets,
      { id: 'endless-88', kind: 'checkpoint', center: { x: 180, y: 595 }, width: 120 },
      { id: 'endless-89', kind: 'checkpoint', center: { x: 20, y: 250 }, width: 120 },
      { id: 'endless-90', kind: 'checkpoint', center: { x: 180, y: -5 }, width: 120 },
    ] };
    expect(eligibleTeleportPockets(unavailable).map((pocket) => pocket.id)).not.toEqual(expect.arrayContaining(['endless-88', 'endless-89', 'endless-90']));
    for (const id of ['endless-88', 'endless-89', 'endless-90']) expect(teleportEndless(unavailable, id)).toBe(false);
    unavailable.state.phase = 'failed';
    expect(eligibleTeleportPockets(unavailable)).toEqual([]);
    expect(teleportEndless(unavailable, 'endless-1', true)).toBe(false);
    expect(unavailable.inventory.teleport).toBe(1);
  });

  test('Revive restores the last catch clock, geometry, camera and generator while retaining failed-flight collectibles', () => {
    const run = createEndlessRun(0);
    replayNext(run, findNextInput(run));
    const checkpoint = cloneEndlessRun(run).lastCatchSnapshot!;
    const pickup = { id: 'endless-pickup-2', kind: 'preview' as const, center: { x: 120, y: 200 }, radius: 4 };
    run.room = { ...run.room, pickups: [pickup] };
    run.lastCatchSnapshot = captureEndlessWorld(run);
    grantFreeTool(run, 'revive');
    // An actually collected object is also present in the saved room, exercising
    // removal on restore rather than only preserving the inventory count.
    run.room = { ...run.room, gravity: 0, bumpers: [], hazards: [{ id: 'thorn', center: { x: 180, y: 200 }, radius: 4 }] };
    Object.assign(run.state, { phase: 'flying', position: { x: 80, y: 200 }, velocity: { x: 24000, y: 0 } });
    expect(stepEndless(run).map((event) => event.type)).toEqual(['pickup', 'fail']);
    expect(reviveEndless(run)).toBe(true);
    expect(run.state.phase).toBe('held');
    expect(run.state.tick).toBe(checkpoint.state.tick);
    expect(run.state.position).toEqual(checkpoint.state.position);
    expect(run.cameraY).toBe(checkpoint.cameraY);
    expect(run.challenges).toEqual(checkpoint.challenges);
    expect(run.nextPocketIndex).toBe(checkpoint.nextPocketIndex);
    expect(run.room.gravity).toBe(700);
    expect(run.room.hazards).toEqual(checkpoint.room.hazards);
    expect(run.inventory).toEqual({ ...emptyToolInventory(), preview: 1 });
    expect(run.room.pickups).toEqual([]);
    expect(run.state.pickupIds).toContain(pickup.id);
    expect(run.reviveUsed).toBe(true);
    expect(launchEndless(run, { x: -100, y: 0 })).toBe(true);
    finish(run);
    expect(run.state.phase).toBe('failed');
    expect(reviveEndless(run, true)).toBe(false);
  });

  test('an authorized revive converts a spare free revive and still obeys the once-per-run limit', () => {
    const run = createEndlessRun(0);
    grantFreeTool(run, 'revive');
    launchEndless(run, { x: -100, y: 0 });
    finish(run);
    expect(reviveEndless(run, true)).toBe(true);
    expect(run.inventory).toEqual({ ...emptyToolInventory(), preview: 1 });
    expect(run.reviveUsed).toBe(true);
  });
});
