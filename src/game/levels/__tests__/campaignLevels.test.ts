import { describe, expect, test } from '@jest/globals';

import { fabricRegionAtPoint } from '../../core/physics';
import { releaseSimulation, stepSimulation } from '../../core/simulation';
import type { Stitch } from '../../core/types';
import {
  createStitch,
  POCKET_STITCH_RADIUS,
  SPIKE_STITCH_RADIUS,
} from '../../input/stitchGesture';
import {
  CAMPAIGN_LEVELS,
  CAMPAIGN_QUILTS,
  CAMPAIGN_STITCH_INFLUENCE_RADII,
  FIRST_NARROWING_STITCH_INFLUENCE_RADII,
  LEGACY_CAMPAIGN_LEVELS_FIRST_NARROWING,
  LEGACY_CAMPAIGN_LEVELS_PRE_TUNING,
  LEGACY_CAMPAIGN_LEVELS_SECOND_NARROWING,
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

function withoutCompletionRequirements(
  level: LevelDefinition,
): LevelDefinition {
  const {
    completionRequirements: _completionRequirements,
    ...permissiveLevel
  } = level;
  return permissiveLevel;
}

function withRequirementVariant(
  level: LevelDefinition,
  minimumThreadUsed: number,
  requireEveryStitchVisited: boolean,
): LevelDefinition {
  return {
    ...level,
    completionRequirements: {
      ...level.completionRequirements,
      minimumThreadUsed,
      requireEveryStitchVisited,
    },
  };
}

function shiftedReferenceSolution(
  level: LevelDefinition,
  deltaX: number,
  deltaY: number,
): readonly Stitch[] | null {
  const shifted = level.referenceSolution.map((authoredStitch) => {
    const start = {
      x: authoredStitch.start.x + deltaX,
      y: authoredStitch.start.y + deltaY,
    };
    const end = {
      x: authoredStitch.end.x + deltaX,
      y: authoredStitch.end.y + deltaY,
    };
    const { fabricBounds } = level;
    const contains = ({ x, y }: { readonly x: number; readonly y: number }) =>
      x >= fabricBounds.x &&
      x <= fabricBounds.x + fabricBounds.width &&
      y >= fabricBounds.y &&
      y <= fabricBounds.y + fabricBounds.height;
    if (!contains(start) || !contains(end)) return null;
    return createStitch(
      authoredStitch.id,
      authoredStitch.type,
      start,
      end,
    );
  });

  return shifted.some((authoredStitch) => authoredStitch === null)
    ? null
    : (shifted as readonly Stitch[]);
}

const SHORTCUT_REGRESSION_CASES = [
  {
    levelId: 'bedroom-01-first-pull',
    stitches: [
      createStitch(
        'first-pull-shortcut',
        'pinch',
        { x: 0.12939453125, y: 0.029296875 },
        { x: 0.270751953125, y: 0.170654296875 },
      ),
    ],
  },
  {
    levelId: 'bedroom-02-edge-redirect',
    stitches: [
      createStitch(
        'edge-redirect-shortcut',
        'pinch',
        { x: 0.19384765625, y: 0.2939453125 },
        { x: 0.406005859375, y: 0.506103515625 },
      ),
    ],
  },
  {
    levelId: 'bedroom-03-felt-landing',
    stitches: [
      createStitch(
        'felt-landing-shortcut',
        'pinch',
        { x: 0.755126953125, y: 0.138916015625 },
        { x: 0.755126953125, y: 0.367919921875 },
      ),
    ],
  },
  {
    levelId: 'bedroom-04-hole-crossing',
    stitches: [
      createStitch(
        'hole-crossing-shortcut',
        'pinch',
        { x: 0.10009765625, y: 1.300048828125 },
        { x: 0.300048828125, y: 1.300048828125 },
      ),
    ],
  },
  {
    levelId: 'bedroom-05-thread-budget',
    stitches: [
      createStitch(
        'measured-thread-shortcut',
        'pinch',
        { x: 0.729248046875, y: 1.329345703125 },
        { x: 0.87060546875, y: 1.470703125 },
      ),
    ],
  },
  {
    levelId: 'attic-06-silk-slide',
    stitches: [
      createStitch(
        'silk-slide-shortcut',
        'pinch',
        { x: 0.300048828125, y: 0.235107421875 },
        { x: 0.300048828125, y: 0.364990234375 },
      ),
    ],
  },
  {
    levelId: 'attic-07-pocket-catch',
    stitches: [
      createStitch(
        'pocket-catch-shortcut',
        'pocket',
        { x: 0.499755859375, y: 0.280029296875 },
        { x: 0.620361328125, y: 0.280029296875 },
      ),
    ],
  },
  {
    levelId: 'attic-08-felt-and-silk',
    stitches: [
      createStitch(
        'crosscut-shortcut',
        'pinch',
        { x: 0.02734375, y: 0.2109375 },
        { x: 0.457763671875, y: 0.2109375 },
      ),
    ],
  },
  {
    levelId: 'attic-09-two-stitches',
    stitches: [
      createStitch(
        'switchback-shortcut',
        'pinch',
        { x: 0.135009765625, y: 1.39990234375 },
        { x: 0.264892578125, y: 1.39990234375 },
      ),
    ],
  },
  {
    levelId: 'attic-10-hidden-patch',
    stitches: [
      createStitch(
        'hidden-patch-shortcut',
        'pinch',
        { x: 0.906005859375, y: 1.19384765625 },
        { x: 0.69384765625, y: 1.406005859375 },
      ),
    ],
  },
  {
    levelId: 'festival-11-thorn-turn',
    stitches: [
      createStitch(
        'thorn-turn-shortcut',
        'pinch',
        { x: 0.093994140625, y: 1.19384765625 },
        { x: 0.30615234375, y: 1.406005859375 },
      ),
    ],
  },
  {
    levelId: 'festival-12-elastic-bounce',
    stitches: [
      createStitch(
        'button-bank-shortcut',
        'pinch',
        { x: 0.4541015625, y: 0.154052734375 },
        { x: 0.5458984375, y: 0.245849609375 },
      ),
    ],
  },
  {
    levelId: 'festival-13-pinch-pocket',
    stitches: [
      createStitch(
        'climb-catch-shortcut',
        'pocket',
        { x: 0.33984375, y: 1.159912109375 },
        { x: 0.460205078125, y: 1.159912109375 },
      ),
    ],
  },
  {
    levelId: 'festival-14-tight-limit',
    stitches: [
      createStitch(
        'single-seam-shortcut',
        'pinch',
        { x: 0.61767578125, y: 1.2890625 },
        { x: 0.90087890625, y: 1.2890625 },
      ),
    ],
  },
  {
    levelId: 'festival-15-finale',
    stitches: [
      createStitch(
        'finale-shortcut-one',
        'pocket',
        { x: 0.499755859375, y: 0.320068359375 },
        { x: 0.620361328125, y: 0.320068359375 },
      ),
      createStitch(
        'finale-shortcut-two',
        'pocket',
        { x: 0.463134765625, y: 0.2802734375 },
        { x: 0.66259765625, y: 0.2802734375 },
      ),
    ],
  },
] as const;

const DUMMY_STITCH_BYPASS_CASES = [
  {
    levelId: 'attic-09-two-stitches',
    historicalMinimumThreadUsed: 60,
    stitches: [
      createStitch(
        'switchback-route-shortcut',
        'pinch',
        { x: 0.135009765625, y: 1.39990234375 },
        { x: 0.264892578125, y: 1.39990234375 },
      ),
      createStitch(
        'switchback-off-course-dummy',
        'pinch',
        { x: 0.95, y: 0.05 },
        { x: 0.95, y: 0.52 },
      ),
    ],
  },
  {
    levelId: 'festival-13-pinch-pocket',
    historicalMinimumThreadUsed: 60,
    stitches: [
      createStitch(
        'climb-catch-route-shortcut',
        'pocket',
        { x: 0.33984375, y: 1.159912109375 },
        { x: 0.460205078125, y: 1.159912109375 },
      ),
      createStitch(
        'climb-catch-off-course-dummy',
        'pinch',
        { x: 0.02, y: 0.05 },
        { x: 0.02, y: 0.52 },
      ),
    ],
  },
] as const;

const EXTENDED_SHORTCUT_CASES = [
  {
    levelId: 'bedroom-03-felt-landing',
    historicalMinimumThreadUsed: 56,
    stitches: [
      createStitch(
        'felt-landing-extended-shortcut',
        'pinch',
        { x: 0.755, y: 0.139 },
        { x: 0.755, y: 0.689 },
      ),
    ],
  },
  {
    levelId: 'attic-08-felt-and-silk',
    historicalMinimumThreadUsed: 56,
    stitches: [
      createStitch(
        'crosscut-extended-shortcut',
        'pinch',
        { x: 0.027344, y: 0.210938 },
        { x: 0.577344, y: 0.210938 },
      ),
    ],
  },
  {
    levelId: 'festival-14-tight-limit',
    historicalMinimumThreadUsed: 40,
    stitches: [
      createStitch(
        'single-seam-extended-shortcut',
        'pinch',
        { x: 0.5, y: 1.289 },
        { x: 0.9, y: 1.289 },
      ),
    ],
  },
] as const;

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

    expect(CAMPAIGN_LEVELS[0].version).toBe(4);
    expect(redesignedLevels.every((level) => level.version === 5)).toBe(true);
    expect(directions).toEqual(new Set(['down', 'left', 'right', 'up']));
    expect(pinchAxes).toEqual(new Set(['horizontal', 'vertical']));
    expect(courseSignatures.size).toBeGreaterThanOrEqual(14);
  });

  test('retains every earlier campaign tuning beside the current levels', () => {
    expect(CAMPAIGN_STITCH_INFLUENCE_RADII).toEqual({
      pinch: 0.17,
      pocket: 0.225,
    });
    expect(FIRST_NARROWING_STITCH_INFLUENCE_RADII).toEqual({
      pinch: 0.185,
      pocket: 0.225,
    });
    expect(CAMPAIGN_STITCH_INFLUENCE_RADII.pinch).toBeLessThan(
      SPIKE_STITCH_RADIUS,
    );
    expect(CAMPAIGN_STITCH_INFLUENCE_RADII.pocket).toBeLessThan(
      POCKET_STITCH_RADIUS,
    );
    expect(LEGACY_CAMPAIGN_LEVELS_PRE_TUNING).toHaveLength(
      CAMPAIGN_LEVELS.length,
    );
    expect(LEGACY_CAMPAIGN_LEVELS_FIRST_NARROWING).toHaveLength(
      CAMPAIGN_LEVELS.length,
    );
    expect(LEGACY_CAMPAIGN_LEVELS_SECOND_NARROWING).toHaveLength(
      CAMPAIGN_LEVELS.length,
    );

    for (const [index, legacyLevel] of LEGACY_CAMPAIGN_LEVELS_PRE_TUNING.entries()) {
      const firstNarrowingLevel = LEGACY_CAMPAIGN_LEVELS_FIRST_NARROWING[index];
      const secondNarrowingLevel =
        LEGACY_CAMPAIGN_LEVELS_SECOND_NARROWING[index];
      const campaignLevel = getCampaignLevel(legacyLevel.id);
      expect(firstNarrowingLevel.version).toBe(legacyLevel.version + 1);
      expect(firstNarrowingLevel.stitchInfluenceRadii).toBe(
        FIRST_NARROWING_STITCH_INFLUENCE_RADII,
      );
      expect(secondNarrowingLevel.version).toBe(
        firstNarrowingLevel.version + 1,
      );
      expect(secondNarrowingLevel.stitchInfluenceRadii).toBe(
        CAMPAIGN_STITCH_INFLUENCE_RADII,
      );
      expect(campaignLevel.version).toBe(secondNarrowingLevel.version + 1);
      expect(campaignLevel.stitchInfluenceRadii).toBe(
        CAMPAIGN_STITCH_INFLUENCE_RADII,
      );
      expect(getLevelVersion(legacyLevel.id, legacyLevel.version)).toBe(
        legacyLevel,
      );
      expect(getLevelVersion(firstNarrowingLevel.id, firstNarrowingLevel.version)).toBe(
        firstNarrowingLevel,
      );
      expect(
        getLevelVersion(
          secondNarrowingLevel.id,
          secondNarrowingLevel.version,
        ),
      ).toBe(secondNarrowingLevel);
      expect(getLevelVersion(campaignLevel.id, campaignLevel.version)).toBe(
        campaignLevel,
      );
      expect(
        runLevel(legacyLevel, legacyLevel.referenceSolution).outcome?.status,
      ).toBe('success');
      expect(
        runLevel(firstNarrowingLevel, firstNarrowingLevel.referenceSolution)
          .outcome?.status,
      ).toBe('success');
      expect(
        runLevel(secondNarrowingLevel, secondNarrowingLevel.referenceSolution)
          .outcome?.status,
      ).toBe('success');
      expect(
        runLevel(campaignLevel, campaignLevel.referenceSolution).outcome
          ?.status,
      ).toBe('success');
    }
  });

  test('retains the five historical Daily v1 levels beside campaign v4/v5', () => {
    expect(LEGACY_DAILY_LEVELS_V1).toHaveLength(5);

    for (const legacyLevel of LEGACY_DAILY_LEVELS_V1) {
      const campaignLevel = getCampaignLevel(legacyLevel.id);
      expect(legacyLevel.version).toBe(1);
      expect(campaignLevel.version).toBe(legacyLevel.order === 1 ? 4 : 5);
      expect(getLevelVersion(legacyLevel.id, 1)).toBe(legacyLevel);
      expect(
        runLevel(legacyLevel, legacyLevel.referenceSolution).outcome?.status,
      ).toBe('success');
    }
  });

  test('authors explicit completion requirements and satisfies them with every reference', () => {
    expect(
      CAMPAIGN_LEVELS.map((level) =>
        level.completionRequirements?.minimumThreadUsed,
      ),
    ).toEqual([70, 70, 70, 70, 65, 70, 15, 70, 90, 70, 70, 70, 75, 70, 85]);
    expect(
      CAMPAIGN_LEVELS.every(
        (level) =>
          level.completionRequirements?.requireEveryStitchVisited === true,
      ),
    ).toBe(true);

    expect(
      getCampaignLevel('bedroom-03-felt-landing').completionRequirements,
    ).toMatchObject({ requiredFabricTypes: ['felt'] });
    expect(
      getCampaignLevel('attic-06-silk-slide').completionRequirements,
    ).toMatchObject({ requiredFabricTypes: ['silk'] });
    expect(
      getCampaignLevel('attic-08-felt-and-silk').completionRequirements,
    ).toMatchObject({ requiredFabricTypes: ['silk', 'felt'] });
    expect(
      getCampaignLevel('attic-09-two-stitches').completionRequirements,
    ).toMatchObject({ minimumStitches: 2 });
    expect(
      getCampaignLevel('festival-12-elastic-bounce').completionRequirements,
    ).toMatchObject({
      requiredFabricTypes: ['elastic'],
      requiredBumperIds: ['festival-button'],
    });
    expect(
      getCampaignLevel('festival-13-pinch-pocket').completionRequirements,
    ).toMatchObject({
      minimumStitches: 2,
      requiredStitchTypes: ['pinch', 'pocket'],
    });
    expect(
      getCampaignLevel('festival-15-finale').completionRequirements,
    ).toMatchObject({
      minimumStitches: 3,
      requiredStitchTypes: ['pinch', 'pocket'],
      requiredFabricTypes: ['silk', 'felt', 'elastic'],
      requiredBumperIds: ['finale-button'],
    });

    for (const level of CAMPAIGN_LEVELS) {
      const requirements = level.completionRequirements;
      const result = runLevel(level, level.referenceSolution);
      expect(requirements).toBeDefined();
      expect(Object.isFrozen(requirements)).toBe(true);
      expect(result.outcome?.status).toBe('success');
      expect(
        level.referenceSolution.reduce(
          (total, authoredStitch) => total + authoredStitch.threadCost,
          0,
        ),
      ).toBeGreaterThanOrEqual(requirements?.minimumThreadUsed ?? 0);
      expect(level.referenceSolution.length).toBeGreaterThanOrEqual(
        requirements?.minimumStitches ?? 0,
      );
      for (const stitchType of requirements?.requiredStitchTypes ?? []) {
        expect(
          level.referenceSolution.some(
            (authoredStitch) => authoredStitch.type === stitchType,
          ),
        ).toBe(true);
      }
      for (const fabricType of requirements?.requiredFabricTypes ?? []) {
        expect(result.visitedFabricTypes.has(fabricType)).toBe(true);
      }
      for (const bumperId of requirements?.requiredBumperIds ?? []) {
        expect(result.hitBumperIds.has(bumperId)).toBe(true);
      }
      for (const authoredStitch of level.referenceSolution) {
        expect(result.visitedStitchIds.has(authoredStitch.id)).toBe(true);
      }
    }
  });

  test.each(SHORTCUT_REGRESSION_CASES)(
    '$levelId rejects its known low-cost shortcut',
    ({ levelId, stitches }) => {
      const level = getCampaignLevel(levelId);

      expect(
        runLevel(withoutCompletionRequirements(level), stitches).outcome
          ?.status,
      ).toBe('success');
      expect(runLevel(level, stitches).outcome?.status).toBe('failure');
    },
  );

  test.each(DUMMY_STITCH_BYPASS_CASES)(
    '$levelId rejects an off-course stitch used only to satisfy requirements',
    ({ levelId, historicalMinimumThreadUsed, stitches }) => {
      const level = getCampaignLevel(levelId);
      const historicalLevel = withRequirementVariant(
        level,
        historicalMinimumThreadUsed,
        false,
      );
      const visitEnforcedLevel = withRequirementVariant(
        level,
        historicalMinimumThreadUsed,
        true,
      );

      expect(
        stitches.reduce(
          (total, authoredStitch) => total + authoredStitch.threadCost,
          0,
        ),
      ).toBe(historicalMinimumThreadUsed);
      expect(runLevel(historicalLevel, stitches).outcome?.status).toBe(
        'success',
      );
      expect(runLevel(visitEnforcedLevel, stitches).outcome?.status).toBe(
        'failure',
      );
      expect(runLevel(level, stitches).outcome?.status).toBe('failure');
    },
  );

  test.each(EXTENDED_SHORTCUT_CASES)(
    '$levelId rejects its formerly valid extended shortcut',
    ({ levelId, historicalMinimumThreadUsed, stitches }) => {
      const level = getCampaignLevel(levelId);
      const historicalLevel = withRequirementVariant(
        level,
        historicalMinimumThreadUsed,
        false,
      );

      expect(
        stitches.reduce(
          (total, authoredStitch) => total + authoredStitch.threadCost,
          0,
        ),
      ).toBe(historicalMinimumThreadUsed);
      expect(runLevel(historicalLevel, stitches).outcome?.status).toBe(
        'success',
      );
      expect(runLevel(level, stitches).outcome?.status).toBe('failure');
    },
  );

  test.each(CAMPAIGN_LEVELS)(
    '$id reference keeps a positive placement margin',
    (level) => {
      const offsets = [-0.005, 0, 0.005];
      let validCandidates = 0;
      let successfulCandidates = 0;
      for (const deltaX of offsets) {
        for (const deltaY of offsets) {
          if (deltaX === 0 && deltaY === 0) continue;
          const candidate = shiftedReferenceSolution(level, deltaX, deltaY);
          if (!candidate) continue;
          validCandidates += 1;
          if (runLevel(level, candidate).outcome?.status === 'success') {
            successfulCandidates += 1;
          }
        }
      }

      expect(validCandidates).toBeGreaterThanOrEqual(2);
      expect(successfulCandidates).toBeGreaterThanOrEqual(2);
    },
  );

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

  test('Festival Finale reference collects its optional patch and requires its route mechanics', () => {
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
