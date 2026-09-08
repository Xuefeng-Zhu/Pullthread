/** @jest-environment node */
import { describe, expect, test } from '@jest/globals';

import { createEndlessRun, nextEndlessTargets, reviveEndless, stepEndless, type EndlessRun } from '../endless';
import { INTERACTIVE_MECHANICS } from '../interactiveProgression';
import { cloneEndlessRun, deserializeEndlessRun, serializeEndlessRun } from '../snapshots';
import { pocketPosition } from '../simulation';

function catchNext(run: EndlessRun): void {
  const targets = nextEndlessTargets(run);
  const pocket = run.room.pockets.find((candidate) => targets.includes(candidate.id) && candidate.route !== 'reward')
    ?? run.room.pockets.find((candidate) => targets.includes(candidate.id))!;
  const center = pocketPosition(pocket, run.state.tick + 1);
  Object.assign(run.state, { phase: 'flying', position: { x: center.x, y: center.y - 2 },
    velocity: { x: 0, y: 480 }, sourcePocketImmune: false });
  expect(stepEndless(run)).toContainEqual({ type: 'catch', id: pocket.id, tick: run.state.tick });
}

function until(predicate: (run: EndlessRun) => boolean, version: 1 | 2 | 3 | 4 = 4): EndlessRun {
  const run = createEndlessRun(0, version);
  for (let count = 0; count < 160 && !predicate(run); count += 1) catchNext(run);
  expect(predicate(run)).toBe(true);
  return run;
}

/** Corrupt external JSON is deliberately outside the static type contract. */
function corrupt(run: EndlessRun, mutate: (world: any) => void, checkpoint = false): string {
  const payload: any = JSON.parse(serializeEndlessRun(run));
  mutate(checkpoint ? payload.run.lastCatchSnapshot : payload.run);
  return JSON.stringify(payload);
}

function rejectBoth(run: EndlessRun, mutations: ((world: any) => void)[]): void {
  for (const mutate of mutations) for (const checkpoint of [false, true]) {
    expect(deserializeEndlessRun(corrupt(run, mutate, checkpoint))).toBeNull();
  }
}

describe('version-four interactive world snapshots', () => {
  test('all four new introductions survive save/load, cloning and bounded section pruning', () => {
    for (const seed of [0, 7]) {
      let run = createEndlessRun(seed);
      const control = cloneEndlessRun(run);
      const lessons = new Map<string, string>();
      for (let count = 0; count <= 160; count += 1) {
        expect(run.generationVersion).toBe(4);
        expect(JSON.parse(serializeEndlessRun(run)).version).toBe(4);
        expect(deserializeEndlessRun(serializeEndlessRun(run))).toEqual(run);
        for (const section of run.sectionProgress!.sections) if (section.introduction) lessons.set(section.id, section.introduction);
        expect(run.room.barriers!.length).toBeLessThanOrEqual(64);
        expect(run.room.switches!.length).toBeLessThanOrEqual(64);
        expect(run.room.windZones ?? []).toEqual([]);
        expect(run.room.pockets.some((pocket) => pocket.motion)).toBe(false);
        expect(run.room.bumpers.some((bumper) => bumper.springSpeed)).toBe(false);
        expect(run.room.hazards.some((hazard) => hazard.visual === 'scissors')).toBe(false);
        if (count % 7 === 0 || count % 20 === 19) {
          run = deserializeEndlessRun(serializeEndlessRun(cloneEndlessRun(run)))!;
          expect(run).toEqual(control);
        }
        if (count < 160) { catchNext(run); catchNext(control); }
      }
      expect(run.sectionProgress!.introductions).toEqual([3, 3, 3, 3]);
      for (const mechanic of INTERACTIVE_MECHANICS) expect([...lessons.values()].filter((value) => value === mechanic)).toHaveLength(3);
      expect(lessons.size).toBe(12);
    }
  });

  test('rejects missing v4 ownership and state ledgers or old mechanics in either saved world', () => {
    rejectBoth(createEndlessRun(0), [
      (world) => { delete world.room.barriers; },
      (world) => { delete world.room.switches; },
      (world) => { delete world.state.brokenBarrierIds; },
      (world) => { delete world.state.activatedSwitchIds; },
      (world) => { delete world.sectionProgress.sections[0].barrierIds; },
      (world) => { delete world.sectionProgress.sections[0].switchIds; },
      (world) => { world.sectionProgress.sections[0].mechanics = ['sway']; },
      (world) => { world.sectionProgress.sections[0].mechanics = ['hoop']; },
      (world) => { world.sectionProgress.introductions = [1, 0, 0, 0]; },
      (world) => { world.state.brokenBarrierIds = ['unowned']; },
      (world) => { world.state.activatedSwitchIds = ['unowned']; },
      (world) => { world.room.windZones = [{ id: 'wind', x: 10, y: 10, width: 100, height: 150, accelerationX: 100 }]; },
    ]);
  });

  test('persistent interaction ledgers stay bounded and are pruned with their owning sections', () => {
    const run = createEndlessRun(31);
    const observedBroken = new Set<string>();
    const observedSwitches = new Set<string>();
    for (let count = 0; count < 200; count += 1) {
      // Exercise journal retention with every currently owned interaction activated.
      // Contact detection itself is verified in the physics suite.
      run.state.brokenBarrierIds = run.room.barriers!.filter((barrier) => barrier.kind === 'tearable').map((barrier) => barrier.id);
      run.state.activatedSwitchIds = run.room.switches!.map((button) => button.id);
      run.state.brokenBarrierIds.forEach((id) => observedBroken.add(id));
      run.state.activatedSwitchIds.forEach((id) => observedSwitches.add(id));
      expect(deserializeEndlessRun(serializeEndlessRun(run))).toEqual(run);
      catchNext(run);
      expect(run.state.brokenBarrierIds!.every((id) => run.room.barriers!.some((barrier) => barrier.id === id))).toBe(true);
      expect(run.state.activatedSwitchIds!.every((id) => run.room.switches!.some((button) => button.id === id))).toBe(true);
      expect(run.state.brokenBarrierIds!.length).toBeLessThanOrEqual(64);
      expect(run.state.activatedSwitchIds!.length).toBeLessThanOrEqual(64);
    }
    expect(observedBroken.size).toBeGreaterThan(3);
    expect(observedSwitches.size).toBeGreaterThan(3);
    expect([...observedBroken].some((id) => !run.state.brokenBarrierIds!.includes(id))).toBe(true);
    expect([...observedSwitches].some((id) => !run.state.activatedSwitchIds!.includes(id))).toBe(true);
  });

  test('validates rectangle geometry, shutter phases, owned identities and breakable kinds', () => {
    const run = until((candidate) => !!candidate.room.barriers?.length);
    rejectBoth(run, [
      (world) => { world.room.barriers[0].x = null; },
      (world) => { world.room.barriers[0].y = '0'; },
      (world) => { world.room.barriers[0].width = 0; },
      (world) => { world.room.barriers[0].height = -1; },
      (world) => { world.room.barriers[0].kind = 'invisible'; },
      (world) => { world.room.barriers[0].phaseTicks = -1; },
      (world) => { world.room.barriers[0].phaseTicks = 480; },
      (world) => { world.room.barriers[0].phaseTicks = 0.5; },
      (world) => { world.room.barriers.push({ ...world.room.barriers[0] }); },
      (world) => { world.room.barriers[0].id = 'orphan-barrier'; },
      (world) => { world.sectionProgress.sections.forEach((section: any) => { section.barrierIds = []; }); },
      (world) => { world.state.brokenBarrierIds = [world.room.barriers[0].id]; },
    ]);
  });

  test('requires bounded orbital motion and version-matched hoop ownership', () => {
    const run = until((candidate) => candidate.room.pockets.some((pocket) => pocket.orbit));
    const mutations: ((world: any) => void)[] = [];
    for (const radius of [0, -1, 81, null]) mutations.push((world) => {
      world.room.pockets.find((pocket: any) => pocket.orbit).orbit.radius = radius;
    });
    for (const periodTicks of [0, 119, null]) mutations.push((world) => {
      world.room.pockets.find((pocket: any) => pocket.orbit).orbit.periodTicks = periodTicks;
    });
    mutations.push(
      (world) => { world.room.pockets.find((pocket: any) => pocket.orbit).orbit.direction = 0; },
      (world) => { world.room.pockets.find((pocket: any) => pocket.orbit).orbit.phaseTicks = null; },
      (world) => {
        const pocket = world.room.pockets.find((pocket: any) => pocket.orbit);
        pocket.motion = { amplitude: 22, periodTicks: 480, phaseTicks: 0 };
      },
      (world) => {
        const pocket = world.room.pockets.find((pocket: any) => pocket.orbit);
        const section = world.sectionProgress.sections.find((section: any) => section.id === pocket.sectionId);
        section.mechanics = [];
        delete section.introduction;
      },
    );
    rejectBoth(run, mutations);
  });

  test('requires unique same-section door and pocket links for every switch', () => {
    const run = until((candidate) => !!candidate.room.switches?.length);
    rejectBoth(run, [
      (world) => { world.room.switches[0].doorIds = []; },
      (world) => { world.room.switches[0].doorIds.push(world.room.switches[0].doorIds[0]); },
      (world) => { world.room.switches[0].doorIds = ['missing-door']; },
      (world) => { world.room.switches[0].pocketId = 'missing-pocket'; },
      (world) => { world.room.switches[0].pocketId = world.room.pockets.find((pocket: any) => !world.room.switches[0].id.startsWith(`${pocket.sectionId}-`)).id; },
      (world) => { world.room.switches[0].radius = 0; },
      (world) => { world.room.switches[0].center.x = null; },
      (world) => { world.room.switches.push({ ...world.room.switches[0] }); },
      (world) => { world.room.switches[0].id = world.room.barriers[0].id; },
      (world) => { world.room.barriers.find((barrier: any) => barrier.id === world.room.switches[0].doorIds[0]).kind = 'solid'; },
      (world) => { world.sectionProgress.sections.forEach((section: any) => { section.switchIds = []; }); },
    ]);
    const clone = cloneEndlessRun(run);
    (clone.room.switches![0].doorIds as string[]).push('cloned-only-door');
    clone.state.activatedSwitchIds!.push(clone.room.switches![0].id);
    expect(run.state.activatedSwitchIds).toEqual([]);
    expect(run.room.switches![0].doorIds).not.toContain('cloned-only-door');
  });

  test.each(['tear', 'switch'] as const)('%s effects from a failed attempt persist in saves, while revive restores the exact catch state', (mechanic) => {
    const run = until((candidate) => mechanic === 'tear'
      ? candidate.room.barriers!.some((barrier) => barrier.kind === 'tearable') : !!candidate.room.switches?.length);
    const field = mechanic === 'tear' ? 'brokenBarrierIds' : 'activatedSwitchIds';
    const id = mechanic === 'tear' ? run.room.barriers!.find((barrier) => barrier.kind === 'tearable')!.id : run.room.switches![0].id;
    const checkpoint = cloneEndlessRun(run).lastCatchSnapshot!;
    // Represent the persistent effect of a contact after the saved catch.
    run.state[field]!.push(id);
    Object.assign(run.state, { phase: 'flying', position: { x: 180, y: run.room.bounds.bottom! + 20 },
      velocity: { x: 0, y: 40 }, sourcePocketImmune: false });
    expect(stepEndless(run)).toContainEqual(expect.objectContaining({ type: 'fail' }));
    const restored = deserializeEndlessRun(serializeEndlessRun(run))!;
    expect(restored).toEqual(run);
    expect(restored.state[field]).toContain(id);
    expect(restored.lastCatchSnapshot!.state[field]).not.toContain(id);
    expect(reviveEndless(restored, true)).toBe(true);
    expect(restored.state[field]).toEqual(checkpoint.state[field]);
    expect(restored.sectionProgress).toEqual(checkpoint.sectionProgress);
    expect(restored.room).toEqual(checkpoint.room);
    expect(deserializeEndlessRun(serializeEndlessRun(restored))).toEqual(restored);
    rejectBoth(run, [(world) => { world.state[field] = [id, id]; }]);
  });

  test.each([1, 2, 3] as const)('historical v%i journals keep their original generation and reject new physics or state fields', (version) => {
    const run = createEndlessRun(0, version);
    for (let count = 0; count < 100; count += 1) {
      const restored = deserializeEndlessRun(serializeEndlessRun(run))!;
      expect(restored).toEqual(run);
      catchNext(run);
      catchNext(restored);
      expect(restored).toEqual(run);
      expect(restored.generationVersion).toBe(version);
    }
    rejectBoth(run, [
      (world) => { world.room.barriers = []; },
      (world) => { world.room.switches = []; },
      (world) => { world.state.brokenBarrierIds = []; },
      (world) => { world.state.activatedSwitchIds = []; },
      (world) => { world.room.pockets[0].orbit = { radius: 48, periodTicks: 720, phaseTicks: 0 }; },
      (world) => {
        world.sectionProgress ??= { sections: [{}] };
        world.sectionProgress.sections[0].barrierIds = [];
      },
      (world) => {
        world.sectionProgress ??= { sections: [{}] };
        world.sectionProgress.sections[0].switchIds = [];
      },
    ]);
  });
});
