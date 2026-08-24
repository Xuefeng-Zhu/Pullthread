import {
  act,
  fireEvent,
  render,
  waitFor,
} from '@testing-library/react-native';
import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import MockReact from 'react';
import { View as MockView } from 'react-native';

import type { SimulationOutcome } from '../../../game/core/types';
import { REFERENCE_PINCH_STITCH } from '../../../game/levels/spikeLevel';
import {
  createSpikeReplay,
  simulateSpikeReplay,
} from '../../../game/replay';
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
      replay,
      outcome,
      isNewBest: true,
      bestMetrics: {
        threadUsed: replay.stitches[0].threadCost,
        stitchesUsed: replay.stitches.length,
        completionMs: outcome.completionMs,
      },
    },
  });
  return { replay, outcome };
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
    usePreferencesStore.setState({ ...defaultPreferences });
    mockUseGameSession.mockClear();
  });

  test('shows exact result copy and metrics from the captured run', async () => {
    const { replay, outcome } = seedCompletedRun();
    const nav = navigation();
    const view = await render(<ResultsScreen navigation={nav.value} />);

    expect(view.getByText('Perfect pull!')).toBeTruthy();
    expect(view.getByText('The button found the embroidery.')).toBeTruthy();
    expect(view.getByText('REPLAY READY')).toBeTruthy();
    expect(view.getByText('NEW BEST')).toBeTruthy();
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
    expect(nav.popTo).toHaveBeenCalledWith('SpikeLevel');
  });

  test('offers a safe return when opened without a completed run', async () => {
    const nav = navigation();
    const view = await render(<ResultsScreen navigation={nav.value} />);

    expect(view.getByText('No completed pull')).toBeTruthy();
    await fireEvent.press(view.getByTestId('try-again-button'));
    expect(nav.popTo).toHaveBeenCalledWith('SpikeLevel');
  });
});
