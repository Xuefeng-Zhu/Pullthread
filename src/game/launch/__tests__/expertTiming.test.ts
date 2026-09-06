/** @jest-environment node */
import { describe, expect, test } from '@jest/globals';

import { BANK_PATTERNS } from '../bankPatterns';
import { chooseChallenge, mirrorChallenge } from '../challenges';
import type { ChallengePattern } from '../challengeTypes';
import { FLIGHT_PATTERNS } from '../flightPatterns';
import { bankWitness } from '../testing/bankPatternVerification';
import { aimAtReceiver, flyPattern } from '../testing/flightPatternHelpers';

const examples = [
  { id: 'timing-expert-outward-right', power: 81, tick: 114, wrongPower: 96, wrongTick: 28 },
  { id: 'timing-expert-return-right', power: 85, tick: 42, wrongPower: 98, wrongTick: 207 },
];
const offsets = [-3, -2, -1, 0, 1, 2, 3];

function withRetainedCeiling(next: ChallengePattern, timing: ChallengePattern): ChallengePattern {
  return {
    ...next,
    hazards: [...next.hazards, ...timing.hazards.map((hazard) => ({
      ...hazard, center: { x: hazard.center.x, y: hazard.center.y - timing.receiver.center.y },
    }))],
  };
}

describe('expert timing combines controlled power with release timing', () => {
  test.each(examples)('$id ceiling blocks a real overpowered solution without changing the intended timing window', (example) => {
    const canonical = FLIGHT_PATTERNS.find((pattern) => pattern.id === example.id)!;
    for (const pattern of [canonical, mirrorChallenge(canonical)]) {
      const withoutCeiling = { ...pattern, hazards: [] };
      const pull = aimAtReceiver(pattern, pattern.entryX.min, example.power, example.tick);
      for (const dx of offsets) for (const dy of offsets) {
        expect(flyPattern(pattern, { x: pull.x + dx, y: pull.y + dy }, pattern.entryX.min, example.tick).caught).toBe(true);
      }
      const outcomes = Array.from({ length: pattern.receiver.motion!.periodTicks }, (_, tick) => {
        const result = flyPattern(pattern, pull, pattern.entryX.min, tick).caught;
        expect(result).toBe(flyPattern(withoutCeiling, pull, pattern.entryX.min, tick).caught);
        return result;
      });
      expect(outcomes.some(Boolean)).toBe(true);
      expect(outcomes.some((caught) => !caught)).toBe(true);
      const excessivePull = { x: 0, y: example.wrongPower };
      expect(flyPattern(withoutCeiling, excessivePull, pattern.entryX.min, example.wrongTick).caught).toBe(true);
      expect(flyPattern(pattern, excessivePull, pattern.entryX.min, example.wrongTick).failure).toBe('hazard');
    }
  });

  test.each(examples)('$id retains its ceiling safely across every frozen anchor and opposite-side connector', (example) => {
    const canonical = FLIGHT_PATTERNS.find((pattern) => pattern.id === example.id)!;
    for (const timing of [canonical, mirrorChallenge(canonical)]) {
      const mirrored = timing.id.endsWith('-mirror');
      for (const family of ['arc-low', 'recovery']) {
        const nextCanonical = FLIGHT_PATTERNS.find((pattern) => pattern.id === `${family}-expert-right`)!;
        const next = mirrored ? mirrorChallenge(nextCanonical) : nextCanonical;
        const combined = withRetainedCeiling(next, timing);
        for (let entry = timing.exitX.min; entry <= timing.exitX.max; entry += 4) {
          const pull = aimAtReceiver(next, entry, family === 'arc-low' ? 72 : 76);
          for (const dx of offsets) for (const dy of offsets) {
            expect(flyPattern(combined, { x: pull.x + dx, y: pull.y + dy }, entry).caught).toBe(true);
          }
        }
        // A connector toward the old ceiling column really is unsafe; the
        // direction rule protects play rather than merely selecting artwork.
        const unsafe = mirrorChallenge(next);
        const closestEntry = mirrored ? timing.exitX.max : timing.exitX.min;
        const unsafePull = aimAtReceiver(unsafe, closestEntry, family === 'arc-low' ? 72 : 76);
        expect(flyPattern(unsafe, unsafePull, closestEntry).caught).toBe(true);
        expect(flyPattern(withRetainedCeiling(unsafe, timing), unsafePull, closestEntry).failure).toBe('hazard');
      }
    }
  });

  test('the sequencer preserves expert timing orientation for shallow arcs and recovery pockets', () => {
    for (const example of examples) {
      const canonical = FLIGHT_PATTERNS.find((pattern) => pattern.id === example.id)!;
      for (const timing of [canonical, mirrorChallenge(canonical)]) {
        const expectedX = timing.id.endsWith('-mirror') ? 100 : 260;
        // Seed3's second expert shot is timing followed by an arc; seed1's
        // expert block ends in timing followed by its scheduled recovery.
        const arc = chooseChallenge(3, 17, timing.exitX, 'timing', timing.id);
        const recovery = chooseChallenge(1, 19, timing.exitX, 'timing', timing.id);
        expect(arc.id).toContain('arc-low-expert');
        expect(recovery.family).toBe('recovery');
        expect(arc.receiver.center.x).toBe(expectedX);
        expect(recovery.receiver.center.x).toBe(expectedX);
      }
    }
  });

  test('both bank layouts complete with the future expert timing ceiling already present', () => {
    for (const canonical of BANK_PATTERNS.filter((pattern) => pattern.band === 'expert')) {
      for (const bank of [canonical, mirrorChallenge(canonical)]) {
        for (const example of examples) {
          const nextCanonical = FLIGHT_PATTERNS.find((pattern) => pattern.id === example.id)!;
          const timing = bank.id.endsWith('-mirror') ? mirrorChallenge(nextCanonical) : nextCanonical;
          const combined = {
            ...bank,
            hazards: [...bank.hazards, ...timing.hazards.map((hazard) => ({
              ...hazard, center: { x: hazard.center.x, y: hazard.center.y + bank.receiver.center.y },
            }))],
          };
          const pull = bankWitness(bank.id);
          for (const dx of offsets) for (const dy of offsets) {
            expect(flyPattern(combined, { x: pull.x + dx, y: pull.y + dy }).caught).toBe(true);
          }
        }
      }
    }
  });
});
