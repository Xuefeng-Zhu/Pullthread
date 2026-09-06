import { describe, expect, test } from '@jest/globals';

import { createStitch } from '../../input/stitchGesture';
import { CAMPAIGN_LEVELS } from '../campaignLevels';
import { createLevelWorld } from '../levelLoader';

describe('level world construction', () => {
  test('counts the draft preview as completion input', () => {
    const level = {
      ...CAMPAIGN_LEVELS[0],
      completionRequirements: {
        minimumStitches: 2,
        minimumThreadUsed: 100,
        requiredStitchTypes: ['pinch'] as const,
      },
    };
    const committed = level.referenceSolution[0];
    const preview = createStitch(
      'preview',
      'pinch',
      { x: 0.7, y: 1.2 },
      { x: 0.9, y: 1.2 },
    );

    const world = createLevelWorld(level, [committed], preview);

    expect(world.stitches).toEqual([
      {
        ...committed,
        radius: level.stitchInfluenceRadii[committed.type],
      },
      {
        ...preview,
        radius: level.stitchInfluenceRadii[preview.type],
      },
    ]);
    expect(world.completionRequirements).toBe(level.completionRequirements);
  });
});
