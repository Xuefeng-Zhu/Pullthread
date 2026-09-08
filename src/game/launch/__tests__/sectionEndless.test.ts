/** @jest-environment node */
import { describe, expect, test } from '@jest/globals';
import { advanceEndless, createWorldEndlessRun, createLegacyEndlessRun, launchEndless, nextEndlessTargets, type EndlessRun } from '../endless';
import { cloneEndlessRun, deserializeEndlessRun, serializeEndlessRun } from '../snapshots';
import { createLaunchClock } from '../simulation';
import { ballisticPull, findNextInput, findTargetInput, replayNext, type RouteInput } from '../testing/routeSolver';
import { predictEndlessLaunch } from '../prediction';

function take(run: EndlessRun, target: string): RouteInput {
  const input = findTargetInput(run, target);
  replayNext(run, input);
  expect(run.state.phase).toBe('held');
  expect(run.state.pocketId).toBe(target);
  return input;
}

describe('branching endless climb', () => {
  test.each([0, 1, 2, 7, 42, 999])('seed %i keeps both opening catches forgiving with complete future sections', (seed) => {
    const run = createWorldEndlessRun(seed);
    for (let opening = 1; opening <= 2; opening++) {
      const target = run.nextPocketId;
      const pull = opening === 1 ? ballisticPull(run, 72)! : { x: -5, y: 77 };
      for (const dx of [-5, 0, 5]) for (const dy of [-5, 0, 5]) {
        const attempt = cloneEndlessRun(run);
        replayNext(attempt, { waitTicks: 0, pull: { x: pull.x + dx, y: pull.y + dy } });
        expect({ phase: attempt.state.phase, pocket: attempt.state.pocketId }).toEqual({ phase: 'held', pocket: target });
      }
      replayNext(run, { pull, waitTicks: 0 });
    }
    expect(nextEndlessTargets(run)).toHaveLength(2);
  });

  test.each(Array.from({ length: 16 }, (_, seed) => seed))('seed %i supports 128 catches on both branches with bounded snapshots', (seed) => {
    const run = createWorldEndlessRun(seed);
    const families = new Set<string>();
    for (let count = 0; count < 128; count++) {
      const targets = nextEndlessTargets(run);
      expect(targets.length).toBeGreaterThan(0);
      // Prove every currently offered route in the actual assembled world before choosing.
      for (const target of targets) take(cloneEndlessRun(run), target);
      const target = targets[(count + seed) % targets.length];
      take(run, target);
      expect(run.pocketsCaught).toBe(count + 1);
      expect(run.room.pockets.length).toBeLessThanOrEqual(32);
      expect(run.sectionProgress!.sections.length).toBeLessThanOrEqual(5);
      expect(run.collectedPickupIds.length).toBeLessThanOrEqual(6);
      expect(deserializeEndlessRun(serializeEndlessRun(run))).toEqual(run);
      run.sectionProgress!.sections.forEach((section) => families.add(section.family));
      if (run.pocketsCaught < 12) expect(run.room.pockets.some((pocket) => pocket.frayTicks)).toBe(false);
    }
    expect([...families].sort()).toEqual(['cushion', 'fork', 'fray', 'gate']);
  });

  test('route prediction uses complete branches without mutating tools or the source world', () => {
    const run = createWorldEndlessRun(7);
    for (let catchIndex = 0; catchIndex < 32; catchIndex++) {
      for (const target of nextEndlessTargets(run)) {
        const input = findTargetInput(run, target);
        const ready = cloneEndlessRun(run);
        if (input.waitTicks) {
          const clock = createLaunchClock();
          for (let tick = 0; tick < input.waitTicks; tick++) advanceEndless(ready, clock, 1 / 120);
        }
        const before = serializeEndlessRun(ready);
        expect(predictEndlessLaunch(ready, input.pull)).toMatchObject({ outcome: 'catch', pocketId: target });
        expect(serializeEndlessRun(ready)).toBe(before);
      }
      take(run, nextEndlessTargets(run)[catchIndex % nextEndlessTargets(run).length]);
    }
  });

  test('same actions retain matching outcomes at 30, 60 and 120 rendering FPS', () => {
    const authored = createWorldEndlessRun(42);
    const actions: { tick: number; pull: RouteInput['pull']; target: string }[] = [];
    for (let index = 0; index < 36; index++) {
      const target = nextEndlessTargets(authored)[index % nextEndlessTargets(authored).length];
      const input = findTargetInput(authored, target);
      actions.push({ tick: authored.state.tick + input.waitTicks, pull: input.pull, target });
      replayNext(authored, input);
    }
    for (const fps of [30, 60, 120]) {
      const run = createWorldEndlessRun(42);
      const clock = createLaunchClock();
      let index = 0;
      // Split frames at input boundaries; ticks, not display frames, own actions.
      while (index < actions.length || run.state.phase === 'flying') {
        if (index < actions.length && run.state.tick === actions[index].tick) {
          expect(launchEndless(run, actions[index].pull)).toBe(true);
          index++;
        }
        const remaining = index < actions.length ? actions[index].tick - run.state.tick : 120 / fps;
        advanceEndless(run, clock, Math.min(120 / fps, remaining) / 120);
        if (run.state.phase === 'failed') throw new Error(`Unexpected failure at ${run.state.tick} fps ${fps}`);
      }
      expect(run.state.tick).toBeGreaterThanOrEqual(authored.state.tick);
      expect(run.pocketsCaught).toBe(authored.pocketsCaught);
      expect(run.state.pocketId).toBe(authored.state.pocketId);
      expect(run.inventory).toEqual(authored.inventory);
      expect(run.sectionProgress).toEqual(authored.sectionProgress);
    }
  });

  test('historical version-one snapshots keep extending their original generator after loading', () => {
    const historical = createLegacyEndlessRun(77);
    const json = JSON.parse(serializeEndlessRun(historical));
    delete json.run.generationVersion;
    delete json.run.lastCatchSnapshot.generationVersion;
    const restored = deserializeEndlessRun(JSON.stringify(json))!;
    expect(restored).not.toBeNull();
    for (let index = 0; index < 32; index++) {
      const input = findNextInput(historical);
      replayNext(historical, input);
      replayNext(restored, input);
      expect(restored.room).toEqual(historical.room);
      expect(restored.state).toEqual(historical.state);
      expect(restored.nextPocketId).toBe(`endless-${index + 2}`);
    }
    expect(JSON.parse(serializeEndlessRun(restored)).version).toBe(1);
    expect(restored.sectionProgress).toBeUndefined();
  });
});
