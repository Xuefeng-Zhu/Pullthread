/** @jest-environment node */
import { describe, expect, test } from '@jest/globals';
import { createEndlessRun, createLegacyEndlessRun, launchEndless, stepEndless } from '../endless';
import { cloneEndlessRun, deserializeEndlessRun, serializeEndlessRun } from '../snapshots';

describe('run snapshot recovery', () => {
  test('round-trips the open world and nonrecursive catch checkpoint through JSON', () => {
    const run = createEndlessRun(77);
    run.inventory = { preview: 2, teleport: 1, revive: 1 };
    run.previewActive = true;
    launchEndless(run, { x: -24, y: 72 });
    for (let tick = 0; tick < 20; tick += 1) stepEndless(run);
    const encoded = serializeEndlessRun(run);
    expect(encoded).toContain('"$launchNumber":"-Infinity"');
    expect(deserializeEndlessRun(encoded)).toEqual(run);
    expect(run.lastCatchSnapshot).not.toHaveProperty('lastCatchSnapshot');
    expect(run.lastCatchSnapshot).not.toHaveProperty('inventory');
  });

  test('clones every mutable object used by simulation, inventory, prediction and revival', () => {
    const original = createEndlessRun(7);
    const copy = cloneEndlessRun(original);
    copy.state.position.x = 1;
    copy.state.pickupIds.push('endless-pickup-2');
    copy.collectedPickupIds.push('endless-pickup-2');
    copy.inventory.preview = 20;
    copy.room.pockets[0].center.x = 1;
    copy.lastCatchSnapshot!.state.position.x = 1;
    expect(original).toEqual(createEndlessRun(7));
  });

  test('rejects corrupted versions, unsafe generator cursors, malformed physics, and missing tool state', () => {
    const encoded = serializeEndlessRun(createLegacyEndlessRun(0));
    const change = (mutate: (value: any) => void) => { // Test malformed external JSON, intentionally outside the static contract.
      const value: unknown = JSON.parse(encoded);
      mutate(value);
      return JSON.stringify(value);
    };
    const corruptions = [
      '{', 'null', '{}',
      change((value) => { value.version = 99; }),
      change((value) => { delete value.run.inventory; }),
      change((value) => { value.run.inventory.preview = -1; }),
      change((value) => { value.run.nextPocketIndex = 0; }),
      change((value) => { value.run.nextPocketIndex = 1_000_000; }),
      change((value) => { value.run.room.pockets[1].motion = { amplitude: 10, periodTicks: 0, phaseTicks: 0 }; }),
      change((value) => { value.run.room.bumpers[0].restitution = null; }),
      change((value) => { value.run.room.pickups[0].kind = 'coins'; }),
      change((value) => { value.run.lastCatchSnapshot = null; }),
      change((value) => { value.run.lastCatchSnapshot.lastCatchSnapshot = {}; }),
      change((value) => { value.run.challenges[0].pickupIds = null; }),
      change((value) => { value.run.state.sourcePocketImmune = null; }),
    ];
    corruptions.forEach((payload) => expect(deserializeEndlessRun(payload)).toBeNull());
    const invalid = createEndlessRun(0);
    invalid.cameraY = Number.NaN;
    expect(() => serializeEndlessRun(invalid)).toThrow('NaN');
  });
});
