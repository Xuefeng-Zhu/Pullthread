import { describe, expect, test } from '@jest/globals';

import { fabricRegionAtPoint } from '../../core/physics';
import { releaseSimulation, stepSimulation } from '../../core/simulation';
import type { Stitch } from '../../core/types';
import {
  CAMPAIGN_LEVELS,
  CAMPAIGN_QUILTS,
  LEGACY_DAILY_LEVELS_V1,
} from '../campaignLevels';
import {
  createLevelPhysicsConfig,
  createLevelSimulation,
  createLevelWorld,
  getCampaignLevel,
  getCampaignLevelsForQuilt,
  getCampaignQuilt,
  getLevelVersion,
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

  test('varies the campaign across every travel direction and seam axis', () => {
    const redesignedLevels = CAMPAIGN_LEVELS.slice(1);
    const directions = new Set(
      CAMPAIGN_LEVELS.map(({ baseSlope }) => {
        if (Math.abs(baseSlope.x) > Math.abs(baseSlope.y)) {
          return baseSlope.x < 0 ? 'right' : 'left';
        }
        return baseSlope.y < 0 ? 'down' : 'up';
      }),
    );
    const pinchAxes = new Set(
      CAMPAIGN_LEVELS.flatMap((level) =>
        level.referenceSolution
          .filter((stitch) => stitch.type === 'pinch')
          .map((stitch) => {
            const deltaX = Math.abs(stitch.end.x - stitch.start.x);
            const deltaY = Math.abs(stitch.end.y - stitch.start.y);
            if (deltaX < 0.001) return 'vertical';
            if (deltaY < 0.001) return 'horizontal';
            return 'diagonal';
          }),
      ),
    );
    const courseSignatures = new Set(
      CAMPAIGN_LEVELS.map((level) =>
        JSON.stringify({
          start: level.traveler.start,
          goal: level.goal.center,
          slope: level.baseSlope,
          regions: level.fabricRegions,
          hazards: level.hazards,
          bumpers: level.bumpers,
        }),
      ),
    );

    expect(CAMPAIGN_LEVELS[0].version).toBe(1);
    expect(redesignedLevels.every((level) => level.version === 2)).toBe(true);
    expect(directions).toEqual(new Set(['down', 'left', 'right', 'up']));
    expect(pinchAxes).toEqual(new Set(['horizontal', 'vertical']));
    expect(courseSignatures.size).toBeGreaterThanOrEqual(14);
  });

  test('retains the five historical Daily v1 levels beside campaign v2', () => {
    expect(LEGACY_DAILY_LEVELS_V1).toHaveLength(5);

    for (const legacyLevel of LEGACY_DAILY_LEVELS_V1) {
      const campaignLevel = getCampaignLevel(legacyLevel.id);
      expect(legacyLevel.version).toBe(1);
      expect(campaignLevel.version).toBe(2);
      expect(getLevelVersion(legacyLevel.id, 1)).toBe(legacyLevel);
      expect(getLevelVersion(campaignLevel.id, 2)).toBe(campaignLevel);
      expect(
        runLevel(legacyLevel, legacyLevel.referenceSolution).outcome?.status,
      ).toBe('success');
    }
  });

  test('the hidden-patch solution collects its authored patch', () => {
    const patchLevel = getCampaignLevel('attic-10-hidden-patch');
    const result = runLevel(patchLevel, patchLevel.referenceSolution);

    expect(result.outcome).toMatchObject({
      status: 'success',
      collectedPatchId: patchLevel.collectible?.id,
    });
  });

  test.each([
    { levelId: 'bedroom-03-felt-landing', fabricType: 'felt' },
    { levelId: 'attic-06-silk-slide', fabricType: 'silk' },
  ] as const)('$levelId requires its teaching material', ({
    levelId,
    fabricType,
  }) => {
    const level = getCampaignLevel(levelId);
    const withoutMaterial: LevelDefinition = {
      ...level,
      fabricRegions: level.fabricRegions.filter(
        (region) => region.type !== fabricType,
      ),
    };

    expect(runLevel(level, level.referenceSolution).outcome?.status).toBe(
      'success',
    );
    expect(
      runLevel(withoutMaterial, level.referenceSolution).outcome,
    ).toMatchObject({ status: 'failure' });
  });

  test('Felt and Silk traverses and requires both materials', () => {
    const level = getCampaignLevel('attic-08-felt-and-silk');
    const state = createLevelSimulation(level);
    const world = createLevelWorld(level, level.referenceSolution);
    const visited = new Set<string>();
    releaseSimulation(state);
    while (state.phase === 'running') {
      stepSimulation(state, world, level.physicsConfig);
      const material = fabricRegionAtPoint(
        state.traveler.position,
        level.fabricRegions,
      );
      if (material) visited.add(material.type);
    }

    expect(state.outcome?.status).toBe('success');
    expect(visited).toEqual(new Set(['silk', 'felt']));
    for (const fabricType of ['silk', 'felt'] as const) {
      expect(
        runLevel(
          {
            ...level,
            fabricRegions: level.fabricRegions.filter(
              (region) => region.type !== fabricType,
            ),
          },
          level.referenceSolution,
        ).outcome,
      ).toMatchObject({ status: 'failure' });
    }
  });

  test.each([
    'attic-09-two-stitches',
    'festival-13-pinch-pocket',
    'festival-15-finale',
  ])('%s requires every reference stitch', (levelId) => {
    const level = getCampaignLevel(levelId);
    expect(runLevel(level, level.referenceSolution).outcome?.status).toBe(
      'success',
    );

    for (const removedIndex of level.referenceSolution.keys()) {
      const incomplete = level.referenceSolution.filter(
        (_, index) => index !== removedIndex,
      );
      expect(runLevel(level, incomplete).outcome).toMatchObject({
        status: 'failure',
      });
    }
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

  test('Festival Finale requires its stitches, patch route, materials, and bumper', () => {
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
    for (const fabricType of ['silk', 'felt', 'elastic'] as const) {
      expect(
        runLevel(
          {
            ...level,
            fabricRegions: level.fabricRegions.filter(
              (region) => region.type !== fabricType,
            ),
          },
          level.referenceSolution,
        ).outcome,
      ).toMatchObject({ status: 'failure' });
    }
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
