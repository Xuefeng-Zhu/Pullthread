/** @jest-environment node */
import { describe, expect, test } from '@jest/globals';
import { emptyToolInventory, type ToolKind } from '../../../commerce/contracts';
import { advanceEndless, createEndlessRun, launchEndless, reviveEndless, stepEndless } from '../endless';
import { createLaunchClock } from '../simulation';
import { captureEndlessWorld, deserializeEndlessRun, serializeEndlessRun } from '../snapshots';
import { FREE_TOOL_CAPACITY, grantFreeTool, spendFreeTool } from '../toolInventory';
import { applyEndlessTool } from '../tools';
import type { LaunchEvent } from '../types';

describe('three-charge free tool inventory', () => {
  test('a fourth pickup replaces the oldest charge, even when it is the most expensive', () => {
    const run = createEndlessRun(0);
    for (const kind of ['needle', 'preview', 'sail'] as const) expect(grantFreeTool(run, kind)).toBeUndefined();
    expect(grantFreeTool(run, 'bounce')).toBe('needle');
    expect(run.freeToolQueue).toEqual(['preview', 'sail', 'bounce']);
    expect(run.inventory).toEqual({ ...emptyToolInventory(), preview: 1, sail: 1, bounce: 1 });
    expect(Object.values(run.inventory).reduce((sum, value) => sum + value, 0)).toBe(FREE_TOOL_CAPACITY);
  });

  test('duplicate kinds occupy separate slots and spending removes that kind’s oldest charge', () => {
    const run = createEndlessRun(0);
    for (const kind of ['preview', 'sail', 'preview'] as const) grantFreeTool(run, kind);
    expect(spendFreeTool(run, 'preview')).toBe(true);
    expect(run.freeToolQueue).toEqual(['sail', 'preview']);
    expect(grantFreeTool(run, 'needle')).toBeUndefined();
    expect(grantFreeTool(run, 'preview')).toBe('sail');
    expect(run.freeToolQueue).toEqual(['preview', 'needle', 'preview']);
    expect(run.inventory.preview).toBe(2);
    expect(spendFreeTool(run, 'bounce')).toBe(false);
    expect(run.freeToolQueue).toEqual(['preview', 'needle', 'preview']);
  });

  test('paid preparation uses no free slot; invalid activation and short pulls preserve inventory', () => {
    const run = createEndlessRun(0);
    for (const kind of ['needle', 'preview', 'bounce'] as const) grantFreeTool(run, kind);
    const before = [...run.freeToolQueue!];
    expect(applyEndlessTool(run, { tool: 'bounce', position: { x: 80, y: 490 }, angle: 0 })).toBe(false);
    expect(applyEndlessTool(run, { tool: 'sail' }, true)).toBe(true);
    expect(run.freeToolQueue).toEqual(before);
    expect(applyEndlessTool(run, { tool: 'needle' })).toBe(true);
    expect(run.freeToolQueue).toEqual(['preview', 'bounce']);
    expect(launchEndless(run, { x: 0, y: 0 })).toBe(false);
    expect(run.state.toolEffects).toMatchObject({ sail: true, needle: {} });
    expect(run.freeToolQueue).toEqual(['preview', 'bounce']);
  });

  function collectionCourse() {
    const run = createEndlessRun(0);
    grantFreeTool(run, 'needle');
    const kinds: ToolKind[] = ['sail', 'preview', 'bounce'];
    run.room = { ...run.room, gravity: 0, bumpers: [], hazards: [], barriers: [], switches: [],
      pickups: kinds.map((kind, index) => ({ id: `fixture-${index}`, kind, center: { x: 120 + index * 40, y: 300 }, radius: 4 })) };
    Object.assign(run.state, { phase: 'flying', position: { x: 80, y: 300 }, previousPosition: { x: 80, y: 300 }, velocity: { x: 24000, y: 0 } });
    return run;
  }

  test('multiple swept pickups preserve encounter order and report the replaced charge', () => {
    const run = collectionCourse();
    const events = stepEndless(run).filter((event) => event.type === 'pickup');
    expect(events.map((event) => event.kind)).toEqual(['sail', 'preview', 'bounce']);
    expect(events[2]).toMatchObject({ kind: 'bounce', replacedKind: 'needle' });
    expect(run.freeToolQueue).toEqual(['sail', 'preview', 'bounce']);
    expect(run.collectedPickupIds).toEqual(['fixture-0', 'fixture-1', 'fixture-2']);
    stepEndless(run);
    expect(run.freeToolQueue).toEqual(['sail', 'preview', 'bounce']);
  });

  test('FIFO pickup order is identical at 30, 60 and 120 FPS', () => {
    const outcomes = [30, 60, 120].map((fps) => {
      const run = collectionCourse(), clock = createLaunchClock(), events: LaunchEvent[] = [];
      for (let frame = 0; frame < fps / 10; frame++) advanceEndless(run, clock, 1 / fps, event => events.push(event));
      return { queue: run.freeToolQueue, inventory: run.inventory, pickups: events.filter(event => event.type === 'pickup') };
    });
    expect(outcomes[0]).toEqual(outcomes[1]);
    expect(outcomes[1]).toEqual(outcomes[2]);
  });

  test('revive never restores an evicted charge or an older queue, including spare-revive conversion', () => {
    const run = createEndlessRun(0);
    for (const kind of ['preview', 'revive', 'needle'] as const) grantFreeTool(run, kind);
    run.lastCatchSnapshot = captureEndlessWorld(run);
    expect(run.lastCatchSnapshot).not.toHaveProperty('freeToolQueue');
    grantFreeTool(run, 'sail');
    run.state.phase = 'failed';
    expect(reviveEndless(run, true)).toBe(true);
    expect(run.freeToolQueue).toEqual(['preview', 'needle', 'sail']);
    expect(run.inventory).toEqual({ ...emptyToolInventory(), preview: 1, needle: 1, sail: 1 });
    expect(grantFreeTool(run, 'bounce')).toBe('preview');
    expect(run.freeToolQueue).toEqual(['needle', 'sail', 'bounce']);
    expect(deserializeEndlessRun(serializeEndlessRun(run))).toEqual(run);
  });

  test('save/load retains order and resets only when starting a new run', () => {
    const run = createEndlessRun(0);
    for (const kind of ['sail', 'preview', 'needle'] as const) grantFreeTool(run, kind);
    const restored = deserializeEndlessRun(serializeEndlessRun(run))!;
    expect(restored.freeToolQueue).toEqual(['sail', 'preview', 'needle']);
    expect(grantFreeTool(restored, 'bounce')).toBe('sail');
    expect(run.freeToolQueue).toEqual(['sail', 'preview', 'needle']);
    expect(createEndlessRun(1).freeToolQueue).toEqual([]);
  });

  test.each(['missing queue', 'four charges', 'unknown kind', 'count mismatch', 'checkpoint queue'])('rejects a forged v6 save: %s', (invalid) => {
    const run = createEndlessRun(0);
    grantFreeTool(run, 'needle');
    const payload = JSON.parse(serializeEndlessRun(run));
    if (invalid === 'missing queue') delete payload.run.freeToolQueue;
    if (invalid === 'four charges') { payload.run.freeToolQueue = ['needle', 'needle', 'needle', 'needle']; payload.run.inventory.needle = 4; }
    if (invalid === 'unknown kind') payload.run.freeToolQueue = ['unknown'];
    if (invalid === 'count mismatch') payload.run.freeToolQueue = ['sail'];
    if (invalid === 'checkpoint queue') payload.run.lastCatchSnapshot.freeToolQueue = [];
    expect(deserializeEndlessRun(JSON.stringify(payload))).toBeNull();
  });

  test.each([1, 2, 3, 4, 5] as const)('historical v%i runs retain their uncapped inventory', (version) => {
    const run = createEndlessRun(0, version);
    for (let charge = 0; charge < 5; charge++) expect(grantFreeTool(run, 'preview')).toBeUndefined();
    expect(run.inventory.preview).toBe(5);
    expect(run.freeToolQueue).toBeUndefined();
    expect(deserializeEndlessRun(serializeEndlessRun(run))).toEqual(run);
  });
});
