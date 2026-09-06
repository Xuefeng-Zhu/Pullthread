/** @jest-environment node */
import { act, fireEvent, render, within } from '@testing-library/react-native';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { useIsFocused } from '@react-navigation/native';
import type { ComponentProps } from 'react';
import MockReact from 'react';
import { AccessibilityInfo, AppState, StyleSheet, useWindowDimensions, View as MockView } from 'react-native';
import { Gesture, State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ExpoFeedbackService } from '../../../game/feedback';
import type { ActiveChallenge } from '../../../game/launch/challengeTypes';
import { LaunchCanvas } from '../../../game/launch/LaunchCanvas';
import type { LaunchPoint } from '../../../game/launch/types';
import { useLaunchSession } from '../../../game/launch/useLaunchSession';
import { getLaunchViewport } from '../../../game/launch/viewport';
import { resetEndlessProgressStoreForTests, useEndlessProgressStore } from '../../../store/useEndlessProgressStore';
import { defaultPreferences, usePreferencesStore } from '../../../store/usePreferencesStore';
import { EndlessGameScreen } from '../EndlessGameScreen';

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual<typeof import('@react-navigation/native')>('@react-navigation/native'),
  useIsFocused: jest.fn(() => true),
}));
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 390, height: 844, scale: 3, fontScale: 1 })),
}));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual<typeof import('react-native-safe-area-context')>('react-native-safe-area-context'),
  useSafeAreaInsets: jest.fn(() => ({ top: 0, right: 0, bottom: 0, left: 0 })),
}));
jest.mock('../../../game/launch/LaunchCanvas', () => ({
  LaunchCanvas: jest.fn(() => MockReact.createElement(MockView, { testID: 'mock-launch-canvas' })),
}));
jest.mock('../../../game/launch/useLaunchSession', () => ({
  useLaunchSession: jest.fn(jest.requireActual<typeof import('../../../game/launch/useLaunchSession')>(
    '../../../game/launch/useLaunchSession',
  ).useLaunchSession),
}));
jest.mock('../../../game/feedback', () => ({
  ExpoFeedbackService: jest.fn(() => ({
    setPreferences: jest.fn(), play: jest.fn(async () => undefined), dispose: jest.fn(),
  })),
}));

type ScreenProps = ComponentProps<typeof EndlessGameScreen>;
type ScreenView = Awaited<ReturnType<typeof render>>;
const testGlobals = globalThis as typeof globalThis & { __DEV__: boolean };
const bankChallenge: ActiveChallenge = {
  pocketId: 'bank-receiver', patternId: 'bank-first', family: 'bank', band: 'intro',
  cue: 'Aim for the cushion. Let the bounce carry you to the pocket.',
};
const timingChallenge: ActiveChallenge = {
  pocketId: 'timing-receiver', patternId: 'timing-first', family: 'timing', band: 'intro',
  cue: 'Watch the moving pocket. Release as it comes toward your arc.',
};

function overrideChallenge(read: () => ActiveChallenge | undefined) {
  const actual = jest.requireActual<typeof import('../../../game/launch/useLaunchSession')>(
    '../../../game/launch/useLaunchSession',
  );
  jest.mocked(useLaunchSession).mockImplementation((...args) => ({
    ...actual.useLaunchSession(...args),
    // Challenge cues must work after the opening gesture was already learned.
    hasAimed: true,
    challenge: read(),
  }));
}

function harness() {
  return {
    navigation: { navigate: jest.fn() } as unknown as ScreenProps['navigation'],
    route: { key: 'launch-test', name: 'EndlessGame' } as ScreenProps['route'],
  };
}

function latestCanvas() {
  const call = jest.mocked(LaunchCanvas).mock.calls.at(-1);
  if (!call) throw new Error('Expected a measured canvas');
  return call[0];
}

function cameraOffset() {
  const camera = latestCanvas().motion.cameraY;
  if (!camera) throw new Error('Expected the endless camera to be published to the canvas');
  return camera.value;
}

describe('endless Pull & Launch screen', () => {
  let frames: Map<number, FrameRequestCallback>;
  let timestamp: number;
  let nextFrameId: number;
  const initialAppState = AppState.currentState;
  const initialDev = __DEV__;

  beforeEach(async () => {
    await resetEndlessProgressStoreForTests();
    jest.clearAllMocks();
    jest.mocked(useLaunchSession).mockImplementation(
      jest.requireActual<typeof import('../../../game/launch/useLaunchSession')>(
        '../../../game/launch/useLaunchSession',
      ).useLaunchSession,
    );
    testGlobals.__DEV__ = true;
    AppState.currentState = 'active';
    jest.mocked(useIsFocused).mockReturnValue(true);
    jest.mocked(useWindowDimensions).mockReturnValue({ width: 390, height: 844, scale: 3, fontScale: 1 });
    jest.mocked(useSafeAreaInsets).mockReturnValue({ top: 0, right: 0, bottom: 0, left: 0 });
    usePreferencesStore.setState(defaultPreferences);
    frames = new Map();
    timestamp = 0;
    nextFrameId = 0;
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    jest.spyOn(global, 'requestAnimationFrame').mockImplementation((callback) => {
      const id = ++nextFrameId;
      frames.set(id, callback);
      return id;
    });
    jest.spyOn(global, 'cancelAnimationFrame').mockImplementation((id) => { if (typeof id === 'number') frames.delete(id); });
  });

  afterEach(() => {
    testGlobals.__DEV__ = initialDev;
    AppState.currentState = initialAppState;
    jest.restoreAllMocks();
  });

  async function measure(view: ScreenView, width = 360, height = 600) {
    await fireEvent(view.getByTestId('launch-play-area'), 'layout', { nativeEvent: { layout: { width, height } } });
  }

  async function runFrames(count: number) {
    await act(() => {
      for (let frame = 0; frame < count; frame += 1) {
        timestamp += 1000 / 60;
        const callbacks = [...frames.values()];
        frames.clear();
        callbacks.forEach((callback) => callback(timestamp));
      }
    });
  }

  async function drag(pull: LaunchPoint, { cancelled = false, quick = true, offsetScreenX = 0 } = {}) {
    const canvas = latestCanvas();
    const { scale, offsetX, offsetY } = getLaunchViewport(canvas.size, canvas.room.bounds, canvas.bottomInset);
    const x = canvas.state.position.x * scale + offsetX + offsetScreenX;
    const y = (canvas.state.position.y - cameraOffset()) * scale + offsetY;
    const delta = { translationX: pull.x * scale, translationY: pull.y * scale };
    await act(() => fireGestureHandler(getByGestureTestId('launch-pull-gesture'), [
      { state: State.BEGAN, x, y },
      ...(!quick ? [{ state: State.ACTIVE, x, y, translationX: 0, translationY: 0 }] : []),
      { state: State.ACTIVE, x: x + delta.translationX, y: y + delta.translationY, ...delta },
      { state: cancelled ? State.CANCELLED : State.END, x: x + delta.translationX, y: y + delta.translationY, ...delta },
    ]));
  }

  test('starts one endless run without course or checkpoint-reset controls and can pause and resume', async () => {
    const props = harness();
    const view = await render(<EndlessGameScreen {...props} />);
    expect(view.getByTestId('launch-run-screen')).toBeTruthy();
    for (const id of ['launch-courses-button', 'launch-next-button', 'launch-retry-button', 'launch-course-select']) {
      expect(view.queryByTestId(id)).toBeNull();
    }
    await measure(view);
    await runFrames(3);
    await fireEvent.press(view.getByTestId('launch-pause-button'));
    expect(view.getByTestId('launch-paused')).toBeTruthy();
    expect(within(view.getByTestId('launch-paused')).getByTestId('launch-resume-button')).toBeTruthy();
    const pausedTick = latestCanvas().motion.tick.value;
    await runFrames(90);
    expect(latestCanvas().motion.tick.value).toBe(pausedTick);
    await fireEvent.press(view.getByTestId('launch-resume-button'));
    expect(view.queryByTestId('launch-paused')).toBeNull();
    await runFrames(3);
    expect(latestCanvas().motion.tick.value).toBeGreaterThan(pausedTick);
    await fireEvent.press(view.getByTestId('launch-settings-button'));
    expect(props.navigation.navigate).toHaveBeenCalledWith('Settings');
    await view.unmount();
    expect(frames.size).toBe(0);
  });

  test('scaled touch cancellation does not launch and a quick drag uses the final release', async () => {
    const view = await render(<EndlessGameScreen {...harness()} />);
    await measure(view, 340, 480);
    expect(latestCanvas().size).toEqual({ width: 340, height: 480 });
    await drag({ x: 2, y: 3 });
    expect(latestCanvas().state.launches).toBe(0);
    expect(latestCanvas().showTutorial).toBe(true);
    await drag({ x: -24, y: 72 }, { quick: false, cancelled: true });
    expect(latestCanvas().state.phase).toBe('held');
    expect(latestCanvas().state.launches).toBe(0);
    expect(latestCanvas().motion.pullY.value).toBe(0);
    await drag({ x: -24, y: 72 });
    expect(latestCanvas().state.phase).toBe('flying');
    expect(latestCanvas().state.position).toEqual({ x: 56, y: 562 });
    expect(latestCanvas().state.velocity).toEqual({ x: 180, y: -540 });
    expect(latestCanvas().showTutorial).toBe(false);
    expect(view.queryByTestId('launch-cue')).toBeNull();
    await view.unmount();
  });

  test('opening Settings preserves a paused flight and returning resumes the same run', async () => {
    const props = harness();
    const view = await render(<EndlessGameScreen {...props} />);
    await measure(view);
    await drag({ x: -24, y: 72 });
    await runFrames(4);
    const tick = latestCanvas().motion.tick.value;
    const position = { x: latestCanvas().motion.travelerX.value, y: latestCanvas().motion.travelerY.value };
    await fireEvent.press(view.getByTestId('launch-settings-button'));
    expect(props.navigation.navigate).toHaveBeenCalledWith('Settings');
    jest.mocked(useIsFocused).mockReturnValue(false);
    await view.rerender(<EndlessGameScreen {...props} />);
    await runFrames(120);
    expect(latestCanvas().motion.tick.value).toBe(tick);
    expect(latestCanvas().motion.travelerX.value).toBe(position.x);
    expect(latestCanvas().motion.travelerY.value).toBe(position.y);
    jest.mocked(useIsFocused).mockReturnValue(true);
    await view.rerender(<EndlessGameScreen {...props} />);
    await runFrames(3);
    expect(latestCanvas().motion.tick.value).toBe(tick + 4);
    expect(latestCanvas().state.launches).toBe(1);
    expect(latestCanvas().motion.travelerY.value).toBeLessThan(position.y);
    await view.unmount();
  });

  test('touches use the camera offset after catching a pocket and the run continues without a completion screen', async () => {
    const view = await render(<EndlessGameScreen {...harness()} />);
    await measure(view);
    await drag({ x: -24, y: 72 });
    await runFrames(180);
    expect(latestCanvas().state.phase).toBe('held');
    expect(latestCanvas().state.position.y).toBeLessThan(490);
    expect(cameraOffset()).toBeLessThan(-52);
    expect(view.queryByTestId('launch-game-over')).toBeNull();
    expect(view.queryByTestId('launch-next-button')).toBeNull();
    const pocket = { ...latestCanvas().state.position };
    await drag({ x: 0, y: 60 });
    expect(latestCanvas().state.phase).toBe('flying');
    expect(latestCanvas().state.position).toEqual({ x: pocket.x, y: pocket.y + 60 });
    await view.unmount();
  });

  test('death stays final, Play again starts fresh, and best scores persist independently of preferences', async () => {
    const preferences = usePreferencesStore.getState();
    const view = await render(<EndlessGameScreen {...harness()} />);
    await measure(view);
    await drag({ x: -24, y: 72 });
    await runFrames(180);
    expect(latestCanvas().state.phase).toBe('held');
    expect(view.getByTestId('launch-score').props.children).toBe(1);
    await drag({ x: 70, y: 0 });
    await runFrames(180);
    expect(latestCanvas().state.phase).toBe('failed');
    expect(view.getByTestId('launch-game-over')).toBeTruthy();
    expect(within(view.getByTestId('launch-game-over')).getByTestId('launch-restart-button')).toBeTruthy();
    expect(view.getByLabelText('Play again')).toBeTruthy();
    const dead = latestCanvas().state;
    const best = view.getByTestId('launch-best').props.children;
    expect(best).toBe(1);
    expect(useEndlessProgressStore.getState().bestPockets).toBe(1);
    await runFrames(180);
    expect(latestCanvas().state).toEqual(dead);
    expect(view.getByTestId('launch-game-over')).toBeTruthy();
    await fireEvent.press(view.getByTestId('launch-restart-button'));
    await measure(view);
    expect(latestCanvas().state.phase).toBe('held');
    expect(latestCanvas().state.position).toEqual({ x: 80, y: 490 });
    expect(latestCanvas().state.launches).toBe(0);
    expect(latestCanvas().state.tick).toBe(0);
    expect(view.queryByTestId('launch-game-over')).toBeNull();
    expect(view.getByTestId('launch-best').props.children).toEqual(best);
    expect(usePreferencesStore.getState()).toBe(preferences);
    await view.unmount();
    const reopened = await render(<EndlessGameScreen {...harness()} />);
    expect(reopened.getByTestId('launch-best').props.children).toBe(1);
    await reopened.unmount();
  });

  test('large text overlays leave the full compact playfield available', async () => {
    jest.mocked(useWindowDimensions).mockReturnValue({ width: 320, height: 568, scale: 2, fontScale: 2 });
    const view = await render(<EndlessGameScreen {...harness()} />);
    const instruction = view.getByTestId('launch-instruction');
    const instructionStyle = StyleSheet.flatten(instruction.props.style);
    expect(instructionStyle.height).toBeUndefined();
    await measure(view, 320, 568);
    expect(latestCanvas().size).toEqual({ width: 320, height: 568 });
    await drag({ x: -24, y: 72 }, { offsetScreenX: 23 });
    expect(latestCanvas().state.phase).toBe('flying');
    expect(latestCanvas().state.position).toEqual({ x: 56, y: 562 });
    await view.unmount();
  });

  test('the fabric fills a notched screen while HUD controls and touch projection respect safe insets', async () => {
    jest.mocked(useSafeAreaInsets).mockReturnValue({ top: 59, right: 0, bottom: 34, left: 0 });
    const view = await render(<EndlessGameScreen {...harness()} />);
    await measure(view, 390, 844);
    expect(latestCanvas().size).toEqual({ width: 390, height: 844 });
    expect(latestCanvas().bottomInset).toBeGreaterThanOrEqual(34);
    expect(StyleSheet.flatten(view.getByTestId('launch-play-area').props.style)).toMatchObject({
      position: 'absolute', top: 0, bottom: 0, left: 0, right: 0,
    });
    expect(StyleSheet.flatten(view.getByTestId('launch-hud').props.style).top).toBeGreaterThanOrEqual(59);
    expect(view.getByTestId('launch-cue').props.pointerEvents).toBe('none');
    await drag({ x: -24, y: 72 });
    expect(latestCanvas().state.phase).toBe('flying');
    expect(latestCanvas().state.position).toEqual({ x: 56, y: 562 });
    await view.unmount();
  });

  test('very short viewports retain a 48-point pocket touch target after projection', async () => {
    jest.mocked(useWindowDimensions).mockReturnValue({ width: 420, height: 180, scale: 2, fontScale: 1 });
    const view = await render(<EndlessGameScreen {...harness()} />);
    await measure(view, 420, 180);
    expect(latestCanvas().size).toEqual({ width: 420, height: 180 });
    await drag({ x: -24, y: 72 }, { offsetScreenX: 23 });
    expect(latestCanvas().state.phase).toBe('flying');
    expect(latestCanvas().state.position).toEqual({ x: 56, y: 562 });
    await view.unmount();
  });

  test('resizing during a pull cancels it before the old gesture can release through a new projection', async () => {
    const view = await render(<EndlessGameScreen {...harness()} />);
    await measure(view);
    const gesture = getByGestureTestId('launch-pull-gesture') as ReturnType<typeof Gesture.Pan>;
    type PanEvent = Parameters<NonNullable<typeof gesture.handlers.onBegin>>[0];
    const event = { x: 80, y: 490, translationX: -24, translationY: 72, state: State.BEGAN } as PanEvent;
    // Invoke the registered callbacks directly to interleave a layout event with an unfinished drag.
    // fireGestureHandler automatically appends END, which would hide this lifecycle regression.
    await act(() => {
      gesture.handlers.onBegin?.(event);
      gesture.handlers.onUpdate?.({ ...event, state: State.ACTIVE });
    });
    expect(latestCanvas().motion.pullY.value).toBe(72);
    await measure(view, 390, 844);
    expect(latestCanvas().motion.pullY.value).toBe(0);
    await act(() => gesture.handlers.onEnd?.({ ...event, state: State.END }, true));
    expect(latestCanvas().state.phase).toBe('held');
    expect(latestCanvas().state.launches).toBe(0);
    expect(latestCanvas().state.position).toEqual({ x: 80, y: 490 });
    await view.unmount();
  });

  test('existing visual, hint, sound and haptic preferences reach the endless run', async () => {
    usePreferencesStore.setState({ highContrastEnabled: true, reducedMotionEnabled: true,
      tutorialHintsEnabled: false, soundEnabled: false, hapticsEnabled: false });
    const view = await render(<EndlessGameScreen {...harness()} />);
    await measure(view);
    expect(latestCanvas()).toMatchObject({ highContrast: true, reducedMotion: true, showTutorial: false });
    const feedback = jest.mocked(ExpoFeedbackService).mock.results.at(-1)?.value as ExpoFeedbackService;
    expect(feedback.setPreferences).toHaveBeenCalledWith({ soundEnabled: false, hapticsEnabled: false });
    await view.unmount();
    expect(feedback.dispose).toHaveBeenCalledTimes(1);
  });

  test('production builds start the official game without a development guard', async () => {
    testGlobals.__DEV__ = false;
    const view = await render(<EndlessGameScreen {...harness()} />);
    expect(view.getByTestId('endless-game-screen')).toBeTruthy();
    expect(view.getByTestId('launch-run-screen')).toBeTruthy();
    expect(view.queryByText('Playground unavailable')).toBeNull();
    await measure(view);
    await drag({ x: -24, y: 72 });
    expect(latestCanvas().state.phase).toBe('flying');
    expect(ExpoFeedbackService).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  test('bank and timing cues teach each family once after an accepted meaningful pull', async () => {
    let challenge = bankChallenge;
    overrideChallenge(() => challenge);
    const props = harness();
    const view = await render(<EndlessGameScreen {...props} />);
    await measure(view);
    expect(view.queryByTestId('launch-cue')).toBeNull();
    expect(view.getByText(bankChallenge.cue!)).toBeTruthy();
    expect(view.getByTestId('launch-challenge-cue').props.pointerEvents).toBe('none');

    await drag({ x: 2, y: 3 });
    expect(view.getByTestId('launch-challenge-cue')).toBeTruthy();
    await drag({ x: -24, y: 72 }, { offsetScreenX: 150 });
    expect(view.getByTestId('launch-challenge-cue')).toBeTruthy();
    expect(latestCanvas().state.launches).toBe(0);

    await drag({ x: -24, y: 72 }, { quick: false, cancelled: true });
    expect(view.queryByTestId('launch-challenge-cue')).toBeNull();
    expect(latestCanvas().state.launches).toBe(0);
    challenge = { ...bankChallenge, pocketId: 'another-bank', patternId: 'bank-later' };
    await view.rerender(<EndlessGameScreen {...props} />);
    expect(view.queryByTestId('launch-challenge-cue')).toBeNull();

    challenge = timingChallenge;
    await view.rerender(<EndlessGameScreen {...props} />);
    expect(view.getByText(timingChallenge.cue!)).toBeTruthy();
    await drag({ x: 0, y: 60 }, { quick: false, cancelled: true });
    expect(view.queryByTestId('launch-challenge-cue')).toBeNull();
    challenge = { ...timingChallenge, pocketId: 'another-timing', patternId: 'timing-later' };
    await view.rerender(<EndlessGameScreen {...props} />);
    expect(view.queryByTestId('launch-challenge-cue')).toBeNull();
    expect(latestCanvas().state.launches).toBe(0);
    await view.unmount();
  });

  test('disabled hints suppress contextual cues without consuming an unseen introduction', async () => {
    usePreferencesStore.setState({ tutorialHintsEnabled: false });
    overrideChallenge(() => bankChallenge);
    const view = await render(<EndlessGameScreen {...harness()} />);
    await measure(view);
    expect(view.queryByTestId('launch-challenge-cue')).toBeNull();
    await drag({ x: -24, y: 72 }, { quick: false, cancelled: true });
    await act(() => usePreferencesStore.setState({ tutorialHintsEnabled: true }));
    expect(view.getByTestId('launch-challenge-cue')).toBeTruthy();
    expect(latestCanvas().state.launches).toBe(0);
    await view.unmount();
  });

  test('pausing and opening Settings hide a cue without dismissing it', async () => {
    overrideChallenge(() => timingChallenge);
    const props = harness();
    const view = await render(<EndlessGameScreen {...props} />);
    await measure(view);
    expect(view.getByTestId('launch-challenge-cue')).toBeTruthy();
    await fireEvent.press(view.getByTestId('launch-pause-button'));
    expect(view.queryByTestId('launch-challenge-cue')).toBeNull();
    await fireEvent.press(view.getByTestId('launch-resume-button'));
    expect(view.getByTestId('launch-challenge-cue')).toBeTruthy();
    jest.mocked(useIsFocused).mockReturnValue(false);
    await view.rerender(<EndlessGameScreen {...props} />);
    expect(view.queryByTestId('launch-challenge-cue')).toBeNull();
    jest.mocked(useIsFocused).mockReturnValue(true);
    await view.rerender(<EndlessGameScreen {...props} />);
    expect(view.getByTestId('launch-challenge-cue')).toBeTruthy();
    expect(latestCanvas().state.launches).toBe(0);
    await view.unmount();
  });

  test('compact enlarged-text cues stay overlays and a resized gesture cannot dismiss or launch', async () => {
    overrideChallenge(() => bankChallenge);
    const view = await render(<EndlessGameScreen {...harness()} />);
    await measure(view);
    const gesture = getByGestureTestId('launch-pull-gesture') as ReturnType<typeof Gesture.Pan>;
    type PanEvent = Parameters<NonNullable<typeof gesture.handlers.onBegin>>[0];
    const event = { x: 80, y: 490, translationX: 2, translationY: 3, state: State.BEGAN } as PanEvent;
    await act(() => {
      gesture.handlers.onBegin?.(event);
      gesture.handlers.onUpdate?.({ ...event, state: State.ACTIVE });
    });
    jest.mocked(useWindowDimensions).mockReturnValue({ width: 320, height: 568, scale: 2, fontScale: 2 });
    jest.mocked(useSafeAreaInsets).mockReturnValue({ top: 59, right: 9, bottom: 34, left: 7 });
    await measure(view, 320, 568);
    await fireEvent(view.getByTestId('launch-hud'), 'layout', { nativeEvent: { layout: { height: 110 } } });
    await act(() => {
      const stale = { ...event, translationX: -24, translationY: 72 };
      gesture.handlers.onUpdate?.({ ...stale, state: State.ACTIVE });
      gesture.handlers.onEnd?.({ ...stale, state: State.END }, true);
    });
    const cue = view.getByTestId('launch-challenge-cue');
    expect(StyleSheet.flatten(cue.props.style)).toMatchObject({ position: 'absolute', top: 193, left: 27, right: 29 });
    expect(within(cue).getByText(bankChallenge.cue!).props.numberOfLines).toBe(3);
    expect(cue.props.pointerEvents).toBe('none');
    expect(latestCanvas().size).toEqual({ width: 320, height: 568 });
    expect(latestCanvas().state.phase).toBe('held');
    expect(latestCanvas().state.launches).toBe(0);
    expect(latestCanvas().motion.pullY.value).toBe(0);
    await view.unmount();
  });

  test('a fresh run can introduce a challenge family again', async () => {
    overrideChallenge(() => bankChallenge);
    const view = await render(<EndlessGameScreen {...harness()} />);
    await measure(view);
    await drag({ x: -24, y: 72 }, { quick: false, cancelled: true });
    expect(view.queryByTestId('launch-challenge-cue')).toBeNull();
    await fireEvent.press(view.getByTestId('launch-pause-button'));
    await fireEvent.press(view.getByTestId('launch-restart-button'));
    expect(view.getByTestId('launch-challenge-cue')).toBeTruthy();
    expect(view.getByTestId('launch-score').props.children).toBe(0);
    await view.unmount();
  });
});
