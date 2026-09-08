/** @jest-environment node */
import { describe, expect, test } from '@jest/globals';
import { chooseSection, mirrorSection, SECTION_PATTERNS } from '../sections';
import { BUTTON_RADIUS, hazardPosition, MAX_PULL, stepLaunch } from '../simulation';
import { assembleSections, flySectionInput, heldAt, sectionBallisticPull, solveSectionEdge } from '../testing/sectionSolver';

const patterns = SECTION_PATTERNS.flatMap((pattern) => [pattern, mirrorSection(pattern)]);

describe('authored branching sections', () => {
  test('twelve original layouts provide equal-rank choices and a broad untimed rejoin', () => {
    expect(SECTION_PATTERNS).toHaveLength(12);
    for (const family of ['fork', 'cushion', 'gate', 'fray']) expect(SECTION_PATTERNS.filter((pattern) => pattern.family === family)).toHaveLength(3);
    for (const pattern of patterns) {
      const choices = pattern.connections.filter((edge) => edge.from === 'entry').map((edge) => pattern.pockets.find((pocket) => pocket.id === edge.to)!);
      expect(choices).toHaveLength(2);
      expect(choices.map((pocket) => pocket.ascentRank)).toEqual([1, 1]);
      expect(choices.map((pocket) => pocket.route)).toEqual(['safe', 'reward']);
      const exit = pattern.pockets.find((pocket) => pocket.id === pattern.exitPocketId)!;
      expect(exit.route).toBe('recovery');
      expect(exit.width).toBeGreaterThanOrEqual(140);
      expect(exit.frayTicks).toBeUndefined();
      expect(exit.center.x).toBe(180);
      expect(pattern.pickups).toHaveLength(1);
    }
  });

  test.each(patterns.map((pattern) => [pattern.id, pattern] as const))('%s has forgiving inputs for every authored edge', (_id, pattern) => {
    for (const entryX of [100, 180, 260]) {
      const { room, connections } = assembleSections([pattern], entryX);
      for (const edge of connections) {
        const source = heldAt(room, edge.from);
        const input = solveSectionEdge(room, source, edge.to);
        expect(flySectionInput(room, source, input).state.pocketId).toBe(edge.to);
      }
    }
  });

  test.each(patterns.map((pattern) => [pattern.id, pattern] as const))('%s puts its free tool on a reachable reward arrival', (_id, pattern) => {
    const { room, connections } = assembleSections([pattern]);
    const pickup = room.pickups![0];
    const reward = room.pockets.filter((pocket) => pocket.route === 'reward')
      .sort((a, b) => Math.abs(a.center.y - pickup.center.y) - Math.abs(b.center.y - pickup.center.y))[0];
    const incoming = connections.find((edge) => edge.to === reward.id)!;
    const source = heldAt(room, incoming.from);
    const input = solveSectionEdge(room, source, reward.id, { pickupId: pickup.id });
    expect(flySectionInput(room, source, input).state.pickupIds).toContain(pickup.id);
  });

  test('sequencing teaches families, avoids repeated pressure, and gates fraying pockets', () => {
    for (let seed = 0; seed < 20; seed += 1) {
      let previous: typeof SECTION_PATTERNS[number]['family'] | undefined;
      for (let index = 0; index < 60; index += 1) {
        const pattern = chooseSection(seed, index, { min: 180, max: 180 }, previous, index >= 5);
        expect(pattern.family).not.toBe(previous);
        if (index < 3) expect(pattern.family).toBe(['fork', 'cushion', 'gate'][index]);
        if (index < 5) expect(pattern.family).not.toBe('fray');
        if (previous === 'gate' || previous === 'fray') expect(['gate', 'fray']).not.toContain(pattern.family);
        expect(chooseSection(seed, index, { min: 180, max: 180 }, previous, index >= 5)).toEqual(pattern);
        previous = pattern.family;
      }
    }
  });

  test.each(patterns.filter((pattern) => pattern.family === 'cushion').map((pattern) => [pattern.id, pattern] as const))
  ('%s has a real cushion bank into its reward route', (_id, pattern) => {
    const { room } = assembleSections([pattern]);
    const source = heldAt(room, 'entry');
    const input = solveSectionEdge(room, source, '0:reward', { requireBounce: true });
    const result = flySectionInput(room, source, input);
    expect(result.state.pocketId).toBe('0:reward');
    expect(result.events.some((event) => event.type === 'bounce')).toBe(true);
  });

  test.each(patterns.filter((pattern) => pattern.family === 'gate').map((pattern) => [pattern.id, pattern] as const))
  ('%s has safe waiting positions and a real moving launch window', (_id, pattern) => {
    const { room, connections } = assembleSections([pattern]);
    const hazard = room.hazards[0];
    const period = hazard.motion!.periodTicks;
    const riskExit = connections.find((edge) => edge.from === '0:reward')!;
    const outcomes = new Set<string>();
    for (let tick = 0; tick < period; tick += 12) {
      const center = hazardPosition(hazard, tick);
      for (const pocket of room.pockets) {
        expect(Math.hypot(center.x - pocket.center.x, center.y - pocket.center.y))
          .toBeGreaterThan(MAX_PULL + BUTTON_RADIUS + hazard.radius);
      }
      const source = heldAt(room, riskExit.from, tick);
      const pull = sectionBallisticPull(room, source, riskExit.to, 97);
      if (pull) {
        const result = flySectionInput(room, source, { waitTicks: 0, pull });
        outcomes.add(result.state.pocketId === riskExit.to ? 'caught' : result.state.failure ?? result.state.phase);
      }
    }
    expect(outcomes).toContain('caught');
    expect(outcomes).toContain('hazard');
    for (const tick of [0, period / 4, period / 2, period * 3 / 4]) {
      for (const edge of connections) {
        const source = heldAt(room, edge.from, tick);
        expect(solveSectionEdge(room, source, edge.to).waitTicks).toBeLessThanOrEqual(period);
      }
    }
  });

  test('every permitted section seam preserves both choices and the preceding recovery', () => {
    for (const previous of patterns) for (const next of patterns) {
      if (previous.family === next.family || (['gate', 'fray'].includes(previous.family) && ['gate', 'fray'].includes(next.family))) continue;
      const { room, connections } = assembleSections([previous, next]);
      for (const edge of connections.filter((connection) => connection.to === '0:rest' || connection.from === '0:rest')) {
        const source = heldAt(room, edge.from, 180);
        try {
          const input = solveSectionEdge(room, source, edge.to);
          expect(flySectionInput(room, source, input).state.pocketId).toBe(edge.to);
        } catch (error) {
          throw new Error(`${previous.id} -> ${next.id}: ${String(error)}`);
        }
      }
    }
  }, 30000);

  test.each(patterns.filter((pattern) => pattern.family === 'fray').map((pattern) => [pattern.id, pattern] as const))
  ('%s permits an exit after varied arrivals and a three-second aiming pause', (_id, pattern) => {
    const neighbors = [SECTION_PATTERNS[0], pattern, SECTION_PATTERNS[3]];
    const { room, connections } = assembleSections(neighbors);
    const temporary = room.pockets.find((pocket) => pocket.frayTicks)!;
    const incoming = connections.find((edge) => edge.to === temporary.id)!;
    const outgoing = connections.find((edge) => edge.from === temporary.id)!;
    for (const tick of [0, 173, 617]) {
      const source = heldAt(room, incoming.from, tick);
      const arrivalInput = solveSectionEdge(room, source, incoming.to);
      for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) {
        const arrived = flySectionInput(room, source, { ...arrivalInput,
          pull: { x: arrivalInput.pull.x + dx, y: arrivalInput.pull.y + dy } }).state;
        expect(arrived.pocketId).toBe(temporary.id);
        expect(arrived.pocketExpiryTicks?.[temporary.id]).toBe(arrived.tick + 480);
        const expires = arrived.pocketExpiryTicks![temporary.id];
        for (let aiming = 0; aiming < 360; aiming += 1) stepLaunch(room, arrived);
        const escape = solveSectionEdge(room, arrived, outgoing.to, { maxWaitTicks: 0 });
        const result = flySectionInput(room, arrived, escape);
        expect(result.state.pocketId).toBe(outgoing.to);
        expect(result.state.tick).toBeLessThan(expires);
      }
    }
  });
});
