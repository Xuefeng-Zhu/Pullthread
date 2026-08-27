import { describe, expect, test } from '@jest/globals';

import { CAMPAIGN_LEVELS } from '../campaignLevels';
import {
  FREE_CAMPAIGN_LEVEL_COUNT,
  getCampaignLevelAccess,
  requiresFullGameEntitlement,
  type CampaignCompletionByLevel,
} from '../campaignAccess';

const completed = Object.freeze({ completed: true as const });

function progressThrough(order: number): CampaignCompletionByLevel {
  return Object.fromEntries(
    CAMPAIGN_LEVELS.slice(0, order).map((level) => [level.id, completed]),
  );
}

describe('campaign monetization and progression access', () => {
  test('keeps exactly the first six levels free', () => {
    expect(FREE_CAMPAIGN_LEVEL_COUNT).toBe(6);

    for (const level of CAMPAIGN_LEVELS) {
      expect(requiresFullGameEntitlement(level)).toBe(level.order > 6);
    }
  });

  test('starts Level 1 as current and sequence-locks later free levels', () => {
    expect(getCampaignLevelAccess(CAMPAIGN_LEVELS[0].id, {}, false)).toEqual({
      state: 'current',
      canPlay: true,
      openPaywall: false,
      requiresFullGame: false,
    });
    expect(getCampaignLevelAccess(CAMPAIGN_LEVELS[1].id, {}, false)).toEqual({
      state: 'sequence-locked',
      canPlay: false,
      openPaywall: false,
      requiresFullGame: false,
    });
  });

  test('marks completed free levels playable and advances one level at a time', () => {
    const progress = progressThrough(1);

    expect(
      getCampaignLevelAccess(CAMPAIGN_LEVELS[0].id, progress, false),
    ).toMatchObject({ state: 'completed', canPlay: true });
    expect(
      getCampaignLevelAccess(CAMPAIGN_LEVELS[1].id, progress, false),
    ).toMatchObject({ state: 'current', canPlay: true });
    expect(
      getCampaignLevelAccess(CAMPAIGN_LEVELS[2].id, progress, false),
    ).toMatchObject({ state: 'sequence-locked', canPlay: false });
  });

  test('routes a reached premium level to the paywall until entitled', () => {
    const levelSeven = CAMPAIGN_LEVELS[6];
    const progress = progressThrough(6);

    expect(getCampaignLevelAccess(levelSeven.id, progress, false)).toEqual({
      state: 'premium-locked',
      canPlay: false,
      openPaywall: true,
      requiresFullGame: true,
    });
    expect(getCampaignLevelAccess(levelSeven.id, progress, true)).toEqual({
      state: 'current',
      canPlay: true,
      openPaywall: false,
      requiresFullGame: true,
    });
  });

  test('does not let a purchase bypass predecessor progression', () => {
    const levelSeven = CAMPAIGN_LEVELS[6];

    expect(getCampaignLevelAccess(levelSeven.id, {}, false)).toMatchObject({
      state: 'premium-locked',
      openPaywall: true,
    });
    expect(getCampaignLevelAccess(levelSeven.id, {}, true)).toEqual({
      state: 'sequence-locked',
      canPlay: false,
      openPaywall: false,
      requiresFullGame: true,
    });
  });

  test('requires entitlement to replay completed premium levels', () => {
    const levelSeven = CAMPAIGN_LEVELS[6];
    const progress = progressThrough(7);

    expect(getCampaignLevelAccess(levelSeven.id, progress, false)).toMatchObject({
      state: 'premium-locked',
      canPlay: false,
      openPaywall: true,
    });
    expect(getCampaignLevelAccess(levelSeven.id, progress, true)).toMatchObject({
      state: 'completed',
      canPlay: true,
      openPaywall: false,
    });
  });

  test('keeps every premium level paywall-routable while locked', () => {
    for (const level of CAMPAIGN_LEVELS.slice(FREE_CAMPAIGN_LEVEL_COUNT)) {
      expect(getCampaignLevelAccess(level.id, {}, false)).toMatchObject({
        state: 'premium-locked',
        canPlay: false,
        openPaywall: true,
        requiresFullGame: true,
      });
    }
  });

  test('rejects level IDs outside the authored campaign', () => {
    expect(() => getCampaignLevelAccess('unknown-level', {}, true)).toThrow(
      'Unknown campaign level',
    );
  });
});
