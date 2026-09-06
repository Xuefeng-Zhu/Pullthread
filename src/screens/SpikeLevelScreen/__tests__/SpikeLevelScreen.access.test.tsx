import {
  act,
  fireEvent,
  render,
  waitFor,
} from '@testing-library/react-native';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from '@jest/globals';
import { useIsFocused } from '@react-navigation/native';
import type { ComponentProps } from 'react';
import MockReact from 'react';
import { AccessibilityInfo, View as MockView } from 'react-native';
import { State } from 'react-native-gesture-handler';
import {
  fireGestureHandler,
  getByGestureTestId,
} from 'react-native-gesture-handler/jest-utils';

import { getDailyChallengeForDate } from '../../../game/daily';
import { CAMPAIGN_LEVELS } from '../../../game/levels/campaignLevels';
import { getLevelVersion } from '../../../game/levels/levelLoader';
import { useGameSession } from '../../../game/runtime/useGameSession';
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
import {
  challengeRequirementsCopy,
  SpikeLevelScreen,
} from '../SpikeLevelScreen';

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual<typeof import('@react-navigation/native')>(
    '@react-navigation/native',
  ),
  useIsFocused: jest.fn(() => true),
}));

const mockUseIsFocused = jest.mocked(useIsFocused);

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
  useGameSession: jest.fn(() => ({
    travelerX: { value: 0 },
    travelerY: { value: 0 },
    speed: { value: 0 },
  })),
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

function drawFullCanvasStitch(): void {
  fireGestureHandler(getByGestureTestId('stitch-draw-gesture'), [
    { state: State.BEGAN, x: 0, y: 0 },
    { state: State.ACTIVE, x: 300, y: 450 },
    { state: State.END, x: 300, y: 450 },
  ]);
}

describe('SpikeLevelScreen direct-route campaign access', () => {
  let startLevel: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseIsFocused.mockReturnValue(true);
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

  afterEach(() => {
    jest.restoreAllMocks();
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

  test('renders an authored route objective as wrapping accessible copy', async () => {
    const objectiveLevel = CAMPAIGN_LEVELS.find(
      (level) =>
        level.completionRequirements?.requiredStitchTypes?.length &&
        level.completionRequirements.requiredFabricTypes?.length &&
        level.completionRequirements.requiredBumperIds?.length,
    );
    if (!objectiveLevel?.completionRequirements) {
      throw new Error('Expected an authored completion requirement.');
    }
    useCampaignProgressStore.setState({
      progressByLevel: completedThrough(objectiveLevel.order - 1),
    });
    useEntitlementStore.setState({ hasFullGame: true });
    const harness = screenHarness(objectiveLevel.id);

    const view = await render(
      <SpikeLevelScreen
        navigation={harness.navigation}
        route={harness.route}
      />,
    );

    const expectedRequirements = challengeRequirementsCopy(
      objectiveLevel.completionRequirements,
    );
    expect(expectedRequirements).not.toBeNull();
    expect(view.getByTestId('level-requirements').props.children).toBe(
      expectedRequirements,
    );
    expect(view.getByTestId('level-requirements').props.numberOfLines).toBe(
      undefined,
    );
    expect(view.getByTestId('level-mechanic').props.numberOfLines).toBe(
      undefined,
    );
    expect(view.getByTestId('route-objective').props).toMatchObject({
      accessible: true,
    });
    const accessibilityLabel = view.getByTestId('route-objective').props
      .accessibilityLabel as string;
    expect(accessibilityLabel).toContain(`Challenge. ${objectiveLevel.mechanic}`);
    expect(accessibilityLabel).toContain('use pinch and pocket stitches');
    expect(accessibilityLabel).toContain(
      'make the traveler ride every stitch',
    );
    expect(accessibilityLabel).toContain('travel over silk, felt, and elastic');
    expect(accessibilityLabel).toContain('hit the required bumper');
  });

  test('explains and announces a rejected stitch-limit placement', async () => {
    const level = CAMPAIGN_LEVELS[0];
    const existingStitches = Array.from(
      { length: level.maxStitches },
      (_, index) => ({
        ...level.referenceSolution[0],
        id: `limit-fixture-${index}`,
      }),
    );
    useGameStore.setState({
      activeLevelId: level.id,
      phase: 'planning',
      stitches: existingStitches,
    });
    const announce = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation(() => undefined);
    const harness = screenHarness(level.id);
    const view = await render(
      <SpikeLevelScreen
        navigation={harness.navigation}
        route={harness.route}
      />,
    );

    await act(() => {
      fireEvent(view.getByTestId('fabric-playfield'), 'layout', {
        nativeEvent: { layout: { width: 300, height: 450 } },
      });
      drawFullCanvasStitch();
    });

    const message = `Stitch limit reached: ${level.maxStitches} of ${level.maxStitches}. Undo or reset before adding another.`;
    expect(view.getByTestId('planning-status').props.children).toBe(message);
    expect(announce).toHaveBeenCalledWith(message);
    expect(useGameStore.getState().stitches).toHaveLength(level.maxStitches);
  });

  test('reports the actual thread overage instead of clamping the attempt', async () => {
    const level = CAMPAIGN_LEVELS.find(
      (candidate) => candidate.maxStitches >= 2,
    );
    if (!level) throw new Error('Expected a level that allows two stitches.');
    const remainingThread = 5;
    const existingThread = level.threadBudget - remainingThread;
    const existingStitch = {
      ...level.referenceSolution[0],
      id: 'thread-budget-fixture',
      threadCost: existingThread,
    };
    useCampaignProgressStore.setState({
      progressByLevel: completedThrough(level.order - 1),
    });
    useEntitlementStore.setState({ hasFullGame: true });
    useGameStore.setState({
      activeLevelId: level.id,
      phase: 'planning',
      stitches: [existingStitch],
    });
    const announce = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation(() => undefined);
    const harness = screenHarness(level.id);
    const view = await render(
      <SpikeLevelScreen
        navigation={harness.navigation}
        route={harness.route}
      />,
    );

    await act(() => {
      fireEvent(view.getByTestId('fabric-playfield'), 'layout', {
        nativeEvent: { layout: { width: 300, height: 450 } },
      });
      drawFullCanvasStitch();
    });

    const attemptedThread = existingThread + 181;
    const message = `Thread budget exceeded by ${
      attemptedThread - level.threadBudget
    }: attempted ${attemptedThread} of ${
      level.threadBudget
    }. Shorten the stitch or undo one.`;
    expect(view.getByTestId('planning-status').props.children).toBe(message);
    expect(announce).toHaveBeenCalledWith(message);
    expect(useGameStore.getState().stitches).toHaveLength(1);
  });

  test('opens Results as soon as the active level succeeds', async () => {
    const firstLevel = CAMPAIGN_LEVELS[0];
    const harness = screenHarness(firstLevel.id);

    await render(
      <SpikeLevelScreen
        navigation={harness.navigation}
        route={harness.route}
      />,
    );
    const sessionOptions = jest.mocked(useGameSession).mock.calls.at(-1)?.[0];
    if (!sessionOptions) throw new Error('Expected an active game session.');

    await act(() => {
      useGameStore.setState({
        phase: 'running',
        stitches: [...firstLevel.referenceSolution],
      });
      sessionOptions.onOutcome({
        status: 'success',
        tick: 130,
        completionMs: 1_300,
      });
    });

    expect(useGameStore.getState().completedRun).toMatchObject({
      levelId: firstLevel.id,
      outcome: { status: 'success' },
    });
    await waitFor(() => {
      expect(harness.navigation.navigate).toHaveBeenCalledWith('Results');
    });
  });

  test('keeps a failed run on the level for retry', async () => {
    const firstLevel = CAMPAIGN_LEVELS[0];
    const harness = screenHarness(firstLevel.id);

    await render(
      <SpikeLevelScreen
        navigation={harness.navigation}
        route={harness.route}
      />,
    );
    const sessionOptions = jest.mocked(useGameSession).mock.calls.at(-1)?.[0];
    if (!sessionOptions) throw new Error('Expected an active game session.');

    await act(() => {
      useGameStore.setState({ phase: 'running' });
      sessionOptions.onOutcome({
        status: 'failure',
        reason: 'stuck',
        tick: 240,
        completionMs: 2_400,
      });
    });

    expect(useGameStore.getState()).toMatchObject({
      phase: 'failed',
      completedRun: null,
    });
    expect(harness.navigation.navigate).not.toHaveBeenCalledWith('Results');
  });

  test('does not let a blurred level overwrite the active next level', async () => {
    const firstLevel = CAMPAIGN_LEVELS[0];
    const nextLevel = CAMPAIGN_LEVELS[1];
    const harness = screenHarness(firstLevel.id);
    mockUseIsFocused.mockReturnValue(false);

    await render(
      <SpikeLevelScreen
        navigation={harness.navigation}
        route={harness.route}
      />,
    );

    await act(() => {
      useGameStore.setState({ activeLevelId: nextLevel.id });
    });

    expect(startLevel).not.toHaveBeenCalled();
    expect(useGameStore.getState()).toMatchObject({
      activeLevelId: nextLevel.id,
      phase: 'planning',
      completedRun: null,
    });
  });

  test('plays the historical Daily level version instead of the current campaign', async () => {
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
