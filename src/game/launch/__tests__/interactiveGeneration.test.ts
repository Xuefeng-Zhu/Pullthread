/** @jest-environment node */
import { describe, expect, test } from '@jest/globals';
import { advanceEndless, createEndlessRun, launchEndless, nextEndlessTargets } from '../endless';
import { cloneEndlessRun, deserializeEndlessRun, serializeEndlessRun } from '../snapshots';
import { findTargetInput, replayNext, type RouteInput } from '../testing/routeSolver';
import { createLaunchClock } from '../simulation';

function flatten(input: RouteInput): RouteInput[] {
  return [...(input.setup ?? []).flatMap(flatten), { pull: input.pull, waitTicks: input.waitTicks }];
}

describe('assembled interactive generation', () => {
  test.each([0, 7, 42, 73])('seed%i validates every offered branch for128 catches with bounded persistent obstacles', (seed) => {
    const run = createEndlessRun(seed);
    const observed = new Set<string>();
    let breaks = 0;
    let switches = 0;
    for (let count = 0; count < 128; count++) {
      const targets = nextEndlessTargets(run);
      for (const target of targets) {
        const alternative = cloneEndlessRun(run);
        replayNext(alternative, findTargetInput(alternative, target));
        expect(alternative.state.pocketId).toBe(target);
        expect(alternative.pocketsCaught).toBe(count + 1);
      }
      const target = targets[(count + seed) % targets.length];
      const events = replayNext(run, findTargetInput(run, target));
      breaks += events.filter((event) => event.type === 'break').length;
      switches += events.filter((event) => event.type === 'switch').length;
      expect(run.pocketsCaught).toBe(count + 1);
      expect(run.room.pockets.length).toBeLessThanOrEqual(32);
      expect(run.room.barriers!.length).toBeLessThanOrEqual(30);
      expect(run.room.switches!.length).toBeLessThanOrEqual(10);
      expect(run.sectionProgress!.sections.length).toBeLessThanOrEqual(5);
      expect(deserializeEndlessRun(serializeEndlessRun(run))).toEqual(run);
      for (const section of run.sectionProgress!.sections) section.mechanics!.forEach((mechanic) => observed.add(mechanic));
      for (const id of run.state.brokenBarrierIds!) expect(run.room.barriers!.some((barrier) => barrier.id === id && barrier.kind === 'tearable')).toBe(true);
      for (const id of run.state.activatedSwitchIds!) expect(run.room.switches!.some((sensor) => sensor.id === id)).toBe(true);
    }
    for (const mechanic of ['hoop', 'tear', 'switch', 'shutter']) expect(observed).toContain(mechanic);
    if (seed === 42) expect(observed).toContain('fray');
    expect(breaks).toBeGreaterThan(0);
    expect(switches).toBeGreaterThan(0);
    expect(run.sectionProgress!.introductions).toEqual([3, 3, 3, 3]);
  }, 60000);

  test('setup shots, moving launches and state changes replay equally at30/60/120FPS', () => {
    const authored = createEndlessRun(42);
    const actions: { tick: number; pull: RouteInput['pull'] }[] = [];
    for (let count = 0; count < 108; count++) {
      const targets = nextEndlessTargets(authored);
      const input = findTargetInput(authored, targets[count % targets.length]);
      for (const shot of flatten(input)) {
        actions.push({ tick: authored.state.tick + shot.waitTicks, pull: shot.pull });
        replayNext(authored, shot);
      }
    }
    expect(actions.length).toBeGreaterThan(108);
    for (const fps of [30, 60, 120]) {
      const run = createEndlessRun(42);
      const clock = createLaunchClock();
      let index = 0;
      while (index < actions.length || run.state.phase === 'flying') {
        if (index < actions.length && run.state.tick === actions[index].tick) {
          expect(launchEndless(run, actions[index].pull)).toBe(true);
          index++;
        }
        const remaining = index < actions.length ? actions[index].tick - run.state.tick : 120 / fps;
        advanceEndless(run, clock, Math.min(120 / fps, remaining) / 120);
        if (run.state.phase === 'failed') throw new Error(`Unexpected failure at tick${run.state.tick} FPS${fps}`);
      }
      expect(run.pocketsCaught).toBe(108);
      expect(run.sectionProgress).toEqual(authored.sectionProgress);
      expect(run.room.pockets).toEqual(authored.room.pockets);
      expect(run.room.barriers).toEqual(authored.room.barriers);
      expect(run.state.brokenBarrierIds).toEqual(authored.state.brokenBarrierIds);
      expect(run.state.activatedSwitchIds).toEqual(authored.state.activatedSwitchIds);
      expect(run.inventory).toEqual(authored.inventory);
    }
  }, 60000);
});
