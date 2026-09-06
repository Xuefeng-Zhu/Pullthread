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
import MockReact from 'react';
import { View as MockView } from 'react-native';

import type { SimulationOutcome } from '../../../game/core/types';
import {
  createDailyRun,
  getDailyChallengeForDate,
} from '../../../game/daily';
import {
  REFERENCE_PINCH_STITCH,
  SPIKE_LEVEL,
} from '../../../game/levels/spikeLevel';
import { CAMPAIGN_LEVELS } from '../../../game/levels/campaignLevels';
import { getLevelVersion } from '../../../game/levels/levelLoader';
import {
  createLevelReplay,
  createSpikeReplay,
  simulateLevelReplay,
  simulateSpikeReplay,
} from '../../../game/replay';
import {
  type CampaignLevelProgress,
  useCampaignProgressStore,
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
  ResultsScreen,
  type ResultsScreenProps,
} from '../ResultsScreen';

const mockUseGameSession = jest.fn((_options: unknown) => ({
  travelerX: { value: 0 },
  travelerY: { value: 0 },
  speed: { value: 0 },
}));

jest.mock('../../../game/runtime/useGameSession', () => ({
  useGameSession: (options: unknown) => mockUseGameSession(options),
}));

jest.mock('../../../game/rendering/FabricCanvas', () => {
  return {
    FabricCanvas: ({ highContrast }: { highContrast?: boolean }) =>
      MockReact.createElement(MockView, {
        testID: 'mock-fabric-canvas',
        accessibilityLabel: highContrast
          ? 'high contrast'
          : 'standard contrast',
      }),
  };
});

function successfulOutcome(): Extract<SimulationOutcome, { status: 'success' }> {
  const outcome = simulateSpikeReplay(
    createSpikeReplay([REFERENCE_PINCH_STITCH]),
  ).outcome;
  if (outcome.status !== 'success') {
    throw new Error('The reference replay must succeed.');
  }
  return outcome;
}

function seedCompletedRun() {
  const replay = createSpikeReplay([REFERENCE_PINCH_STITCH]);
  const outcome = successfulOutcome();
  useGameStore.setState({
    phase: 'succeeded',
    stitches: [REFERENCE_PINCH_STITCH],
    outcome,
    completedRun: {
      levelId: SPIKE_LEVEL.id,
      replay,
      outcome,
      isNewBest: true,
      bestMetrics: {
        threadUsed: replay.stitches[0].threadCost,
        stitchesUsed: replay.stitches.length,
        completionMs: outcome.completionMs,
        collectedPatch: false,
      },
      scoredRun: {
        thimbles: 2,
        metrics: {
          threadUsed: replay.stitches[0].threadCost,
          stitchesUsed: replay.stitches.length,
          completionMs: outcome.completionMs,
          collectedPatch: false,
        },
      },
    },
  });
  useCampaignProgressStore.setState({ progressByLevel: completedThrough(1) });
  return { replay, outcome };
}

function seedCompletedRunForLevel(levelIndex: number) {
  const level = CAMPAIGN_LEVELS[levelIndex];
  const replay = createLevelReplay(level, level.referenceSolution);
  const outcome = simulateLevelReplay(replay).outcome;
  if (outcome.status !== 'success') {
    throw new Error(`${level.name}'s reference replay must succeed.`);
  }
  const threadUsed = replay.stitches.reduce(
    (total, stitch) => total + stitch.threadCost,
    0,
  );
  const metrics = {
    threadUsed,
    stitchesUsed: replay.stitches.length,
    completionMs: outcome.completionMs,
    collectedPatch: false,
  } as const;

  useGameStore.setState({
    activeLevelId: level.id,
    phase: 'succeeded',
    stitches: [...level.referenceSolution],
    outcome,
    completedRun: {
      levelId: level.id,
      replay,
      outcome,
      isNewBest: true,
      bestMetrics: metrics,
      scoredRun: { thimbles: 2, metrics },
    },
  });
}

function seedDailyCompletedRun() {
  const challenge = getDailyChallengeForDate('2026-08-27');
  const level = getLevelVersion(
    challenge.levelId,
    challenge.levelVersion,
  );
  const replay = createLevelReplay(level, level.referenceSolution);
  const outcome = simulateLevelReplay(replay).outcome;
  if (outcome.status !== 'success') {
    throw new Error('The Daily Scrap reference replay must succeed.');
  }
  const threadUsed = replay.stitches.reduce(
    (total, stitch) => total + stitch.threadCost,
    0,
  );
  const metrics = {
    threadUsed,
    stitchesUsed: replay.stitches.length,
    completionMs: outcome.completionMs,
    collectedPatch: false,
  } as const;
  const personalBest = createDailyRun(challenge, replay, {
    clientRunId: 'daily-results-current-best',
    createdAt: '2026-08-27T12:00:00.000Z',
  });

  useDailyChallengeStore.setState({
    challenge,
    submitStatus: 'saved',
    statusMessage: 'Saved on this device.',
    personalBest,
    latestSubmission: null,
  });
  useGameStore.setState({
    activeLevelId: level.id,
    activeSession: { kind: 'daily', challenge },
    phase: 'succeeded',
    stitches: [...level.referenceSolution],
    outcome,
    completedRun: {
      session: { kind: 'daily', challenge },
      levelId: level.id,
      replay,
      outcome,
      isNewBest: true,
      bestMetrics: metrics,
      scoredRun: { thimbles: 2, metrics },
    },
    bestRun: metrics,
  });

  return { challenge, level, personalBest };
}

function completedThrough(levelCount: number) {
  const progress: Record<string, CampaignLevelProgress> = {};

  for (const level of CAMPAIGN_LEVELS.slice(0, levelCount)) {
    progress[level.id] = {
      completed: true,
      bestRun: {
        thimbles: 2,
        metrics: {
          threadUsed: level.targetThreadUsage,
          stitchesUsed: level.referenceSolution.length,
          completionMs: 1_000,
          collectedPatch: false,
        },
      },
    };
  }

  return progress;
}

function navigation() {
  const navigate = jest.fn();
  const popTo = jest.fn();
  return {
    navigate,
    popTo,
    value: { navigate, popTo } as unknown as ResultsScreenProps['navigation'],
  };
}

describe('ResultsScreen', () => {
  beforeEach(() => {
    resetGameStoreForTests();
    useCampaignProgressStore.setState({ progressByLevel: {} });
    useEntitlementStore.setState({ hasFullGame: false, debugOverride: null });
    usePreferencesStore.setState({ ...defaultPreferences });
    mockUseGameSession.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('shows exact result copy and metrics from the captured run', async () => {
    const { replay, outcome } = seedCompletedRun();
    const nav = navigation();
    const view = await render(<ResultsScreen navigation={nav.value} />);

    expect(view.getByText('Perfect pull!')).toBeTruthy();
    expect(view.getByText('First Pull is sewn into the quilt.')).toBeTruthy();
    expect(view.getByText('REPLAY READY')).toBeTruthy();
    expect(view.getByText('NEW BEST')).toBeTruthy();
    expect(view.getByTestId('results-thimbles').props.accessibilityLabel).toBe(
      '2 of 2 thimbles earned',
    );
    expect(view.getByTestId('thread-result').props.children).toBe(
      `${replay.stitches[0].threadCost} / 120`,
    );
    expect(view.getByTestId('stitches-result').props.children).toBe('1 / 2');
    expect(view.getByTestId('time-result').props.children).toBe(
      `${(outcome.completionMs / 1000).toFixed(1)}s`,
    );

    const sessionOptions = mockUseGameSession.mock.calls.at(-1)?.[0] as {
      stitches: readonly unknown[];
      phase: string;
    };
    expect(sessionOptions.stitches).toEqual(replay.stitches);
    expect(sessionOptions.phase).toBe('succeeded');
  });

  test('runs the captured replay repeatedly and applies display preferences', async () => {
    const { outcome } = seedCompletedRun();
    usePreferencesStore.setState({ highContrastEnabled: true });
    const nav = navigation();
    const view = await render(<ResultsScreen navigation={nav.value} />);

    expect(view.getByTestId('mock-fabric-canvas').props.accessibilityLabel).toBe(
      'high contrast',
    );

    await fireEvent.press(view.getByTestId('watch-replay-button'));
    expect(view.getByText('TIGHTENING THREAD')).toBeTruthy();
    expect(
      view.getByTestId('watch-replay-button').props.accessibilityState,
    ).toEqual({ disabled: true });
    expect(
      view.getByTestId('results-settings-button').props.accessibilityState,
    ).toEqual({ disabled: true });

    await waitFor(() => expect(view.getByText('WATCHING REPLAY')).toBeTruthy());

    const playingOptions = mockUseGameSession.mock.calls.at(-1)?.[0] as {
      onOutcome: (next: SimulationOutcome) => void;
      phase: string;
    };
    expect(playingOptions.phase).toBe('running');
    await act(async () => {
      playingOptions.onOutcome(outcome);
    });
    expect(view.getByText('REPLAY COMPLETE')).toBeTruthy();
    expect(view.getByTestId('replay-stage').props.accessibilityLabel).toBe(
      'Deterministic replay of the completed pull. REPLAY COMPLETE',
    );

    await fireEvent.press(view.getByTestId('watch-replay-button'));
    expect(view.getByText('TIGHTENING THREAD')).toBeTruthy();
    await waitFor(() => expect(view.getByText('WATCHING REPLAY')).toBeTruthy());
    expect(
      (mockUseGameSession.mock.calls.at(-1)?.[0] as { phase: string }).phase,
    ).toBe('running');
  });

  test('reduced motion resolves Watch Replay without starting animation', async () => {
    seedCompletedRun();
    usePreferencesStore.setState({ reducedMotionEnabled: true });
    const nav = navigation();
    const view = await render(<ResultsScreen navigation={nav.value} />);

    await fireEvent.press(view.getByTestId('watch-replay-button'));

    await waitFor(() => {
      expect(view.getByText('REPLAY COMPLETE')).toBeTruthy();
      expect(
        (mockUseGameSession.mock.calls.at(-1)?.[0] as { phase: string }).phase,
      ).toBe('succeeded');
    });
  });

  test('stops an active replay when reduced motion becomes enabled', async () => {
    jest.useFakeTimers();
    seedCompletedRun();
    const nav = navigation();
    const view = await render(<ResultsScreen navigation={nav.value} />);

    await fireEvent.press(view.getByTestId('watch-replay-button'));
    expect(view.getByText('TIGHTENING THREAD')).toBeTruthy();

    await act(async () => {
      usePreferencesStore.setState({ reducedMotionEnabled: true });
    });
    await act(async () => {
      jest.runOnlyPendingTimers();
    });

    expect(view.getByText('REPLAY COMPLETE')).toBeTruthy();
    expect(
      (mockUseGameSession.mock.calls.at(-1)?.[0] as { phase: string }).phase,
    ).toBe('succeeded');
    expect(
      view.getByTestId('results-settings-button').props.accessibilityState,
    ).toEqual({ disabled: false });
    jest.useRealTimers();
  });

  test('resets gameplay before returning and keeps Settings separate', async () => {
    seedCompletedRun();
    const nav = navigation();
    const view = await render(<ResultsScreen navigation={nav.value} />);

    await fireEvent.press(view.getByTestId('results-settings-button'));
    expect(nav.navigate).toHaveBeenCalledWith('Settings');
    expect(useGameStore.getState().completedRun).not.toBeNull();

    await fireEvent.press(view.getByTestId('try-again-button'));
    expect(useGameStore.getState()).toMatchObject({
      phase: 'planning',
      stitches: [],
      outcome: null,
      completedRun: null,
    });
    expect(nav.popTo).toHaveBeenCalledWith('SpikeLevel', {
      levelId: SPIKE_LEVEL.id,
    });
  });

  test('preserves premium Results and opens Paywall when entitlement is lost', async () => {
    seedCompletedRunForLevel(6);
    useCampaignProgressStore.setState({ progressByLevel: completedThrough(7) });
    const nav = navigation();
    const view = await render(<ResultsScreen navigation={nav.value} />);

    await fireEvent.press(view.getByTestId('try-again-button'));

    expect(nav.navigate).toHaveBeenCalledWith('Paywall', {
      levelId: CAMPAIGN_LEVELS[6].id,
    });
    expect(nav.popTo).not.toHaveBeenCalledWith('SpikeLevel', expect.anything());
    expect(useGameStore.getState().completedRun?.levelId).toBe(
      CAMPAIGN_LEVELS[6].id,
    );
  });

  test('continues to the next campaign level with a fresh session', async () => {
    seedCompletedRun();
    const nav = navigation();
    const view = await render(<ResultsScreen navigation={nav.value} />);

    await fireEvent.press(view.getByTestId('next-level-button'));

    expect(useGameStore.getState()).toMatchObject({
      activeLevelId: CAMPAIGN_LEVELS[1].id,
      phase: 'planning',
      stitches: [],
      completedRun: null,
    });
    expect(nav.popTo).toHaveBeenCalledWith('SpikeLevel', {
      levelId: CAMPAIGN_LEVELS[1].id,
    });
  });

  test('opens Full Atelier instead of starting Level 7 when access is locked', async () => {
    seedCompletedRunForLevel(5);
    useCampaignProgressStore.setState({ progressByLevel: completedThrough(6) });
    const nav = navigation();
    const view = await render(<ResultsScreen navigation={nav.value} />);

    await fireEvent.press(view.getByTestId('next-level-button'));

    expect(nav.navigate).toHaveBeenCalledWith('Paywall', {
      levelId: CAMPAIGN_LEVELS[6].id,
    });
    expect(nav.popTo).not.toHaveBeenCalledWith('SpikeLevel', expect.anything());
    expect(useGameStore.getState().completedRun?.levelId).toBe(
      CAMPAIGN_LEVELS[5].id,
    );
  });

  test('starts Level 7 after Full Atelier is unlocked and free levels are complete', async () => {
    seedCompletedRunForLevel(5);
    useCampaignProgressStore.setState({ progressByLevel: completedThrough(6) });
    useEntitlementStore.setState({ hasFullGame: true });
    const nav = navigation();
    const view = await render(<ResultsScreen navigation={nav.value} />);

    await fireEvent.press(view.getByTestId('next-level-button'));

    expect(nav.navigate).not.toHaveBeenCalledWith('Paywall', expect.anything());
    expect(nav.popTo).toHaveBeenCalledWith('SpikeLevel', {
      levelId: CAMPAIGN_LEVELS[6].id,
    });
    expect(useGameStore.getState()).toMatchObject({
      activeLevelId: CAMPAIGN_LEVELS[6].id,
      phase: 'planning',
      completedRun: null,
    });
  });

  test('returns to the quilt map after clearing the transient run', async () => {
    seedCompletedRun();
    const nav = navigation();
    const view = await render(<ResultsScreen navigation={nav.value} />);

    await fireEvent.press(view.getByTestId('results-map-button'));

    expect(useGameStore.getState().completedRun).toBeNull();
    expect(nav.popTo).toHaveBeenCalledWith('QuiltMap');
  });

  test('presents Daily Scrap results without campaign rewards or next-level routing', async () => {
    const { challenge } = seedDailyCompletedRun();
    const nav = navigation();
    const view = await render(<ResultsScreen navigation={nav.value} />);

    expect(view.getByText('Scrap complete!')).toBeTruthy();
    expect(
      view.getByText(`${challenge.title} is recorded for today.`),
    ).toBeTruthy();
    expect(view.getByTestId('daily-run-submit-status')).toBeTruthy();
    expect(view.getByText('Saved on this device.')).toBeTruthy();
    expect(view.queryByTestId('results-thimbles')).toBeNull();
    expect(view.queryByTestId('results-patch')).toBeNull();
    expect(view.queryByTestId('next-level-button')).toBeNull();
    expect(
      view.getByTestId('results-map-button').props.accessibilityLabel,
    ).toBe('Return to Daily Scrap');

    await fireEvent.press(view.getByTestId('results-map-button'));

    expect(nav.popTo).toHaveBeenCalledWith('DailyScrap');
    expect(useGameStore.getState().completedRun).toBeNull();
    expect(useCampaignProgressStore.getState().progressByLevel).toEqual({});
  });

  test('replaces the optimistic Daily badge with the authoritative best', async () => {
    const { challenge, personalBest } = seedDailyCompletedRun();
    const authoritativeBest = createDailyRun(
      challenge,
      personalBest.replay.levelReplay,
      {
        clientRunId: 'daily-results-authoritative-best',
        createdAt: '2026-08-27T11:00:00.000Z',
      },
    );
    useDailyChallengeStore.setState({
      personalBest: authoritativeBest,
      latestSubmission: {
        accepted: true,
        isNewBest: false,
        personalBest: authoritativeBest,
        syncStatus: 'remote',
        message: 'Your shared best still leads this attempt.',
      },
    });
    const view = await render(
      <ResultsScreen navigation={navigation().value} />,
    );

    expect(view.queryByText('NEW BEST')).toBeNull();
    expect(
      view.getByText(`BEST ${authoritativeBest.metrics.threadUsed} THREAD`),
    ).toBeTruthy();
  });

  test('truthfully reports a Daily Scrap local-save failure', async () => {
    seedDailyCompletedRun();
    useDailyChallengeStore.setState({
      submitStatus: 'error',
      statusMessage: 'Shared standings are up to date.',
      errorMessage: 'This pull could not be saved. Please try again.',
    });
    const nav = navigation();
    const view = await render(<ResultsScreen navigation={nav.value} />);

    expect(
      view.getByText('The pull finished, but its result could not be saved.'),
    ).toBeTruthy();
    expect(
      view.getByText('This pull could not be saved. Please try again.'),
    ).toBeTruthy();
    expect(view.queryByText('Shared standings are up to date.')).toBeNull();
  });

  test('labels an in-memory-only Daily Scrap result as session-volatile', async () => {
    seedDailyCompletedRun();
    useDailyChallengeStore.setState({
      submitStatus: 'volatile',
      statusMessage:
        'Kept for this session only. Device storage is unavailable.',
      errorMessage: null,
    });
    const nav = navigation();
    const view = await render(<ResultsScreen navigation={nav.value} />);

    expect(
      view.getByText('The pull finished, but it is kept only for this session.'),
    ).toBeTruthy();
    expect(
      view.getByText(
        'Kept for this session only. Device storage is unavailable.',
      ),
    ).toBeTruthy();
    expect(
      view.queryByText(
        `${getDailyChallengeForDate('2026-08-27').title} is recorded for today.`,
      ),
    ).toBeNull();
  });

  test('does not claim an expired Daily Scrap will join shared standings', async () => {
    const { personalBest } = seedDailyCompletedRun();
    useDailyChallengeStore.setState({
      submitStatus: 'saved',
      statusMessage:
        'Saved on this device. This Daily Scrap is too old to share.',
      latestSubmission: {
        accepted: true,
        isNewBest: true,
        personalBest,
        syncStatus: 'expired',
        message: 'Saved on this device. This Daily Scrap is too old to share.',
      },
    });
    const view = await render(
      <ResultsScreen navigation={navigation().value} />,
    );

    expect(
      view.getByText('The pull finished after its shared-board window closed.'),
    ).toBeTruthy();
    expect(
      view.getByText(
        'Saved on this device. This Daily Scrap is too old to share.',
      ),
    ).toBeTruthy();
  });

  test('retries a Daily Scrap run in daily context without touching campaign progress', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-27T23:59:59.999Z'));
    const { challenge, level } = seedDailyCompletedRun();
    const nav = navigation();
    const view = await render(<ResultsScreen navigation={nav.value} />);

    await fireEvent.press(view.getByTestId('try-again-button'));

    expect(nav.popTo).toHaveBeenCalledWith('SpikeLevel', {
      levelId: level.id,
      mode: 'daily',
      challengeId: challenge.id,
    });
    expect(useGameStore.getState()).toMatchObject({
      activeLevelId: level.id,
      activeSession: {
        kind: 'daily',
        challenge: { id: challenge.id },
      },
      phase: 'planning',
      stitches: [],
      completedRun: null,
    });
    expect(useCampaignProgressStore.getState().progressByLevel).toEqual({});
    expect(nav.navigate).not.toHaveBeenCalledWith('Paywall', expect.anything());
  });

  test('returns to Daily Scrap instead of replaying a run after its UTC day', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-28T00:00:00.000Z'));
    seedDailyCompletedRun();
    const nav = navigation();
    const view = await render(<ResultsScreen navigation={nav.value} />);

    await fireEvent.press(view.getByTestId('try-again-button'));

    expect(nav.popTo).toHaveBeenCalledWith('DailyScrap');
    expect(nav.popTo).not.toHaveBeenCalledWith(
      'SpikeLevel',
      expect.anything(),
    );
    expect(useGameStore.getState()).toMatchObject({
      phase: 'planning',
      stitches: [],
      completedRun: null,
    });
    expect(useCampaignProgressStore.getState().progressByLevel).toEqual({});
  });

  test('offers a safe return when opened without a completed run', async () => {
    const nav = navigation();
    const view = await render(<ResultsScreen navigation={nav.value} />);

    expect(view.getByText('No completed pull')).toBeTruthy();
    await fireEvent.press(view.getByTestId('try-again-button'));
    expect(nav.popTo).toHaveBeenCalledWith('SpikeLevel', {
      levelId: SPIKE_LEVEL.id,
    });
  });
});
