/** @jest-environment node */
import { describe, expect, test } from '@jest/globals';

import { mirrorChallenge } from '../challenges';
import { FLIGHT_PATTERNS } from '../flightPatterns';
import { clampPull } from '../simulation';
import { aimAtReceiver, flyPattern, FLIGHT_TIMING_WITNESSES as timingWitnesses, staticFlightPower as witnessPower } from '../testing/flightPatternHelpers';

const bands = ['intro', 'mixed', 'expert'] as const;
const staticPatterns = FLIGHT_PATTERNS.filter((pattern) => !pattern.receiver.motion);
const offsets = [-3, -2, -1, 0, 1, 2, 3];

function longestCyclicWindow(values: readonly boolean[]): number {
  let current = 0;
  let longest = 0;
  for (const value of [...values, ...values]) {
    current = value ? current + 1 : 0;
    longest = Math.max(longest, current);
  }
  return Math.min(values.length, longest);
}

describe('authored non-bank flight patterns', () => {
  test('each difficulty offers two distinct arc, reverse and timing layouts and a full-range recovery', () => {
    expect(new Set(FLIGHT_PATTERNS.map((pattern) => pattern.id)).size).toBe(FLIGHT_PATTERNS.length);
    for (const band of bands) {
      const patterns = FLIGHT_PATTERNS.filter((pattern) => pattern.band === band);
      for (const family of ['arc', 'reverse', 'timing']) {
        const layouts = patterns.filter((pattern) => pattern.family === family);
        expect(layouts).toHaveLength(2);
        expect(new Set(layouts.map((pattern) => JSON.stringify({
          receiver: pattern.receiver, hazards: pattern.hazards,
        }))).size).toBe(2);
      }
      expect(patterns.some((pattern) => pattern.family === 'recovery'
        && pattern.entryX.min <= 100 && pattern.entryX.max >= 260)).toBe(true);
      expect(patterns.some((pattern) => pattern.family === 'arc'
        && pattern.entryX.min <= 100 && pattern.entryX.max >= 260)).toBe(true);
    }
    for (const pattern of FLIGHT_PATTERNS) {
      const amplitude = pattern.receiver.motion?.amplitude ?? 0;
      expect(pattern.exitX).toEqual({
        min: pattern.receiver.center.x - amplitude, max: pattern.receiver.center.x + amplitude,
      });
      expect(pattern.receiver.center.y).toBeLessThanOrEqual(-110);
      expect(pattern.receiver.center.y).toBeGreaterThanOrEqual(-180);
    }
  });

  test.each(staticPatterns)('$id and its reflection tolerate a 7×7 aim cluster across their full entry interval', (canonical) => {
    for (const pattern of [canonical, mirrorChallenge(canonical)]) {
      // Four-pixel sampling includes the moving receiver extrema and the entire connecting span.
      for (let entryX = pattern.entryX.min; entryX <= pattern.entryX.max; entryX += 4) {
        const pull = aimAtReceiver(pattern, entryX, witnessPower(pattern));
        expect(Math.hypot(pull.x, pull.y)).toBeLessThan(95);
        for (const dx of offsets) for (const dy of offsets) {
          const varied = { x: pull.x + dx, y: pull.y + dy };
          const result = flyPattern(pattern, varied, entryX);
          expect({ id: pattern.id, entryX, dx, dy, caught: result.caught, failure: result.failure })
            .toEqual({ id: pattern.id, entryX, dx, dy, caught: true, failure: undefined });
          expect(result.actualPull).toEqual(clampPull(varied));
          expect(result.bounces).toBe(0);
          expect(pattern.receiver.center.y).toBeLessThan(result.cameraY + 600);
        }
      }
    }
  });

  test.each(FLIGHT_PATTERNS.filter((pattern) => pattern.family === 'arc'))('$id thorns change the safe power choice', (canonical) => {
    for (const pattern of [canonical, mirrorChallenge(canonical)]) {
      const entryX = pattern.id.endsWith('-mirror') ? 260 : 100;
      const wrongPower = pattern.id.includes('arc-high') ? 76 : 89;
      const wrongPull = aimAtReceiver(pattern, entryX, wrongPower);
      expect(flyPattern({ ...pattern, hazards: [] }, wrongPull, entryX).caught).toBe(true);
      expect(flyPattern(pattern, wrongPull, entryX).failure).toBe('hazard');
      const rightPull = aimAtReceiver(pattern, entryX, witnessPower(pattern));
      expect(flyPattern(pattern, rightPull, entryX).caught).toBe(true);
    }
  });

  test.each(timingWitnesses)('$id offers a forgiving release window and a phase-dependent miss with the same pull', (witness) => {
    const canonical = FLIGHT_PATTERNS.find((pattern) => pattern.id === witness.id)!;
    for (const pattern of [canonical, mirrorChallenge(canonical)]) {
      const entryX = pattern.entryX.min;
      const pull = aimAtReceiver(pattern, entryX, witness.pullY, witness.tick);
      for (const dx of offsets) for (const dy of offsets) {
        expect(flyPattern(pattern, { x: pull.x + dx, y: pull.y + dy }, entryX, witness.tick).caught).toBe(true);
      }
      const outcomes = Array.from({ length: pattern.receiver.motion!.periodTicks }, (_, tick) =>
        flyPattern(pattern, pull, entryX, tick).caught);
      expect(outcomes.some(Boolean)).toBe(true);
      expect(outcomes.some((caught) => !caught)).toBe(true);
      expect(longestCyclicWindow(outcomes)).toBeGreaterThanOrEqual(pattern.band === 'intro' ? 60 : 36);
    }
  });

  test('the authored solutions require several powers and distinct flight heights', () => {
    expect(new Set(staticPatterns.map(witnessPower)).size).toBeGreaterThanOrEqual(6);
    for (const band of bands) {
      const high = FLIGHT_PATTERNS.find((pattern) => pattern.id === `arc-high-${band}-right`)!;
      const low = FLIGHT_PATTERNS.find((pattern) => pattern.id === `arc-low-${band}-right`)!;
      const highFlight = flyPattern(high, aimAtReceiver(high, 100, witnessPower(high)));
      const lowFlight = flyPattern(low, aimAtReceiver(low, 100, witnessPower(low)));
      expect(highFlight.minimumY).toBeLessThan(lowFlight.minimumY - 80);
      expect(highFlight.tick).toBeGreaterThan(lowFlight.tick + 35);
    }
  });
});
