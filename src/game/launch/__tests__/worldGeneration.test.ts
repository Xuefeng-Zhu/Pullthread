/** @jest-environment node */
import { describe, expect, test } from '@jest/globals';
import { advanceEndless, createWorldEndlessRun, launchEndless, nextEndlessTargets } from '../endless';
import { findTargetInput, replayNext, type RouteInput } from '../testing/routeSolver';
import { chooseWorldSection } from '../worldSections';
import type { SectionFamily } from '../sections';
import { createLaunchClock } from '../simulation';

describe('world mix progression', () => {
  test('after 100 catches the generator increases combinations without increasing mechanic strength', () => {
    const totals: number[] = [];
    for (const score of [80, 100]) {
      let mixed = 0;
      for (let seed = 0; seed < 12; seed++) {
        let family: SectionFamily | undefined;
        for (let index = 3; index < 303; index++) {
          const pattern = chooseWorldSection(seed, index, { min: 180, max: 180 }, family, score, [3, 3, 3, 3]);
          if (pattern.mechanics.length === 2) mixed++;
          expect(pattern.mechanics.length).toBeLessThanOrEqual(2);
          for (const pocket of pattern.pockets) if (pocket.motion) {
            expect(Math.abs(pocket.motion.amplitude)).toBe(22);
            expect(pocket.motion.periodTicks).toBe(480);
          }
          for (const bumper of pattern.bumpers) if (bumper.springSpeed) expect(bumper.springSpeed).toBe(650);
          for (const zone of pattern.windZones) expect(Math.abs(zone.accelerationX)).toBe(100);
          for (const hazard of pattern.hazards) if (hazard.visual === 'scissors') {
            expect(Math.abs(hazard.motion!.amplitude)).toBe(34);
            expect(hazard.motion!.periodTicks).toBe(600);
          }
          family = pattern.family;
        }
      }
      totals.push(mixed);
    }
    expect(totals[1]).toBeGreaterThan(totals[0] * 1.5);
  });

  test('all five worlds and later combinations produce matching outcomes at 30, 60 and 120 FPS', () => {
    const authored = createWorldEndlessRun(42);
    const mechanics = new Set<string>();
    const actions: { tick: number; pull: RouteInput['pull'] }[] = [];
    for (let index = 0; index < 112; index++) {
      const targets = nextEndlessTargets(authored);
      const input = findTargetInput(authored, targets[index % targets.length]);
      actions.push({ tick: authored.state.tick + input.waitTicks, pull: input.pull });
      replayNext(authored, input);
      authored.sectionProgress!.sections.forEach((section) => section.mechanics!.forEach((mechanic) => mechanics.add(mechanic)));
    }
    expect([...mechanics].sort()).toEqual(['fray', 'gate', 'scissors', 'spring', 'sway', 'wind']);
    for (const fps of [30, 60, 120]) {
      const run = createWorldEndlessRun(42);
      const clock = createLaunchClock();
      let index = 0;
      while (index < actions.length || run.state.phase === 'flying') {
        if (index < actions.length && run.state.tick === actions[index].tick) {
          expect(launchEndless(run, actions[index].pull)).toBe(true);
          index++;
        }
        const remaining = index < actions.length ? actions[index].tick - run.state.tick : 120 / fps;
        advanceEndless(run, clock, Math.min(120 / fps, remaining) / 120);
        if (run.state.phase === 'failed') throw new Error(`Unexpected failure at ${run.state.tick}, FPS ${fps}`);
      }
      expect(run.pocketsCaught).toBe(authored.pocketsCaught);
      expect(run.state.pocketId).toBe(authored.state.pocketId);
      expect(run.inventory).toEqual(authored.inventory);
      expect(run.sectionProgress).toEqual(authored.sectionProgress);
      expect(run.room.pockets).toEqual(authored.room.pockets);
      expect(run.room.windZones).toEqual(authored.room.windZones);
      expect(run.sectionProgress!.introductions).toEqual([3, 3, 3, 3]);
    }
  }, 30000);
});
