/** @jest-environment node */
import { describe, expect, test } from '@jest/globals';
import { chooseWorldSection, INTRODUCED_MECHANICS, mirrorWorldSection, WORLD_SECTION_PATTERNS } from '../worldSections';
import { BUTTON_RADIUS, hazardPosition, launch, MAX_PULL, pocketPosition, stepLaunch, windAccelerationAt } from '../simulation';
import { assembleSections, flySectionInput, heldAt, sectionBallisticPull, solveSectionEdge, type SectionInput } from '../testing/sectionSolver';
import { SECTION_PATTERNS } from '../sections';
import type { LaunchRoom, LaunchState } from '../types';
import { clampEndlessPull } from '../launchInput';

const patterns = WORLD_SECTION_PATTERNS.flatMap((pattern) => [pattern, mirrorWorldSection(pattern)]);

function windyTicks(room: LaunchRoom, source: LaunchState, input: SectionInput): number {
  const state = JSON.parse(JSON.stringify(source)) as LaunchState;
  for (let tick = 0; tick < input.waitTicks; tick++) stepLaunch(room, state);
  const pull = clampEndlessPull(input.pull, state.position, state.position.y - 480, room.bounds);
  launch(room, state, { tick: state.tick, pocketId: state.pocketId, pull });
  let exposed = 0;
  for (let tick = 0; tick < 960 && state.phase === 'flying'; tick++) {
    if (windAccelerationAt(room.windZones, state.position)) exposed++;
    stepLaunch(room, state);
  }
  return exposed;
}

describe('stitched world authoring', () => {
  test('lessons introduce exactly one unlocked interaction and preserve untimed safe routes', () => {
    for (let stage = 1; stage <= 4; stage++) {
      const introductions = [0, 0, 0, 0].map((_, index) => index < stage - 1 ? 3 : 0);
      for (let lesson = 0; lesson < 3; lesson++) {
        const pattern = chooseWorldSection(73, 10 + lesson, { min: 180, max: 180 }, 'cushion', stage * 20, introductions);
        expect(pattern.introduction).toBe(INTRODUCED_MECHANICS[stage - 1]);
        expect(pattern.mechanics).toEqual([pattern.introduction]);
        const safe = pattern.pockets.filter((pocket) => pocket.route === 'safe' || pocket.route === 'recovery');
        expect(safe.length).toBeGreaterThanOrEqual(2);
        expect(safe.every((pocket) => !pocket.motion && !pocket.frayTicks && pocket.width >= 116)).toBe(true);
        expect(pattern.pockets.find((pocket) => pocket.id === pattern.exitPocketId)?.route).toBe('recovery');
        introductions[stage - 1]++;
      }
    }
  });

  test('a calm generated section separates pressure from an introduction', () => {
    for (const family of ['gate', 'fray'] as const) {
      const calm = chooseWorldSection(5, 10, { min: 180, max: 180 }, family, 80, [3, 3, 3, 0]);
      expect(calm.introduction).toBeUndefined();
      expect(calm.mechanics).toEqual([]);
      const lesson = chooseWorldSection(5, 11, calm.exitX, calm.family, 80, [3, 3, 3, 0]);
      expect(lesson.introduction).toBe('scissors');
    }
  });

  test('bounded mixes remain deterministic after the world backgrounds cycle', () => {
    let family: typeof SECTION_PATTERNS[number]['family'] | undefined;
    const observed = new Set<string>();
    for (let index = 3; index < 200; index++) {
      const pattern = chooseWorldSection(42, index, { min: 180, max: 180 }, family, 100 + index, [3, 3, 3, 3]);
      expect(pattern).toEqual(chooseWorldSection(42, index, { min: 180, max: 180 }, family, 100 + index, [3, 3, 3, 3]));
      expect(pattern.mechanics.length).toBeLessThanOrEqual(2);
      pattern.mechanics.forEach((mechanic) => observed.add(mechanic));
      family = pattern.family;
    }
    expect([...observed].sort()).toEqual(['fray', 'gate', 'scissors', 'spring', 'sway', 'wind']);
  });

  test('wind mirrors its rectangle and force, and sway stays within the rails', () => {
    for (const pattern of WORLD_SECTION_PATTERNS) {
      const mirrored = mirrorWorldSection(pattern);
      pattern.windZones.forEach((zone, index) => {
        expect(zone).toMatchObject({ width: 100, height: 150 });
        expect(Math.abs(zone.accelerationX)).toBe(100);
        expect(mirrored.windZones[index]).toMatchObject({ x: 360 - zone.x - zone.width, accelerationX: -zone.accelerationX });
      });
    }
    for (const pattern of patterns) for (const pocket of pattern.pockets.filter((pocket) => pocket.motion)) {
      expect(pocket.width).toBe(104);
      expect(pocket.motion!.periodTicks).toBe(480);
      for (const tick of [0, 120, 240, 360]) {
        const position = pocketPosition(pocket, tick);
        expect(position.x - pocket.width / 2).toBeGreaterThanOrEqual(12);
        expect(position.x + pocket.width / 2).toBeLessThanOrEqual(348);
      }
    }
  });

  test.each(patterns.map((pattern) => [pattern.id, pattern] as const))('%s supports both branches in an assembled world', (_id, pattern) => {
    const { room, connections } = assembleSections([SECTION_PATTERNS[0], pattern, SECTION_PATTERNS[3]]);
    for (const edge of connections.filter((edge) => edge.to.startsWith('1:') || edge.from === '1:rest')) {
      const source = heldAt(room, edge.from, 173);
      const input = solveSectionEdge(room, source, edge.to);
      expect(flySectionInput(room, source, input).state.pocketId).toBe(edge.to);
    }
  }, 30000);

  test.each(patterns.slice(0, 24).map((pattern) => [pattern.id, pattern] as const))('%s remains reachable from both accepted entry extremes', (_id, pattern) => {
    for (const entryX of [100, 260]) {
      const { room, connections } = assembleSections([pattern], entryX);
      for (const edge of connections.filter((edge) => edge.from === 'entry')) {
        const source = heldAt(room, 'entry');
        expect(flySectionInput(room, source, solveSectionEdge(room, source, edge.to)).state.pocketId).toBe(edge.to);
      }
    }
  }, 30000);

  test.each(patterns.filter((pattern) => pattern.mechanics.includes('scissors') || pattern.mechanics.includes('sway'))
    .map((pattern) => [pattern.id, pattern] as const))('%s allows both routes at every quarter motion phase', (_id, pattern) => {
    const { room, connections } = assembleSections([pattern]);
    const period = pattern.mechanics.includes('scissors') ? 600 : 480;
    for (const tick of [0, period / 4, period / 2, period * 3 / 4]) for (const edge of connections) {
      const source = heldAt(room, edge.from, tick);
      const input = solveSectionEdge(room, source, edge.to);
      expect(flySectionInput(room, source, input).state.pocketId).toBe(edge.to);
    }
  }, 30000);

  test.each(patterns.filter((pattern) => pattern.mechanics.includes('spring'))
    .map((pattern) => [pattern.id, pattern] as const))('%s offers an actual spring bank on its reward route', (_id, pattern) => {
    const { room } = assembleSections([pattern]);
    const source = heldAt(room, 'entry');
    const input = solveSectionEdge(room, source, '0:reward', { requireBounce: true });
    const result = flySectionInput(room, source, input);
    expect(result.state.pocketId).toBe('0:reward');
    expect(result.events.some((event) => event.type === 'bounce' && event.id !== 'wall')).toBe(true);
  }, 30000);

  test.each(patterns.filter((pattern) => pattern.mechanics.length === 1 && pattern.mechanics[0] === 'wind')
    .map((pattern) => [pattern.id, pattern] as const))('%s exposes the reward flight to wind while sheltering its entire safe route', (_id, pattern) => {
    const { room, connections } = assembleSections([pattern]);
    const rewardEdges = connections.filter((edge) => room.pockets.find((pocket) => pocket.id === edge.to)?.route === 'reward');
    expect(rewardEdges.some((edge) => {
      const source = heldAt(room, edge.from);
      return windyTicks(room, source, solveSectionEdge(room, source, edge.to)) > 0;
    })).toBe(true);
    for (const edge of connections.filter((edge) => {
      const from = room.pockets.find((pocket) => pocket.id === edge.from);
      const to = room.pockets.find((pocket) => pocket.id === edge.to);
      return from?.route !== 'reward' && to?.route !== 'reward';
    })) {
      const source = heldAt(room, edge.from);
      expect(windyTicks(room, source, solveSectionEdge(room, source, edge.to))).toBe(0);
    }
  });

  test.each(patterns.filter((pattern) => pattern.mechanics.length === 1 && pattern.mechanics[0] === 'scissors')
    .map((pattern) => [pattern.id, pattern] as const))('%s creates a real timing window on the reward route', (_id, pattern) => {
    const { room } = assembleSections([pattern]);
    const outcomes = new Set<string>();
    for (let tick = 0; tick < 600; tick += 12) {
      const source = heldAt(room, '0:reward', tick);
      const pull = sectionBallisticPull(room, source, '0:reward-upper', 97)!;
      const { state } = flySectionInput(room, source, { waitTicks: 0, pull });
      outcomes.add(state.pocketId === '0:reward-upper' ? 'caught' : state.failure ?? state.phase);
    }
    expect(outcomes).toContain('caught');
    expect(outcomes).toContain('hazard');
  });

  test('scissors never intrude into a held pocket or its full pull space', () => {
    for (const pattern of patterns.filter((pattern) => pattern.mechanics.includes('scissors'))) {
      const { room } = assembleSections([SECTION_PATTERNS[0], pattern, SECTION_PATTERNS[3]]);
      for (let tick = 0; tick < 600; tick += 12) for (const hazard of room.hazards) {
        const position = hazardPosition(hazard, tick);
        for (const pocket of room.pockets) {
          const center = pocketPosition(pocket, tick);
          expect(Math.hypot(position.x - center.x, position.y - center.y)).toBeGreaterThan(MAX_PULL + BUTTON_RADIUS + hazard.radius);
        }
      }
    }
  });
});
