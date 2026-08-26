import { describe, expect, test } from '@jest/globals';

import { fabricRegionAtPoint } from '../../core/physics';
import { releaseSimulation, stepSimulation } from '../../core/simulation';
import type { Stitch } from '../../core/types';
import {
  CAMPAIGN_LEVELS,
  CAMPAIGN_QUILTS,
} from '../campaignLevels';
import {
  createLevelPhysicsConfig,
  createLevelSimulation,
  createLevelWorld,
  getCampaignLevel,
  getCampaignLevelsForQuilt,
  getCampaignQuilt,
  getNextCampaignLevel,
} from '../levelLoader';
import type { LevelDefinition } from '../schema';

function runLevel(
  level: LevelDefinition,
  stitches: readonly Stitch[],
) {
  const state = createLevelSimulation(level);
  const world = createLevelWorld(level, stitches);
  const config = createLevelPhysicsConfig(level);
  releaseSimulation(state);

  while (state.phase === 'running') {
    stepSimulation(state, world, config);
  }
  return state;
}

function runReferenceWithBumperTrace(level: LevelDefinition) {
  const bumper = level.bumpers[0];
  if (!bumper) throw new Error(`Level "${level.id}" needs an authored bumper.`);

  const state = createLevelSimulation(level);
  const world = createLevelWorld(level, level.referenceSolution);
  let nearestDistance = Number.POSITIVE_INFINITY;
  let nearestPoint = { ...state.traveler.position };
  releaseSimulation(state);

  while (state.phase === 'running') {
    stepSimulation(state, world, level.physicsConfig);
    const distance = Math.hypot(
      state.traveler.position.x - bumper.center.x,
      state.traveler.position.y - bumper.center.y,
    );
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestPoint = { ...state.traveler.position };
    }
  }

  return { bumper, nearestDistance, nearestPoint, state };
}

describe('campaign catalog', () => {
  test('defines three ordered quilts with five ordered levels each', () => {
    expect(CAMPAIGN_QUILTS).toHaveLength(3);
    expect(CAMPAIGN_LEVELS).toHaveLength(15);
    expect(CAMPAIGN_QUILTS.map(({ order }) => order)).toEqual([1, 2, 3]);
    expect(CAMPAIGN_LEVELS.map(({ order }) => order)).toEqual(
      Array.from({ length: 15 }, (_, index) => index + 1),
    );

    for (const quilt of CAMPAIGN_QUILTS) {
      expect(getCampaignLevelsForQuilt(quilt.id)).toHaveLength(5);
      expect(getCampaignQuilt(quilt.id)).toBe(quilt);
    }
  });

  test('looks up stable levels and follows campaign order', () => {
    for (const [index, level] of CAMPAIGN_LEVELS.entries()) {
      expect(getCampaignLevel(level.id)).toBe(level);
      expect(getNextCampaignLevel(level.id)).toBe(
        CAMPAIGN_LEVELS[index + 1] ?? null,
      );
    }

    expect(() => getCampaignLevel('missing-level')).toThrow(
      'Unknown campaign level',
    );
    expect(() => getCampaignQuilt('missing-quilt')).toThrow(
      'Unknown campaign quilt',
    );
  });

  test('authors every promised campaign mechanic as typed data', () => {
    const fabricTypes = new Set(
      CAMPAIGN_LEVELS.flatMap((level) =>
        level.fabricRegions.map((region) => region.type),
      ),
    );
    const hazardTypes = new Set(
      CAMPAIGN_LEVELS.flatMap((level) =>
        level.hazards.map((hazard) => hazard.type),
      ),
    );

    expect(fabricTypes).toEqual(new Set(['felt', 'silk', 'elastic']));
    expect(hazardTypes).toEqual(new Set(['hole', 'thorn']));
    expect(CAMPAIGN_LEVELS.some((level) => level.bumpers.length > 0)).toBe(true);
    expect(CAMPAIGN_LEVELS.some((level) => level.collectible)).toBe(true);
    expect(
      CAMPAIGN_LEVELS.some((level) =>
        level.allowedStitchTypes.includes('pocket'),
      ),
    ).toBe(true);
  });

  test('the hidden-patch solution collects its authored patch', () => {
    const patchLevel = getCampaignLevel('attic-10-hidden-patch');
    const result = runLevel(patchLevel, patchLevel.referenceSolution);

    expect(result.outcome).toMatchObject({
      status: 'success',
      collectedPatchId: patchLevel.collectible?.id,
    });
  });

  test('Elastic Bounce requires an impact in elastic fabric', () => {
    const level = getCampaignLevel('festival-12-elastic-bounce');
    const { bumper, nearestDistance, nearestPoint, state } =
      runReferenceWithBumperTrace(level);

    expect(state.outcome?.status).toBe('success');
    expect(nearestDistance).toBeLessThanOrEqual(
      level.traveler.radius + bumper.radius + 0.00001,
    );
    expect(fabricRegionAtPoint(nearestPoint, level.fabricRegions)?.type).toBe(
      'elastic',
    );

    expect(
      runLevel({ ...level, bumpers: [] }, level.referenceSolution).outcome,
    ).toMatchObject({ status: 'failure' });
    expect(
      runLevel(
        {
          ...level,
          fabricRegions: level.fabricRegions.filter(
            (region) => region.type !== 'elastic',
          ),
        },
        level.referenceSolution,
      ).outcome,
    ).toMatchObject({ status: 'failure' });
  });

  test('Festival Finale combines its pocket, patch, and elastic bumper', () => {
    const level = getCampaignLevel('festival-15-finale');
    const { bumper, nearestDistance, nearestPoint, state } =
      runReferenceWithBumperTrace(level);

    expect(new Set(level.referenceSolution.map((stitch) => stitch.type))).toEqual(
      new Set(['pinch', 'pocket']),
    );
    expect(state.outcome).toMatchObject({
      status: 'success',
      collectedPatchId: level.collectible?.id,
    });
    expect(nearestDistance).toBeLessThanOrEqual(
      level.traveler.radius + bumper.radius + 0.00001,
    );
    expect(fabricRegionAtPoint(nearestPoint, level.fabricRegions)?.type).toBe(
      'elastic',
    );
    expect(
      runLevel({ ...level, bumpers: [] }, level.referenceSolution).outcome,
    ).toMatchObject({ status: 'failure' });
    expect(
      runLevel(
        {
          ...level,
          fabricRegions: level.fabricRegions.filter(
            (region) => region.type !== 'elastic',
          ),
        },
        level.referenceSolution,
      ).outcome,
    ).toMatchObject({ status: 'failure' });
  });
});

describe.each(CAMPAIGN_LEVELS)(
  'campaign level $order: $name',
  (level) => {
    test('fails without stitches and succeeds with its reference solution', () => {
      expect(runLevel(level, []).outcome).toMatchObject({ status: 'failure' });
      expect(runLevel(level, level.referenceSolution).outcome).toMatchObject({
        status: 'success',
      });
    });

    test('repeats baseline and reference inputs exactly across 30 runs', () => {
      const baselineAnchor = runLevel(level, []);
      const referenceAnchor = runLevel(level, level.referenceSolution);

      for (let repetition = 1; repetition < 30; repetition += 1) {
        expect(runLevel(level, [])).toEqual(baselineAnchor);
        expect(runLevel(level, level.referenceSolution)).toEqual(referenceAnchor);
      }
    });
  },
);
