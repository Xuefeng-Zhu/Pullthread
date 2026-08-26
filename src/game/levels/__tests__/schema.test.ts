import { describe, expect, test } from '@jest/globals';

import { CAMPAIGN_LEVELS, CAMPAIGN_QUILTS } from '../campaignLevels';
import {
  validateCampaignCatalog,
  validateLevelDefinition,
  type LevelDefinition,
} from '../schema';

function copyLevel(
  overrides: Partial<LevelDefinition>,
): LevelDefinition {
  return { ...CAMPAIGN_LEVELS[0], ...overrides };
}

describe('campaign level validation', () => {
  test('accepts the shipped catalog', () => {
    expect(() =>
      validateCampaignCatalog(CAMPAIGN_QUILTS, CAMPAIGN_LEVELS),
    ).not.toThrow();
  });

  test('rejects malformed geometry and objects outside the fabric', () => {
    expect(() =>
      validateLevelDefinition(
        copyLevel({
          traveler: { start: { x: -1, y: 0 }, radius: 0.035 },
        }),
      ),
    ).toThrow('must fit completely inside fabric bounds');

    expect(() =>
      validateLevelDefinition(
        copyLevel({
          collectible: {
            id: 'escaped-patch',
            center: { x: 2, y: 2 },
            radius: 0.04,
          },
        }),
      ),
    ).toThrow('must fit completely inside fabric bounds');
  });

  test('rejects bumper restitution above the physics maximum', () => {
    expect(() =>
      validateLevelDefinition(
        copyLevel({
          bumpers: [
            {
              id: 'overpowered-bumper',
              center: { x: 0.5, y: 0.5 },
              radius: 0.05,
              restitution: 1.01,
            },
          ],
        }),
      ),
    ).toThrow('must be between 0 and 1');
  });

  test('rejects forged reference costs and solutions over the budget', () => {
    const reference = CAMPAIGN_LEVELS[0].referenceSolution[0];
    expect(() =>
      validateLevelDefinition(
        copyLevel({
          referenceSolution: [{ ...reference, threadCost: 1 }],
        }),
      ),
    ).toThrow('must equal canonical cost');

    expect(() =>
      validateLevelDefinition(
        copyLevel({ threadBudget: 1, targetThreadUsage: 1 }),
      ),
    ).toThrow('exceeds threadBudget');
  });

  test('rejects reference stitches the player input cannot author', () => {
    const reference = CAMPAIGN_LEVELS[0].referenceSolution[0];
    expect(() =>
      validateLevelDefinition(
        copyLevel({
          referenceSolution: [{ ...reference, radius: reference.radius + 0.01 }],
        }),
      ),
    ).toThrow('must match the player-authored radius');

    expect(() =>
      validateLevelDefinition(
        copyLevel({
          referenceSolution: [{ ...reference, tension: 0.5 }],
        }),
      ),
    ).toThrow('must match the player-authored tension');
  });

  test('rejects duplicate ids, ordering, and unknown quilt references', () => {
    const first = CAMPAIGN_LEVELS[0];
    const duplicate = copyLevel({ order: 2 });
    expect(() =>
      validateCampaignCatalog(CAMPAIGN_QUILTS, [first, duplicate]),
    ).toThrow('duplicate level id');

    expect(() =>
      validateCampaignCatalog(CAMPAIGN_QUILTS, [
        copyLevel({ id: 'unknown-quilt-level', quiltId: 'unknown-quilt' }),
      ]),
    ).toThrow('references unknown quilt');
  });

  test('rejects reordered catalogs even when orders remain contiguous', () => {
    const reorderedQuilts = [
      CAMPAIGN_QUILTS[1],
      CAMPAIGN_QUILTS[0],
      ...CAMPAIGN_QUILTS.slice(2),
    ];
    expect(() =>
      validateCampaignCatalog(reorderedQuilts, CAMPAIGN_LEVELS),
    ).toThrow('quilt orders must be in canonical ascending order');

    const reorderedLevels = [
      CAMPAIGN_LEVELS[1],
      CAMPAIGN_LEVELS[0],
      ...CAMPAIGN_LEVELS.slice(2),
    ];
    expect(() =>
      validateCampaignCatalog(CAMPAIGN_QUILTS, reorderedLevels),
    ).toThrow('level orders must be in canonical ascending order');
  });
});
