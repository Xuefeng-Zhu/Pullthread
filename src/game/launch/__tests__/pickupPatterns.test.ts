/** @jest-environment node */
import { describe, expect, test } from '@jest/globals';
import { BANK_PATTERNS } from '../bankPatterns';
import { CHALLENGE_PATTERNS, mirrorChallenge } from '../challenges';
import { createLegacyEndlessRun as createEndlessRun, nextEndlessChallenge } from '../endless';
import { findNextInput, replayNext } from '../testing/routeSolver';
import type { ChallengePattern } from '../challengeTypes';
import { FLIGHT_PATTERNS } from '../flightPatterns';
import { pickupPlacement, scheduledPickupKind } from '../pickups';
import { flyOptionalPickupRoute, flyPickupPattern, pickupBypassWitness } from '../testing/pickupPatternHelpers';

const opening: ChallengePattern = { id: 'opening-2', family: 'opening', band: 'intro',
  entryX: { min: 240, max: 240 }, exitX: { min: 260, max: 260 },
  receiver: { center: { x: 260, y: -135 }, width: 144 }, bumpers: [], hazards: [] };
const patterns = [...BANK_PATTERNS.filter((pattern) => pattern.band === 'intro'),
  ...FLIGHT_PATTERNS.filter((pattern) => pattern.family === 'recovery' || pattern.id === 'arc-low-intro-right')];
const offsets = [-3, -2, -1, 0, 1, 2, 3];

describe('authored free tool pickups', () => {
  test('first preview welcomes the generous normal opening shot, including 121 finger variations', () => {
    for (let dx = -5; dx <= 5; dx += 1) for (let dy = -5; dy <= 5; dy += 1) {
      expect(flyPickupPattern(opening, { x: -5 + dx, y: 77 + dy })).toMatchObject({ caught: true, collected: true });
    }
  });

  test('the early tools are fixed and later grants continue rotating at recovery pockets', () => {
    expect([1, 2, 4, 6, 10, 14].map(scheduledPickupKind)).toEqual([undefined, 'preview', 'revive', 'teleport', 'preview', 'teleport']);
    expect([19, 24, 29, 34].map(scheduledPickupKind)).toEqual(['revive', 'preview', 'teleport', 'revive']);
    expect(scheduledPickupKind(20)).toBeUndefined();
  });

  test.each(patterns)('$id and its mirror offer a forgiving bypass and optional side hop across the full entry range', (canonical) => {
    for (const pattern of [canonical, mirrorChallenge(canonical)]) {
      const placement = pickupPlacement(pattern);
      expect(placement.center.x - placement.radius).toBeGreaterThan(10);
      expect(placement.center.x + placement.radius).toBeLessThan(350);
      for (let entryX = pattern.entryX.min; entryX <= pattern.entryX.max; entryX += 4) {
        const bypass = pickupBypassWitness(pattern, entryX);
        for (const dx of offsets) for (const dy of offsets) {
          const label = { id: pattern.id, entryX, dx, dy };
          const passing = flyPickupPattern(pattern, { x: bypass.x + dx, y: bypass.y + dy }, entryX);
          expect({ ...label, caught: passing.caught, collected: passing.collected })
            .toEqual({ ...label, caught: true, collected: false });
          const collecting = flyOptionalPickupRoute(pattern, entryX, { x: dx, y: dy });
          expect({ ...label, caught: collecting.caught, collected: collecting.collected, count: collecting.count })
            .toEqual({ ...label, caught: true, collected: true, count: 1 });
          expect(collecting.flights.every((flight) => flight.launched && flight.phase === 'held')).toBe(true);
          expect(collecting.pocketsCaught).toBe(1);
          if (pattern.family === 'bank') expect(collecting.flights[1].bounces).toBeGreaterThan(0);
        }
      }
    }
  });
});


test('optional detours remain safe with previous and upcoming geometry retained in real seeded runs', () => {
  for (let seed = 0; seed < 16; seed += 1) {
    const run = createEndlessRun(seed);
    for (let index = 1; index <= 20; index += 1) {
      const challenge = nextEndlessChallenge(run)!;
      const pattern = CHALLENGE_PATTERNS.find((candidate) => candidate.id === challenge.patternId);
      const pickupId = `endless-pickup-${index}`;
      const hasPickup = () => run.room.pickups?.some((pickup) => pickup.id === pickupId) ?? false;
      const sideHop = () => {
        const source = run.state.pocketId;
        const events = replayNext(run, { waitTicks: 120,
          pull: { x: run.state.position.x < 180 ? 8 : -8, y: 42 } });
        expect({ seed, index, phase: run.state.phase, pocketId: run.state.pocketId, collected: events.some((event) => event.type === 'pickup' && event.id === pickupId) })
          .toEqual({ seed, index, phase: 'held', pocketId: source, collected: true });
      };
      if (pattern?.family === 'bank' && hasPickup()) sideHop();
      // The full-window solver accounts for retained cushions/ceilings when
      // choosing the through shot; isolated bypass witnesses are verified above.
      const input = findNextInput(run);
      replayNext(run, input);
      expect({ seed, index, phase: run.state.phase, pocketId: run.state.pocketId })
        .toEqual({ seed, index, phase: 'held', pocketId: `endless-${index}` });
      if (index !== 2 && pattern?.family !== 'bank' && hasPickup()) sideHop();
    }
  }
});
