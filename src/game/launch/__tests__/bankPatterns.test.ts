/** @jest-environment node */
import { describe, expect, test } from '@jest/globals';

import { BANK_PATTERNS } from '../bankPatterns';
import { mirrorChallenge } from '../challenges';
import { BUTTON_RADIUS, MAX_PULL, clampPull } from '../simulation';
import { bankOcclusionCertificate, bankWitness } from '../testing/bankPatternVerification';
import { flyPattern } from '../testing/flightPatternHelpers';

const offsets = [-3, -2, -1, 0, 1, 2, 3];

describe('required bank patterns', () => {
  test('each band supplies two distinct bank layouts with reflected versions', () => {
    for (const band of ['intro', 'mixed', 'expert']) {
      const layouts = BANK_PATTERNS.filter((pattern) => pattern.band === band);
      expect(layouts).toHaveLength(2);
      expect(layouts[0].receiver.center.y).not.toBe(layouts[1].receiver.center.y);
      expect(layouts[0].bumpers).not.toEqual(layouts[1].bumpers);
    }
    expect(new Set(BANK_PATTERNS.map((pattern) => pattern.id)).size).toBe(BANK_PATTERNS.length);
  });

  test.each(BANK_PATTERNS)('$id and its mirror complete every 7×7 finger variation with a bounce', (canonical) => {
    for (const pattern of [canonical, mirrorChallenge(canonical)]) {
      const witness = bankWitness(pattern.id);
      for (const dx of offsets) for (const dy of offsets) {
        const finger = { x: witness.x + dx, y: witness.y + dy };
        const result = flyPattern(pattern, finger);
        expect({ id: pattern.id, dx, dy, caught: result.caught, failure: result.failure })
          .toEqual({ id: pattern.id, dx, dy, caught: true, failure: undefined });
        expect(result.bounces).toBeGreaterThanOrEqual(1);
        expect(result.actualPull).toEqual(clampPull(finger));
        // A fully stretched finger remains within the visible 120px below
        // the settled held line; this does not assume an offscreen overshoot.
        expect(finger.y).toBeLessThan(120);
        expect(Math.hypot(result.actualPull.x, result.actualPull.y)).toBeLessThanOrEqual(MAX_PULL + 1e-8);
      }
    }
  });

  test.each(BANK_PATTERNS)('$id blocks every continuous no-bounce route and every forward skip', (canonical) => {
    for (const pattern of [canonical, mirrorChallenge(canonical)]) {
      const proof = bankOcclusionCertificate(pattern);
      expect(proof.thornRise).toBeGreaterThan(MAX_PULL);
      expect(proof.minimumPullY).toBeGreaterThan(0);
      expect(proof.minimumPullY).toBeLessThan(MAX_PULL);
      expect(proof.maximumThornCrossingTime).toBeGreaterThan(1 / 7.5);
      expect(proof.maximumThornCrossingTime).toBeLessThan(proof.minimumApexTime);
      expect(proof.ratio).toBeGreaterThan(0);
      expect(proof.ratio).toBeLessThan(1);
      expect(proof.blockingMargin).toBeGreaterThan(3);
      // Every authored successor is at least another110 units higher.
      expect(proof.rise + 110).toBeGreaterThan(proof.maximumUnbouncedRise);
      const directPull = { x: 0, y: 96 };
      expect(flyPattern({ ...pattern, hazards: [] }, directPull).caught).toBe(true);
      expect(flyPattern(pattern, directPull).failure).toBe('hazard');
      expect(flyPattern({ ...pattern, bumpers: [] }, bankWitness(pattern.id)).caught).toBe(false);
    }
  });

  test('adversarial direct shots include upward pulls, maximum power and side clamps', () => {
    for (const canonical of BANK_PATTERNS.filter((pattern) => pattern.band === 'intro')) {
      for (const mirrored of [canonical, mirrorChallenge(canonical)]) {
        const pattern = { ...mirrored, bumpers: [] };
        for (let x = -100; x <= 100; x += 10) for (let y = -100; y <= 100; y += 10) {
          expect(flyPattern(pattern, { x, y }).caught).toBe(false);
        }
      }
    }
  });

  test.each(BANK_PATTERNS)('$id keeps its held, release and complete next-pull envelopes outside colliders', (pattern) => {
    const pull = clampPull(bankWitness(pattern.id));
    const release = { x: pattern.entryX.min + pull.x, y: pull.y };
    for (const object of [...pattern.bumpers, ...pattern.hazards]) {
      const radius = object.radius + BUTTON_RADIUS;
      expect(Math.hypot(object.center.x - pattern.entryX.min, object.center.y)).toBeGreaterThan(radius + 4);
      expect(Math.hypot(object.center.x - release.x, object.center.y - release.y)).toBeGreaterThan(radius + 4);
      expect(Math.hypot(object.center.x - pattern.receiver.center.x,
        object.center.y - pattern.receiver.center.y)).toBeGreaterThanOrEqual(MAX_PULL + radius + 4);
      expect(object.center.x - object.radius).toBeGreaterThanOrEqual(12);
      expect(object.center.x + object.radius).toBeLessThanOrEqual(348);
    }
  });
});
