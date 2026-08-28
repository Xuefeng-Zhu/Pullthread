import { act, fireEvent, render } from '@testing-library/react-native';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from '@jest/globals';
import type { ComponentProps } from 'react';
import MockReact from 'react';
import { AccessibilityInfo, View as MockView } from 'react-native';

import {
  createDailyRun,
  getDailyChallengeForDate,
  type DailyLeaderboardEntry,
} from '../../../game/daily';
import { getCampaignLevel } from '../../../game/levels/levelLoader';
import { createLevelReplay } from '../../../game/replay';
import { useDailyChallengeStore } from '../../../store/useDailyChallengeStore';
import {
  defaultPreferences,
  usePreferencesStore,
} from '../../../store/usePreferencesStore';
import { DailyReplayScreen } from '../DailyReplayScreen';

const mockReplayStage = jest.fn(
  ({ phase, status }: { readonly phase: string; readonly status: string }) =>
    MockReact.createElement(MockView, {
      testID: 'mock-daily-replay-stage',
      accessibilityLabel: `${phase}:${status}`,
    }),
);

jest.mock('../../ResultsScreen/ReplayStage', () => ({
  ReplayStage: (props: { readonly phase: string; readonly status: string }) =>
    mockReplayStage(props),
}));

const challenge = getDailyChallengeForDate('2026-08-27');
const level = getCampaignLevel(challenge.levelId);
const levelReplay = createLevelReplay(level, level.referenceSolution);
const run = createDailyRun(challenge, levelReplay, {
  clientRunId: 'daily-replay-screen-best',
  createdAt: '2026-08-27T12:00:00.000Z',
});
const entry: DailyLeaderboardEntry = Object.freeze({
  id: run.clientRunId,
  rank: 1,
  displayName: 'Quilter 0827',
  metrics: run.metrics,
  replay: run.replay,
  isCurrentPlayer: true,
});

type ScreenProps = ComponentProps<typeof DailyReplayScreen>;

function screenHarness(entryId = entry.id) {
  const goBack = jest.fn();
  const navigation = { goBack } as unknown as ScreenProps['navigation'];
  const route = {
    key: 'DailyReplay-test',
    name: 'DailyReplay',
    params: { challengeId: challenge.id, entryId },
  } as ScreenProps['route'];

  return { goBack, navigation, route };
}

describe('DailyReplayScreen', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    usePreferencesStore.setState({ ...defaultPreferences });
    useDailyChallengeStore.setState({
      challenge,
      leaderboard: [entry],
      personalBest: null,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('opens a leaderboard replay already complete when motion is reduced', async () => {
    usePreferencesStore.setState({ reducedMotionEnabled: true });
    const harness = screenHarness();
    const view = await render(
      <DailyReplayScreen
        navigation={harness.navigation}
        route={harness.route}
      />,
    );

    expect(view.getByText('Quilter 0827 · #1')).toBeTruthy();
    expect(
      view.getByTestId('mock-daily-replay-stage').props.accessibilityLabel,
    ).toBe('succeeded:complete');

    await fireEvent.press(view.getByTestId('daily-replay-back-button'));
    expect(harness.goBack).toHaveBeenCalledTimes(1);
  });

  test('finishes an active replay when the OS reduced-motion query resolves', async () => {
    jest.useFakeTimers();
    let resolveReducedMotion!: (enabled: boolean) => void;
    let emitReducedMotion!: (enabled: boolean) => void;
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            resolveReducedMotion = resolve;
          }),
      );
    jest
      .spyOn(AccessibilityInfo, 'addEventListener')
      .mockImplementation(((eventName, handler) => {
        if (eventName === 'reduceMotionChanged') {
          emitReducedMotion = handler as (enabled: boolean) => void;
        }
        return { remove: jest.fn() } as unknown as ReturnType<
          typeof AccessibilityInfo.addEventListener
        >;
      }) as typeof AccessibilityInfo.addEventListener);
    const harness = screenHarness();
    const view = await render(
      <DailyReplayScreen
        navigation={harness.navigation}
        route={harness.route}
      />,
    );

    expect(
      view.getByTestId('mock-daily-replay-stage').props.accessibilityLabel,
    ).toBe('running:playing');

    await act(async () => {
      resolveReducedMotion(true);
    });

    expect(
      view.getByTestId('mock-daily-replay-stage').props.accessibilityLabel,
    ).toBe('succeeded:complete');

    await act(async () => {
      jest.runOnlyPendingTimers();
    });

    await act(() => emitReducedMotion(false));
    expect(
      view.getByTestId('mock-daily-replay-stage').props.accessibilityLabel,
    ).toBe('succeeded:complete');
  });

  test('fails safely when a replay entry is no longer available', async () => {
    useDailyChallengeStore.setState({ leaderboard: [] });
    const harness = screenHarness('missing-entry');
    const view = await render(
      <DailyReplayScreen
        navigation={harness.navigation}
        route={harness.route}
      />,
    );

    expect(view.getAllByText('Replay unavailable')).toHaveLength(2);
    expect(
      view.getByText('This compact stitch replay could not be loaded safely.'),
    ).toBeTruthy();
    expect(view.queryByTestId('mock-daily-replay-stage')).toBeNull();
  });

  test('plays the personal best even when it is outside the leaderboard', async () => {
    useDailyChallengeStore.setState({
      leaderboard: [],
      personalBest: run,
    });
    const harness = screenHarness(run.clientRunId);
    const view = await render(
      <DailyReplayScreen
        navigation={harness.navigation}
        route={harness.route}
      />,
    );

    expect(view.getByText('Your best')).toBeTruthy();
    expect(view.getByTestId('mock-daily-replay-stage')).toBeTruthy();
  });
});
