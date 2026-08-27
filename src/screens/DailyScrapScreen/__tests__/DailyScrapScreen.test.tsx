import {
  act,
  fireEvent,
  render,
  waitFor,
  within,
} from '@testing-library/react-native';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from '@jest/globals';
import type { ComponentProps } from 'react';

import {
  createDailyRun,
  DailyCatalogUpdateRequiredError,
  getDailyChallengeForDate,
  type DailyLeaderboardEntry,
  type DailyRun,
} from '../../../game/daily';
import { getCampaignLevel } from '../../../game/levels/levelLoader';
import { createLevelReplay } from '../../../game/replay';
import type {
  DailyChallengeService,
  DailySubmissionResult,
} from '../../../services/dailyChallenges';
import { resetDailyChallengeStoreForTests } from '../../../store/useDailyChallengeStore';
import {
  resetGameStoreForTests,
  useGameStore,
} from '../../../store/useGameStore';
import { DailyScrapScreen } from '../DailyScrapScreen';

const challenge = getDailyChallengeForDate('2026-08-27');
const nextChallenge = getDailyChallengeForDate('2026-08-28');
const level = getCampaignLevel(challenge.levelId);
const replay = createLevelReplay(level, level.referenceSolution);
const personalBest = createDailyRun(challenge, replay, {
  clientRunId: 'daily-ui-current-best',
  createdAt: '2026-08-27T12:00:00.000Z',
});
const currentEntry: DailyLeaderboardEntry = Object.freeze({
  id: personalBest.clientRunId,
  rank: 1,
  displayName: 'Quilter 0827',
  metrics: personalBest.metrics,
  replay: personalBest.replay,
  isCurrentPlayer: true,
});
const replayUnavailableEntry: DailyLeaderboardEntry = Object.freeze({
  ...currentEntry,
  id: 'daily-ui-replay-unavailable',
  rank: 2,
  displayName: 'Loose Thread',
  replay: null,
  isCurrentPlayer: false,
});

type ScreenProps = ComponentProps<typeof DailyScrapScreen>;

function dailyService(
  overrides: Partial<DailyChallengeService> = {},
): DailyChallengeService {
  return {
    kind: 'local',
    status: 'local',
    getTodayChallenge: jest.fn(async () => challenge),
    submitRun: jest.fn(
      async (run: DailyRun): Promise<DailySubmissionResult> => ({
        accepted: true,
        isNewBest: true,
        personalBest: run,
        syncStatus: 'local',
        message: 'Saved on this device.',
      }),
    ),
    getPersonalBest: jest.fn(async () => null),
    getLeaderboard: jest.fn(async () => []),
    ...overrides,
  };
}

function screenHarness() {
  const navigate = jest.fn();
  const goBack = jest.fn();
  const listeners: Partial<Record<'blur' | 'focus', () => void>> = {};
  const addListener = jest.fn(
    (event: 'blur' | 'focus', listener: () => void) => {
      listeners[event] = listener;
      return () => {
        if (listeners[event] === listener) delete listeners[event];
      };
    },
  );
  const navigation = {
    navigate,
    goBack,
    addListener,
  } as unknown as ScreenProps['navigation'];
  const route = {
    key: 'DailyScrap-test',
    name: 'DailyScrap',
  } as ScreenProps['route'];

  return {
    addListener,
    emitBlur: () => listeners.blur?.(),
    emitFocus: () => listeners.focus?.(),
    goBack,
    navigate,
    navigation,
    route,
  };
}

describe('DailyScrapScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetGameStoreForTests();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('renders a local personal best and opens play and replay routes', async () => {
    const service = dailyService({
      getLeaderboard: jest.fn(async () => [currentEntry]),
    });
    resetDailyChallengeStoreForTests(service);
    const harness = screenHarness();
    const view = await render(
      <DailyScrapScreen
        navigation={harness.navigation}
        route={harness.route}
      />,
    );

    await waitFor(() => {
      expect(view.getByText(challenge.title)).toBeTruthy();
      expect(view.getByText('TRY AGAIN')).toBeTruthy();
    });

    expect(view.getByText(`${challenge.challengeDate} UTC`)).toBeTruthy();
    expect(
      view.getByText('Lowest wins: thread, then stitches, then time.'),
    ).toBeTruthy();
    expect(view.getByTestId('daily-scrap-status').props.children).toBe(
      'LOCAL BOARD — Remote leaderboard is not configured.',
    );
    expect(
      within(view.getByTestId('daily-scrap-personal-best')).getByText(
        `${personalBest.metrics.threadUsed} thread`,
      ),
    ).toBeTruthy();

    const entry = view.getByTestId(
      `daily-leaderboard-entry-${currentEntry.id}`,
    );
    expect(entry.props.accessibilityLabel).toContain(
      `Rank 1, ${currentEntry.displayName}`,
    );
    expect(entry.props.accessibilityLabel).toContain('Watch replay.');

    await fireEvent.press(view.getByTestId('daily-scrap-play-button'));

    expect(harness.navigate).toHaveBeenCalledWith('SpikeLevel', {
      levelId: challenge.levelId,
      mode: 'daily',
      challengeId: challenge.id,
    });
    expect(useGameStore.getState()).toMatchObject({
      activeLevelId: challenge.levelId,
      activeSession: {
        kind: 'daily',
        challenge: { id: challenge.id },
      },
      phase: 'planning',
    });

    await fireEvent.press(entry);

    expect(harness.navigate).toHaveBeenCalledWith('DailyReplay', {
      challengeId: challenge.id,
      entryId: currentEntry.id,
    });
  });

  test('shows an empty local board while keeping today playable', async () => {
    resetDailyChallengeStoreForTests(dailyService());
    const harness = screenHarness();
    const view = await render(
      <DailyScrapScreen
        navigation={harness.navigation}
        route={harness.route}
      />,
    );

    await waitFor(() => {
      expect(view.getByTestId('daily-leaderboard-empty')).toBeTruthy();
    });

    expect(
      within(view.getByTestId('daily-scrap-personal-best')).getByText(
        'Complete today’s pattern to set your first result.',
      ),
    ).toBeTruthy();
    expect(view.getByText('PLAY TODAY’S SCRAP')).toBeTruthy();

    await fireEvent.press(view.getByTestId('daily-scrap-play-button'));
    expect(harness.navigate).toHaveBeenCalledWith(
      'SpikeLevel',
      expect.objectContaining({ mode: 'daily', challengeId: challenge.id }),
    );
  });

  test('opens the personal-best replay when the shared board omits the player', async () => {
    const otherEntry: DailyLeaderboardEntry = Object.freeze({
      ...currentEntry,
      id: 'daily-ui-other-player',
      displayName: 'Remote Quilter',
      isCurrentPlayer: false,
    });
    resetDailyChallengeStoreForTests(
      dailyService({
        kind: 'firebase',
        status: 'remote',
        getPersonalBest: jest.fn(async () => personalBest),
        getLeaderboard: jest.fn(async () => [otherEntry]),
      }),
    );
    const harness = screenHarness();
    const view = await render(
      <DailyScrapScreen
        navigation={harness.navigation}
        route={harness.route}
      />,
    );

    const replayButton = await view.findByTestId(
      'daily-personal-best-replay-button',
    );
    expect(
      view.queryByTestId(`daily-leaderboard-entry-${personalBest.clientRunId}`),
    ).toBeNull();

    await fireEvent.press(replayButton);
    expect(harness.navigate).toHaveBeenCalledWith('DailyReplay', {
      challengeId: challenge.id,
      entryId: personalBest.clientRunId,
    });
  });

  test('retries a challenge preparation failure without trapping navigation', async () => {
    let challengeRequests = 0;
    const getTodayChallenge = jest.fn(async () => {
      challengeRequests += 1;
      if (challengeRequests === 1) throw new Error('local cache unavailable');
      return challenge;
    });
    resetDailyChallengeStoreForTests(dailyService({ getTodayChallenge }));
    const harness = screenHarness();
    const view = await render(
      <DailyScrapScreen
        navigation={harness.navigation}
        route={harness.route}
      />,
    );

    await waitFor(() => {
      expect(
        view.getByText('Today’s scrap could not be prepared. Try again.'),
      ).toBeTruthy();
    });
    expect(view.queryByTestId('daily-scrap-play-button')).toBeNull();

    await fireEvent.press(view.getByTestId('daily-scrap-back-button'));
    expect(harness.goBack).toHaveBeenCalledTimes(1);

    await fireEvent.press(view.getByTestId('daily-scrap-retry-button'));
    await waitFor(() => expect(view.getByText(challenge.title)).toBeTruthy());
    expect(getTodayChallenge).toHaveBeenCalledTimes(2);
  });

  test('requires an app update without offering an invalid retry or play action', async () => {
    resetDailyChallengeStoreForTests(
      dailyService({
        getTodayChallenge: jest.fn(async () => {
          throw new DailyCatalogUpdateRequiredError('2028-01-01');
        }),
      }),
    );
    const harness = screenHarness();
    const view = await render(
      <DailyScrapScreen
        navigation={harness.navigation}
        route={harness.route}
      />,
    );

    await waitFor(() => {
      expect(view.getByTestId('daily-scrap-update-required')).toBeTruthy();
    });
    expect(
      view.getByText('Update Pullthread to load today’s Daily Scrap.'),
    ).toBeTruthy();
    expect(view.queryByTestId('daily-scrap-play-button')).toBeNull();
    expect(view.queryByTestId('daily-scrap-retry-button')).toBeNull();
  });

  test('announces challenge loading as busy', async () => {
    let resolveChallenge!: (value: typeof challenge) => void;
    const pendingChallenge = new Promise<typeof challenge>((resolve) => {
      resolveChallenge = resolve;
    });
    resetDailyChallengeStoreForTests(
      dailyService({
        getTodayChallenge: jest.fn(() => pendingChallenge),
      }),
    );
    const harness = screenHarness();
    const view = await render(
      <DailyScrapScreen
        navigation={harness.navigation}
        route={harness.route}
      />,
    );

    await waitFor(() => {
      expect(view.getByTestId('daily-scrap-loading')).toBeTruthy();
    });
    expect(view.getByTestId('daily-scrap-loading').props).toMatchObject({
      accessibilityLabel: 'Preparing today’s Daily Scrap',
      accessibilityState: { busy: true },
    });

    resolveChallenge(challenge);
    await waitFor(() => expect(view.getByText(challenge.title)).toBeTruthy());
  });

  test('describes a missing leaderboard replay and keeps its row disabled', async () => {
    resetDailyChallengeStoreForTests(
      dailyService({
        getLeaderboard: jest.fn(async () => [replayUnavailableEntry]),
      }),
    );
    const harness = screenHarness();
    const view = await render(
      <DailyScrapScreen
        navigation={harness.navigation}
        route={harness.route}
      />,
    );

    const entry = await view.findByTestId(
      `daily-leaderboard-entry-${replayUnavailableEntry.id}`,
    );
    expect(entry.props.accessibilityLabel).toContain('Replay unavailable.');
    expect(entry.props.accessibilityState).toEqual({ disabled: true });

    await fireEvent.press(entry);
    expect(harness.navigate).not.toHaveBeenCalledWith(
      'DailyReplay',
      expect.anything(),
    );
  });

  test('shows saved standings offline and refreshes only the board', async () => {
    const getTodayChallenge = jest.fn(async () => challenge);
    const getLeaderboard = jest.fn(async () => [currentEntry]);
    resetDailyChallengeStoreForTests(
      dailyService({
        kind: 'firebase',
        status: 'offline',
        getTodayChallenge,
        getLeaderboard,
      }),
    );
    const harness = screenHarness();
    const view = await render(
      <DailyScrapScreen
        navigation={harness.navigation}
        route={harness.route}
      />,
    );

    await waitFor(() => {
      expect(view.getByTestId('daily-leaderboard-retry-button')).toBeTruthy();
    });
    expect(view.getByTestId('daily-scrap-status').props.children).toBe(
      'Showing saved standings. Today’s challenge still works offline.',
    );

    await fireEvent.press(view.getByTestId('daily-leaderboard-retry-button'));

    await waitFor(() => expect(getLeaderboard).toHaveBeenCalledTimes(2));
    expect(getTodayChallenge).toHaveBeenCalledTimes(1);
    expect(view.getByTestId('daily-scrap-play-button')).toBeTruthy();
  });

  test('reloads the canonical challenge whenever the screen regains focus', async () => {
    const getTodayChallenge = jest.fn(async () => challenge);
    resetDailyChallengeStoreForTests(
      dailyService({ getTodayChallenge }),
    );
    const harness = screenHarness();
    const view = await render(
      <DailyScrapScreen
        navigation={harness.navigation}
        route={harness.route}
      />,
    );

    await waitFor(() => expect(getTodayChallenge).toHaveBeenCalledTimes(1));

    await act(async () => {
      harness.emitBlur();
      harness.emitFocus();
      await Promise.resolve();
    });

    await waitFor(() => expect(getTodayChallenge).toHaveBeenCalledTimes(2));
    expect(view.getByText(challenge.title)).toBeTruthy();
  });

  test('rolls over to the next UTC challenge while the screen stays focused', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-27T23:59:59.900Z'));
    let request = 0;
    const getTodayChallenge = jest.fn(async () => {
      request += 1;
      return request === 1 ? challenge : nextChallenge;
    });
    resetDailyChallengeStoreForTests(
      dailyService({ getTodayChallenge }),
    );
    const harness = screenHarness();
    const view = await render(
      <DailyScrapScreen
        navigation={harness.navigation}
        route={harness.route}
      />,
    );

    await waitFor(() => expect(view.getByText(challenge.title)).toBeTruthy());

    await act(async () => {
      jest.advanceTimersByTime(150);
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(getTodayChallenge).toHaveBeenCalledTimes(2);
      expect(
        view.getByText(`${nextChallenge.challengeDate} UTC`),
      ).toBeTruthy();
    });
    expect(view.queryByText(`${challenge.challengeDate} UTC`)).toBeNull();
    view.unmount();
  });
});
