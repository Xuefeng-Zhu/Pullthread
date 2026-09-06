/** @jest-environment node */
import { describe, expect, test } from '@jest/globals';

import { BANK_PATTERNS } from '../bankPatterns';
import { mirrorChallenge } from '../challenges';
import type { ChallengePattern } from '../challengeTypes';
import { FLIGHT_PATTERNS } from '../flightPatterns';
import { aimAtReceiver, flightPatternWitness, flyPattern } from '../testing/flightPatternHelpers';
import { bankWitness } from '../testing/bankPatternVerification';

const banks = BANK_PATTERNS.flatMap((pattern) => [pattern, mirrorChallenge(pattern)]);
const flights = FLIGHT_PATTERNS.flatMap((pattern) => [pattern, mirrorChallenge(pattern)]);
const offsets = [-3, -2, -1, 0, 1, 2, 3];

/** Retain visible neighbor geometry in its original absolute position. */
function withNeighbor(pattern: ChallengePattern, neighbor: ChallengePattern, offsetY: number): ChallengePattern {
  const translate = (point: { x: number; y: number }) => ({ x: point.x, y: point.y + offsetY });
  return {
    ...pattern,
    bumpers: [...pattern.bumpers, ...neighbor.bumpers.map((bumper) => ({ ...bumper, center: translate(bumper.center) }))],
    hazards: [...pattern.hazards, ...neighbor.hazards.map((hazard) => ({ ...hazard, center: translate(hazard.center) }))],
  };
}

function expectCluster(pattern: ChallengePattern, entryX: number, pull: { x: number; y: number }, tick = 0) {
  for (const dx of offsets) for (const dy of offsets) {
    const result = flyPattern(pattern, { x: pull.x + dx, y: pull.y + dy }, entryX, tick);
    expect({ id: pattern.id, entryX, dx, dy, caught: result.caught, failure: result.failure })
      .toEqual({ id: pattern.id, entryX, dx, dy, caught: true, failure: undefined });
  }
}

describe('retained geometry between flight patterns', () => {
  test('both bank layouts clear every preceding arc thorn without removing it after the catch', () => {
    for (const arc of flights.filter((pattern) => pattern.family === 'arc')) {
      for (const bank of banks.filter((pattern) => pattern.band === arc.band && pattern.entryX.min === arc.exitX.min)) {
        const combined = withNeighbor(bank, arc, -arc.receiver.center.y);
        const pull = bankWitness(bank.id);
        expectCluster(combined, bank.entryX.min, pull);
        expect(flyPattern(combined, pull, bank.entryX.min).bounces).toBeGreaterThanOrEqual(1);
      }
    }
  });

  test('upcoming geometry preserves the bank flight for every permitted following family', () => {
    for (const bank of banks) {
      // The sequencer excludes bank→high-arc: that low thorn intersects the returning bank flight.
      for (const next of flights.filter((pattern) => pattern.band === bank.band
        && !pattern.id.includes('arc-high')
        && pattern.entryX.min <= bank.exitX.min && pattern.entryX.max >= bank.exitX.max)) {
        const combined = withNeighbor(bank, next, bank.receiver.center.y);
        expectCluster(combined, bank.entryX.min, bankWitness(bank.id));
      }
    }
  });

  test('a bank exit permits each compatible next pattern while its thorn and cushion remain present', () => {
    for (const bank of banks) {
      for (const next of flights.filter((pattern) => pattern.band === bank.band
        && pattern.entryX.min <= bank.exitX.min && pattern.entryX.max >= bank.exitX.max)) {
        const combined = withNeighbor(next, bank, -bank.receiver.center.y);
        const input = flightPatternWitness(next, bank.exitX.min);
        expectCluster(combined, bank.exitX.min, input.pull, input.releaseTick);
      }
    }
  });

  test('extreme moving-pocket catches reach the shallow arc with the next bank geometry already visible', () => {
    // Includes both motion envelopes (120..240 and108..252), their center, and connector limits.
    for (const arc of flights.filter((pattern) => pattern.id.includes('arc-low'))) {
      for (const bank of banks.filter((pattern) => pattern.band === arc.band && pattern.entryX.min === arc.exitX.min)) {
        const combined = withNeighbor(arc, bank, arc.receiver.center.y);
        for (const entryX of [100, 108, 120, 180, 240, 252, 260]) {
          expectCluster(combined, entryX, aimAtReceiver(arc, entryX, 72));
        }
      }
    }
  });
});
