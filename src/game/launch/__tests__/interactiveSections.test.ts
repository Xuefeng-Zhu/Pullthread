/** @jest-environment node */
import { describe, expect, test } from '@jest/globals';
import { INTERACTIVE_SECTION_PATTERNS, INTERACTIVE_CORRIDORS, INTERACTIVE_LESSONS, INTERACTIVE_COURSES,
  INTERACTIVE_COMBINATIONS, chooseInteractiveSection, mirrorInteractiveSection } from '../interactiveSections';
import { INTERACTIVE_MECHANICS, obstacleBudget } from '../interactiveProgression';
import { assembleSections, flySectionInput, heldAt, sectionBallisticPull, solveSectionEdge } from '../testing/sectionSolver';
import { pocketPosition, stepLaunch } from '../simulation';
import type { LaunchEvent } from '../types';

const patterns = INTERACTIVE_SECTION_PATTERNS.flatMap((pattern) => [pattern, mirrorInteractiveSection(pattern)]);

describe('interactive authored sections', () => {
  test('contains three corridors, three lessons and courses per mechanic, and every pair', () => {
    expect(INTERACTIVE_CORRIDORS).toHaveLength(3);
    expect(INTERACTIVE_LESSONS).toHaveLength(12);
    expect(INTERACTIVE_COURSES).toHaveLength(12);
    expect(INTERACTIVE_COMBINATIONS).toHaveLength(6);
  });

  test('all physical obstacles clear the complete pull envelope, including every orbit phase', () => {
    for (const pattern of patterns) {
      const { room } = assembleSections([pattern, INTERACTIVE_CORRIDORS[0]]);
      for (const pocket of room.pockets) {
        const center = pocket.center;
        for (const obstacle of room.barriers!) {
          const dx = Math.max(obstacle.x - center.x, 0, center.x - obstacle.x - obstacle.width);
          const dy = Math.max(obstacle.y - center.y, 0, center.y - obstacle.y - obstacle.height);
          const clearance = Math.hypot(dx, dy) - (pocket.orbit?.radius ?? 0);
          if (clearance < 110) throw new Error(`${pattern.id} ${pocket.id} ${obstacle.id} clearance${clearance}`);
        }
      }
    }
  });

  test('mirrored hoops reverse angular motion while preserving their vertical path', () => {
    for (const pattern of INTERACTIVE_SECTION_PATTERNS) {
      const mirrored = mirrorInteractiveSection(pattern);
      for (let index = 0; index < pattern.pockets.length; index++) for (const tick of [0, 117, 360, 641]) {
        const from = pocketPosition(pattern.pockets[index], tick);
        const to = pocketPosition(mirrored.pockets[index], tick);
        expect(to.x).toBeCloseTo(360 - from.x, 8);
        expect(to.y).toBeCloseTo(from.y, 8);
      }
    }
  });

  test('density and ordinary selection follow score instead of height or section number', () => {
    for (const score of [0, 5, 6, 19, 20, 40, 60, 80, 100, 240]) {
      const [minimum, maximum] = obstacleBudget(score);
      const observed = new Set<string>();
      let combinations = 0;
      for (let index = 0; index < 600; index++) {
        const pattern = chooseInteractiveSection(73, index, { min: 180, max: 180 }, undefined, score, [3, 3, 3, 3]);
        expect(pattern.barriers.length).toBeGreaterThanOrEqual(minimum);
        expect(pattern.barriers.length).toBeLessThanOrEqual(maximum);
        expect(pattern).toEqual(chooseInteractiveSection(73, index, { min: 180, max: 180 }, undefined, score, [3, 3, 3, 3]));
        if (pattern.mechanics.length === 2) combinations++;
        if (pattern.id.startsWith('cloth-corridor')) observed.add(pattern.id.replace('-mirror', '').replace('-warmup', ''));
        pattern.switches.forEach((sensor) => sensor.doorIds.forEach((id) => expect(pattern.barriers.some((barrier) => barrier.id === id)).toBe(true)));
      }
      expect(observed.size).toBe(3);
      if (score >= 100) expect(combinations / 600).toBeGreaterThan(0.6);
    }
  });

  test('exactly three optional lessons precede ordinary use of each unlocked mechanic', () => {
    for (let stage = 1; stage <= 4; stage++) {
      const introductions = [0, 0, 0, 0].map((_, index) => index < stage - 1 ? 3 : 0);
      for (let lesson = 0; lesson < 3; lesson++) {
        const pattern = chooseInteractiveSection(8, lesson + 10, { min: 180, max: 180 }, undefined, stage * 20, introductions);
        expect(pattern.introduction).toBe(INTERACTIVE_MECHANICS[stage - 1]);
        expect(pattern.mechanics).toEqual([pattern.introduction]);
        introductions[stage - 1]++;
      }
      expect(chooseInteractiveSection(8, 18, { min: 180, max: 180 }, undefined, stage * 20, introductions).introduction).toBeUndefined();
    }
  });

  test.each(patterns.map((pattern) => [pattern.id, pattern] as const))('%s completes both full branch sequences with the actual interaction and recovery', (_id, pattern) => {
    const { room } = assembleSections([INTERACTIVE_CORRIDORS[0], pattern, INTERACTIVE_CORRIDORS[2]]);
    for (const side of ['left', 'right']) {
      let state = heldAt(room, '0:rest', 173);
      const events: LaunchEvent[] = [];
      for (const target of [`1:${side}`, `1:${side}-upper`, '1:rest']) {
        const input = solveSectionEdge(room, state, target, { perturbation: 0 });
        const result = flySectionInput(room, state, input);
        state = result.state;
        events.push(...result.events);
        expect(state.pocketId).toBe(target);
        if (target === '1:right' && pattern.mechanics.includes('hoop')) {
          const before = { ...state.position };
          for (let aiming = 0; aiming < 24; aiming++) stepLaunch(room, state);
          expect(state.position).not.toEqual(before);
          expect(room.pockets.find((pocket) => pocket.id === target)!.orbit).toBeDefined();
        }
      }
      const obstacle = room.barriers!.find((value) => value.id === `1:${side}-obstacle`);
      if (obstacle?.kind === 'tearable') {
        expect(state.brokenBarrierIds).toContain(obstacle.id);
        expect(events.some((event) => event.type === 'break' && event.id === obstacle.id)).toBe(true);
      }
      if (obstacle?.kind === 'door') {
        const sensor = room.switches!.find((value) => value.doorIds.includes(obstacle.id))!;
        expect(state.activatedSwitchIds).toContain(sensor.id);
        expect(events.some((event) => event.type === 'switch' && event.id === sensor.id)).toBe(true);
      }
    }
  }, 30000);

  test.each(patterns.filter((pattern) => pattern.mechanics.includes('hoop') || pattern.mechanics.includes('shutter'))
    .map((pattern) => [pattern.id, pattern] as const))('%s remains completable at varied orbit and shutter arrival phases', (_id, pattern) => {
    const { room } = assembleSections([pattern]);
    for (const tick of [0, 180, 360, 540]) for (const side of ['left', 'right']) {
      let state = heldAt(room, 'entry', tick);
      for (const target of [`0:${side}`, `0:${side}-upper`, '0:rest']) {
        const input = solveSectionEdge(room, state, target, { perturbation: 0 });
        state = flySectionInput(room, state, input).state;
        expect(state.pocketId).toBe(target);
      }
    }
  }, 30000);

  test.each(INTERACTIVE_COURSES.filter((pattern) => pattern.mechanics.includes('shutter'))
    .flatMap((pattern) => [pattern, mirrorInteractiveSection(pattern)]).map((pattern) => [pattern.id, pattern] as const))
  ('%s makes the same aimed shot succeed or rebound according to its shutter window', (_id, pattern) => {
    const { room } = assembleSections([pattern]);
    for (const side of ['left', 'right']) {
      const outcomes = new Set<string>();
      for (let tick = 0; tick < 480; tick += 12) {
        const state = heldAt(room, `0:${side}`, tick);
        const target = `0:${side}-upper`;
        const pull = sectionBallisticPull(room, state, target, 98)!;
        const result = flySectionInput(room, state, { waitTicks: 0, pull });
        outcomes.add(result.state.pocketId === target ? 'passed' : 'blocked');
      }
      expect(outcomes).toEqual(new Set(['passed', 'blocked']));
    }
  });

  test('early warmup seams have no future cushion or barrier entering the pull space', () => {
    for (let seed = 0; seed < 12; seed++) {
      const warmup = chooseInteractiveSection(seed, 0, { min: 180, max: 180 }, undefined, 0, [0, 0, 0, 0]);
      expect(warmup.bumpers).toEqual([]);
      expect(warmup.barriers).toEqual([]);
      const next = chooseInteractiveSection(seed, 1, warmup.exitX, undefined, 6, [0, 0, 0, 0]);
      const { room } = assembleSections([warmup, next]);
      for (const side of ['left', 'right']) {
        const state = heldAt(room, '0:rest');
        const input = solveSectionEdge(room, state, `1:${side}`, { perturbation: 1 });
        expect(flySectionInput(room, state, input).state.pocketId).toBe(`1:${side}`);
      }
    }
  });

  test('the supporting loose-pocket corridor remains completable after a real catch and aiming pause', () => {
    const candidate = Array.from({ length: 200 }, (_, index) =>
      chooseInteractiveSection(42, index, { min: 180, max: 180 }, undefined, 60, [3, 3, 3, 0]))
      .find((pattern) => pattern.mechanics.includes('fray'))!;
    expect(candidate).toBeDefined();
    for (const pattern of [candidate, mirrorInteractiveSection(candidate)]) {
      const { room } = assembleSections([pattern]);
      let state = heldAt(room, 'entry');
      for (const target of ['0:right', '0:right-upper']) {
        state = flySectionInput(room, state, solveSectionEdge(room, state, target, { perturbation: 1 })).state;
        expect(state.pocketId).toBe(target);
      }
      expect(state.pocketExpiryTicks!['0:right-upper']).toBe(state.tick + 480);
      for (let aiming = 0; aiming < 240; aiming++) stepLaunch(room, state);
      state = flySectionInput(room, state, solveSectionEdge(room, state, '0:rest', { perturbation: 1, maxWaitTicks: 0 })).state;
      expect(state.pocketId).toBe('0:rest');
    }
  });
});
