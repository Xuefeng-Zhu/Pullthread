import { render, waitFor } from '@testing-library/react-native';
import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import type { ComponentProps } from 'react';
import MockReact from 'react';
import { View as MockView } from 'react-native';

import { getDailyChallengeForDate } from '../../../game/daily';
import { CAMPAIGN_LEVELS } from '../../../game/levels/campaignLevels';
import { getLevelVersion } from '../../../game/levels/levelLoader';
import {
  useCampaignProgressStore,
  type CampaignLevelProgress,
} from '../../../store/useCampaignProgressStore';
import { useDailyChallengeStore } from '../../../store/useDailyChallengeStore';
import { useEntitlementStore } from '../../../store/useEntitlementStore';
import {
  resetGameStoreForTests,
  useGameStore,
} from '../../../store/useGameStore';
import {
  defaultPreferences,
  usePreferencesStore,
} from '../../../store/usePreferencesStore';
import { SpikeLevelScreen } from '../SpikeLevelScreen';

jest.mock('react-native-purchases', () => ({
  __esModule: true,
  default: {},
  PURCHASES_ERROR_CODE: {
    PURCHASE_CANCELLED_ERROR: 'PURCHASE_CANCELLED_ERROR',
  },
}));

jest.mock('../../../game/runtime/useGameSession', () => ({
  simulateRoute: () => ({
    points: [],
    outcome: { status: 'stuck' },
  }),
  useGameSession: () => ({
    travelerX: { value: 0 },
    travelerY: { value: 0 },
    speed: { value: 0 },
  }),
}));

jest.mock('../../../game/rendering/FabricCanvas', () => ({
  FabricCanvas: () => MockReact.createElement(MockView, {
    testID: 'mock-fabric-canvas',
  }),
}));

jest.mock('../../../game/feedback', () => ({
  ExpoFeedbackService: jest.fn(() => ({
    setPreferences: jest.fn(),
    play: jest.fn(async () => undefined),
    dispose: jest.fn(),
  })),
}));

type ScreenProps = ComponentProps<typeof SpikeLevelScreen>;

function completedLevel(): CampaignLevelProgress {
  return {
    completed: true,
    bestRun: {
      thimbles: 2,
      metrics: {
        threadUsed: 72,
        stitchesUsed: 1,
        completionMs: 3_200,
        collectedPatch: false,
      },
    },
  };
}

function completedThrough(order: number): Record<string, CampaignLevelProgress> {
  return Object.fromEntries(
    CAMPAIGN_LEVELS.slice(0, order).map((level) => [
      level.id,
      completedLevel(),
    ]),
  );
}

function screenHarness(levelId: string) {
  const replace = jest.fn();
  const navigation = {
    replace,
    navigate: jest.fn(),
    popTo: jest.fn(),
  } as unknown as ScreenProps['navigation'];
  const route = {
    key: `SpikeLevel-${levelId}`,
    name: 'SpikeLevel',
    params: { levelId },
  } as ScreenProps['route'];

  return { navigation, replace, route };
}

describe('SpikeLevelScreen direct-route campaign access', () => {
  let startLevel: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    resetGameStoreForTests();
    usePreferencesStore.setState({
      ...defaultPreferences,
      completedTutorialVersion: 1,
    });
    useEntitlementStore.setState({
      hasFullGame: false,
      debugOverride: null,
    });
    useDailyChallengeStore.setState({ challenge: null });
    startLevel = jest.fn();
    useGameStore.setState({ startLevel });
  });

  test('replaces a locked premium direct route with its paywall', async () => {
    const levelSeven = CAMPAIGN_LEVELS[6];
    useCampaignProgressStore.setState({
      progressByLevel: completedThrough(6),
    });
    const harness = screenHarness(levelSeven.id);
    const view = await render(
      <SpikeLevelScreen
        navigation={harness.navigation}
        route={harness.route}
      />,
    );

    expect(view.getByTestId('level-access-guard')).toBeTruthy();
    expect(view.getByText('Opening Full Atelier…')).toBeTruthy();
    await waitFor(() => {
      expect(harness.replace).toHaveBeenCalledWith('Paywall', {
        levelId: levelSeven.id,
      });
    });
    expect(startLevel).not.toHaveBeenCalled();
  });

  test('returns an entitled out-of-sequence direct route to the map', async () => {
    const levelSeven = CAMPAIGN_LEVELS[6];
    useEntitlementStore.setState({ hasFullGame: true });
    const harness = screenHarness(levelSeven.id);
    const view = await render(
      <SpikeLevelScreen
        navigation={harness.navigation}
        route={harness.route}
      />,
    );

    expect(view.getByTestId('level-access-guard')).toBeTruthy();
    expect(view.getByText('Returning to the quilt map…')).toBeTruthy();
    await waitFor(() => {
      expect(harness.replace).toHaveBeenCalledWith('QuiltMap');
    });
    expect(startLevel).not.toHaveBeenCalled();
  });

  test('starts Level 7 when entitlement and predecessor progress are present', async () => {
    const levelSeven = CAMPAIGN_LEVELS[6];
    useCampaignProgressStore.setState({
      progressByLevel: completedThrough(6),
    });
    useEntitlementStore.setState({ hasFullGame: true });
    const harness = screenHarness(levelSeven.id);
    const view = await render(
      <SpikeLevelScreen
        navigation={harness.navigation}
        route={harness.route}
      />,
    );

    expect(view.getByTestId('spike-level-screen')).toBeTruthy();
    expect(view.getByTestId('level-mechanic').props.children).toBe(
      levelSeven.mechanic,
    );
    await waitFor(() => {
      expect(startLevel).toHaveBeenCalledWith(levelSeven.id);
    });
    expect(harness.replace).not.toHaveBeenCalled();
  });

  test('plays the historical Daily level version instead of campaign v2', async () => {
    const challenge = getDailyChallengeForDate('2026-01-01');
    const legacyLevel = getLevelVersion(
      challenge.levelId,
      challenge.levelVersion,
    );
    const campaignLevel = CAMPAIGN_LEVELS.find(
      (level) => level.id === challenge.levelId,
    );
    if (!campaignLevel) throw new Error('Expected a matching campaign level.');
    const harness = screenHarness(challenge.levelId);
    const route = {
      ...harness.route,
      params: {
        levelId: challenge.levelId,
        mode: 'daily',
        challengeId: challenge.id,
      },
    } as ScreenProps['route'];
    useDailyChallengeStore.setState({ challenge });

    const view = await render(
      <SpikeLevelScreen navigation={harness.navigation} route={route} />,
    );

    expect(view.getByTestId('daily-level-screen')).toBeTruthy();
    expect(view.getByTestId('level-mechanic').props.children).toBe(
      legacyLevel.mechanic,
    );
    expect(legacyLevel.mechanic).not.toBe(campaignLevel.mechanic);
    await waitFor(() => {
      expect(startLevel).toHaveBeenCalledWith(challenge.levelId, {
        kind: 'daily',
        challenge,
      });
    });
    expect(harness.replace).not.toHaveBeenCalled();
  });
});
