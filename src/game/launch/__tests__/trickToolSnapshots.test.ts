/** @jest-environment node */
import { describe, expect, it } from '@jest/globals';
import { CREATIVE_TOOLS } from '../../../commerce/contracts';
import { createEndlessRun } from '../endless';
import { captureEndlessWorld, deserializeEndlessRun, serializeEndlessRun } from '../snapshots';

function editSnapshot(edit: (payload: any) => void): string {
  const payload = JSON.parse(serializeEndlessRun(createEndlessRun(71, 5)));
  edit(payload);
  return JSON.stringify(payload);
}

describe('version-five trick-tool snapshots', () => {
  it('round-trips a new run with all nine inventory counts', () => {
    const run = createEndlessRun(71, 5);
    for (const kind of CREATIVE_TOOLS) run.inventory[kind] = 2;
    expect(deserializeEndlessRun(serializeEndlessRun(run))).toEqual(run);
  });

  it.each([1, 2, 3, 4] as const)('normalizes old v%i inventories without changing world rules', (version) => {
    const run = createEndlessRun(71, version);
    const payload = JSON.parse(serializeEndlessRun(run));
    for (const kind of CREATIVE_TOOLS) delete payload.run.inventory[kind];
    const restored = deserializeEndlessRun(JSON.stringify(payload));
    expect(restored?.generationVersion ?? 1).toBe(version);
    expect(restored?.room).toEqual(run.room);
    for (const kind of CREATIVE_TOOLS) expect(restored?.inventory[kind]).toBe(0);
  });

  it('preserves an armed combination independently of the revive checkpoint', () => {
    const run = createEndlessRun(71, 5);
    run.state.toolEffects = {
      bounce: { position: { x: 160, y: 200 }, angle: 35, spent: false },
      velcro: { targetId: 'endless-1' }, sail: true, needle: {},
    };
    const restored = deserializeEndlessRun(serializeEndlessRun(run));
    expect(restored?.state.toolEffects).toEqual(run.state.toolEffects);
    expect(restored?.lastCatchSnapshot?.state.toolEffects).toBeUndefined();
    restored!.state.toolEffects!.bounce!.spent = true;
    expect(run.state.toolEffects.bounce?.spent).toBe(false);
  });

  it('retains a stitched checkpoint and a spent source without adding an authored pocket', () => {
    const run = createEndlessRun(71, 5);
    run.state.stitchedPocket = {
      pocket: { id: 'tool-stitch-0', center: { x: 180, y: 100 }, width: 80, kind: 'checkpoint' },
      originPocketId: run.state.pocketId, spent: false,
    };
    run.state.pocketId = 'tool-stitch-0';
    run.state.position = { x: 180, y: 100 };
    run.state.previousPosition = { ...run.state.position };
    run.state.checkpoint = { ...run.state.checkpoint, pocketId: run.state.pocketId };
    run.lastCatchSnapshot = captureEndlessWorld(run);
    expect(deserializeEndlessRun(serializeEndlessRun(run))?.state.stitchedPocket).toEqual(run.state.stitchedPocket);
    run.state.phase = 'flying';
    run.state.stitchedPocket.spent = true;
    const restored = deserializeEndlessRun(serializeEndlessRun(run));
    expect(restored?.state.stitchedPocket?.spent).toBe(true);
    expect(restored?.lastCatchSnapshot?.state.stitchedPocket?.spent).toBe(false);
    expect(restored?.room.pockets.some((pocket) => pocket.id === 'tool-stitch-0')).toBe(false);
    expect(restored?.pocketsCaught).toBe(0);
  });

  it.each([
    ['missing v5 inventory', (p: any) => { delete p.run.inventory.bounce; }],
    ['negative inventory', (p: any) => { p.run.inventory.needle = -1; }],
    ['unknown inventory', (p: any) => { p.run.inventory.unknown = 1; }],
    ['fractional placement', (p: any) => { p.run.state.toolEffects = { bounce: { position: { x: 100.1, y: 50 }, angle: 0, spent: false } }; }],
    ['invalid rotation', (p: any) => { p.run.state.toolEffects = { bounce: { position: { x: 100, y: 50 }, angle: 180, spent: false } }; }],
    ['nonexistent target', (p: any) => { p.run.state.toolEffects = { velcro: { targetId: 'missing' } }; }],
    ['nonmoving pin', (p: any) => { p.run.state.toolEffects = { pin: { targetId: 'endless-1', startedTick: 0 } }; }],
    ['unknown effect', (p: any) => { p.run.state.toolEffects = { immunity: true }; }],
    ['foreign phase offset', (p: any) => { p.run.state.toolPhaseOffsets = { missing: 0 }; }],
    ['spent effect in checkpoint', (p: any) => { p.run.lastCatchSnapshot.state.toolEffects = { sail: true }; }],
  ])('rejects %s', (_name, mutate) => {
    expect(deserializeEndlessRun(editSnapshot(mutate))).toBeNull();
  });

  it('rejects new effects or nonzero new charges in historical saves', () => {
    const payload = JSON.parse(serializeEndlessRun(createEndlessRun(71, 4)));
    payload.run.state.toolEffects = { sail: true };
    expect(deserializeEndlessRun(JSON.stringify(payload))).toBeNull();
    delete payload.run.state.toolEffects;
    payload.run.inventory.sail = 1;
    expect(deserializeEndlessRun(JSON.stringify(payload))).toBeNull();
  });
});
