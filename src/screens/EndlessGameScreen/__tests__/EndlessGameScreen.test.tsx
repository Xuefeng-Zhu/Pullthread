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
import * as endless from '../../../game/launch/endless';
import { grantFreeTool } from '../../../game/launch/toolInventory';
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
jest.mock('../../../components/ToolIcon', () => ({
  ToolIcon: () => MockReact.createElement(MockView),
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

function rejectMotionReadbacks() {
  const implementation = jest.mocked(useLaunchSession).getMockImplementation()!;
  const readback = jest.fn(() => { throw new Error('Gesture handlers must not synchronously read UI shared values.'); });
  jest.mocked(useLaunchSession).mockImplementation((...args) => {
    const session = implementation(...args);
    // Wrap the public motion values only. The actual simulation still publishes
    // normally, and test assertions can inspect .value without exercising .get().
    const motion = Object.fromEntries(Object.entries(session.motion).map(([key, value]) => [key,
      new Proxy({} as typeof value, { get: (_target, property) => property === 'get'
        ? readback : Reflect.get(value, property, value) }),
    ])) as typeof session.motion;
    return { ...session, motion };
  });
  return readback;
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

function pocketTouchPoint() {
  const canvas = latestCanvas();
  const { scale, offsetX, offsetY } = getLaunchViewport(canvas.size, canvas.room.bounds, canvas.bottomInset);
  return { x: offsetX + canvas.state.position.x * scale,
    y: offsetY + (canvas.state.position.y - cameraOffset()) * scale };
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

  test('starts one endless run without course, checkpoint-reset, or pause controls', async () => {
    const props = harness();
    const view = await render(<EndlessGameScreen {...props} />);
    expect(view.getByTestId('launch-run-screen')).toBeTruthy();
    for (const id of ['launch-courses-button', 'launch-next-button', 'launch-retry-button', 'launch-course-select']) {
      expect(view.queryByTestId(id)).toBeNull();
    }
    await measure(view);
    await runFrames(3);
    expect(view.queryByTestId('launch-pause-button')).toBeNull();
    expect(view.queryByTestId('launch-paused')).toBeNull();
    expect(view.getByTestId('launch-score-card')).toBeTruthy();
    expect(view.queryByTestId('launch-points-button')).toBeNull();
    expect(view.queryByTestId('launch-points-balance')).toBeNull();
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

  test('repeated drag updates and a scrolled catch avoid synchronous shared-value readbacks', async () => {
    const readback = rejectMotionReadbacks();
    const view = await render(<EndlessGameScreen {...harness()} />);
    await measure(view);
    const gesture = getByGestureTestId('launch-pull-gesture') as ReturnType<typeof Gesture.Pan>;
    type PanEvent = Parameters<NonNullable<typeof gesture.handlers.onBegin>>[0];
    const event = { ...pocketTouchPoint(), translationX: 0, translationY: 0, state: State.BEGAN } as PanEvent;
    await act(() => {
      gesture.handlers.onBegin?.(event);
      for (let count = 1; count <= 50; count += 1) {
        gesture.handlers.onUpdate?.({ ...event, state: State.ACTIVE,
          translationX: -24 * count / 50, translationY: 72 * count / 50 });
      }
      gesture.handlers.onEnd?.({ ...event, state: State.END, translationX: -24, translationY: 72 }, true);
      gesture.handlers.onFinalize?.({ ...event, state: State.END }, true);
    });
    expect(latestCanvas().state.position).toEqual({ x: 56, y: 562 });
    await runFrames(180);
    expect(latestCanvas().state.phase).toBe('held');
    expect(cameraOffset()).toBeLessThan(0);
    await drag({ x: 0, y: 60 });
    expect(latestCanvas().state.launches).toBe(2);
    expect(readback).not.toHaveBeenCalled();
    await view.unmount();
  });

  test('a floor-clamped pull keeps its challenge hint until an effective stretch without shared-value reads', async () => {
    const run = endless.createEndlessRun(0);
    run.state.position = { x: 80, y: 589 };
    run.state.previousPosition = { ...run.state.position };
    run.room = { ...run.room, pockets: run.room.pockets.map((pocket) => pocket.id === run.state.pocketId
      ? { ...pocket, center: { ...run.state.position } } : pocket) };
    jest.spyOn(endless, 'createEndlessRun').mockReturnValueOnce(run);
    overrideChallenge(() => bankChallenge);
    const readback = rejectMotionReadbacks();
    const view = await render(<EndlessGameScreen {...harness()} />);
    await measure(view);
    await drag({ x: 0, y: 50 });
    expect(view.getByTestId('launch-challenge-cue')).toBeTruthy();
    expect(latestCanvas().state.launches).toBe(0);
    await drag({ x: -24, y: 50 }, { quick: false, cancelled: true });
    expect(view.queryByTestId('launch-challenge-cue')).toBeNull();
    expect(latestCanvas().state.launches).toBe(0);
    expect(readback).not.toHaveBeenCalled();
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
    const event = { ...pocketTouchPoint(), translationX: -24, translationY: 72, state: State.BEGAN } as PanEvent;
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

  test('each authored world lesson teaches independently of the earlier bank and timing hints', async () => {
    let challenge: ActiveChallenge = { ...bankChallenge, family: 'arc', introductionKey: 'section-10', cue: 'Swaying pockets settle when caught.' };
    overrideChallenge(() => challenge);
    const props = harness();
    const view = await render(<EndlessGameScreen {...props} />);
    await measure(view);
    expect(view.getByText(challenge.cue!)).toBeTruthy();
    await drag({ x: -24, y: 72 }, { quick: false, cancelled: true });
    expect(view.queryByTestId('launch-challenge-cue')).toBeNull();
    challenge = { ...challenge, introductionKey: 'section-11' };
    await view.rerender(<EndlessGameScreen {...props} />);
    expect(view.getByText(challenge.cue!)).toBeTruthy();
    await view.unmount();
  });

  test('world announcements remain nonblocking and yield to the loose-pocket deadline', async () => {
    const actual = jest.requireActual<typeof import('../../../game/launch/useLaunchSession')>('../../../game/launch/useLaunchSession');
    let fraySeconds: number | null = null;
    jest.mocked(useLaunchSession).mockImplementation((...args) => ({ ...actual.useLaunchSession(...args),
      hasAimed: true, worldStage: 4, worldTransitionTick: 60, worldAnnouncement: true, fraySeconds }));
    usePreferencesStore.setState({ tutorialHintsEnabled: false });
    const props = harness();
    const view = await render(<EndlessGameScreen {...props} />);
    await measure(view);
    expect(view.getByTestId('launch-world-announcement').props.pointerEvents).toBe('none');
    expect(view.getByText('Moonlit Quilt')).toBeTruthy();
    expect(latestCanvas()).toMatchObject({ worldStage: 4, worldTransitionTick: 60 });
    expect(view.getByTestId('launch-playfield').props.accessibilityLabel).toContain('Moonlit Quilt');
    fraySeconds = 2;
    await view.rerender(<EndlessGameScreen {...props} />);
    expect(view.queryByTestId('launch-world-announcement')).toBeNull();
    expect(within(view.getByTestId('launch-challenge-cue')).getByText('Loose pocket · 2 seconds to launch')).toBeTruthy();
    await view.unmount();
  });

  test('pulls during a world announcement do not consume the hidden lesson', async () => {
    const actual = jest.requireActual<typeof import('../../../game/launch/useLaunchSession')>('../../../game/launch/useLaunchSession');
    let announcing = true;
    const lesson: ActiveChallenge = { ...bankChallenge, family: 'arc', introductionKey: 'section-10', cue: 'Catch a swaying pocket to hold it still.' };
    jest.mocked(useLaunchSession).mockImplementation((...args) => ({ ...actual.useLaunchSession(...args),
      hasAimed: true, worldStage: 1, worldAnnouncement: announcing, challenge: lesson }));
    const props = harness();
    const view = await render(<EndlessGameScreen {...props} />);
    await measure(view);
    expect(view.queryByTestId('launch-challenge-cue')).toBeNull();
    await drag({ x: -24, y: 72 }, { quick: false, cancelled: true });
    announcing = false;
    await view.rerender(<EndlessGameScreen {...props} />);
    expect(view.getByText(lesson.cue!)).toBeTruthy();
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

  test('opening Settings hides a cue without dismissing it', async () => {
    overrideChallenge(() => timingChallenge);
    const props = harness();
    const view = await render(<EndlessGameScreen {...props} />);
    await measure(view);
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
    const event = { ...pocketTouchPoint(), translationX: 2, translationY: 3, state: State.BEGAN } as PanEvent;
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
    expect(StyleSheet.flatten(cue.props.style)).toMatchObject({ position: 'absolute', top: 243, left: 27, right: 29 });
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
    await drag({ x: 70, y: 0 });
    await runFrames(180);
    expect(view.getByTestId('launch-game-over')).toBeTruthy();
    await fireEvent.press(view.getByTestId('launch-restart-button'));
    expect(view.getByTestId('launch-challenge-cue')).toBeTruthy();
    expect(view.getByTestId('launch-score').props.children).toBe(0);
    await view.unmount();
  });

  test('free Preview stays armed after a cancelled pull without opening checkout', async () => {
    const run = endless.createEndlessRun(0);
    grantFreeTool(run, 'preview');
    jest.spyOn(endless, 'createEndlessRun').mockReturnValueOnce(run);
    const view = await render(<EndlessGameScreen {...harness()} />);
    await measure(view);
    await fireEvent.press(view.getByTestId('tool-preview'));
    expect(latestCanvas().previewActive).toBe(true);
    expect(view.queryByTestId('tool-confirmation')).toBeNull();
    expect(view.queryByTestId('points-shop')).toBeNull();
    await drag({ x: -24, y: 72 }, { quick: false, cancelled: true });
    expect(latestCanvas().previewActive).toBe(true);
    expect(latestCanvas().state.launches).toBe(0);
    await drag({ x: -24, y: 72 });
    expect(latestCanvas().previewActive).toBe(false);
    expect(latestCanvas().state.phase).toBe('flying');
    await view.unmount();
  });

  test('landing selection freezes the run, cancellation is free, and a chosen pocket scores once', async () => {
    const readback = rejectMotionReadbacks();
    const run = endless.createEndlessRun(0);
    grantFreeTool(run, 'teleport');
    jest.spyOn(endless, 'createEndlessRun').mockReturnValueOnce(run);
    const view = await render(<EndlessGameScreen {...harness()} />);
    await measure(view);
    await runFrames(3);
    await fireEvent.press(view.getByTestId('tool-teleport'));
    expect(view.getByTestId('teleport-selection')).toBeTruthy();
    const tick = latestCanvas().motion.tick.value;
    await runFrames(100);
    expect(latestCanvas().motion.tick.value).toBe(tick);
    await fireEvent.press(view.getByTestId('teleport-cancel'));
    expect(run.inventory.teleport).toBe(1);
    await fireEvent.press(view.getByTestId('tool-teleport'));
    await fireEvent.press(view.getByTestId('teleport-endless-2'));
    expect(run.inventory.teleport).toBe(0);
    expect(latestCanvas().state.pocketId).toBe('endless-2');
    expect(view.getByTestId('launch-score').props.children).toBe(1);
    expect(view.queryByTestId('teleport-selection')).toBeNull();
    expect(readback).not.toHaveBeenCalled();
    await view.unmount();
  });

  test('one free Revive returns from death and Play again clears earned tools', async () => {
    const run = endless.createEndlessRun(0);
    grantFreeTool(run, 'revive');
    jest.spyOn(endless, 'createEndlessRun').mockReturnValueOnce(run);
    const view = await render(<EndlessGameScreen {...harness()} />);
    await measure(view);
    await drag({ x: 70, y: 0 });
    await runFrames(180);
    await fireEvent.press(view.getByTestId('launch-revive-button'));
    expect(latestCanvas().state.phase).toBe('held');
    expect(run.reviveUsed).toBe(true);
    await drag({ x: 70, y: 0 });
    await runFrames(180);
    expect(view.queryByTestId('launch-revive-button')).toBeNull();
    await fireEvent.press(view.getByTestId('launch-restart-button'));
    await measure(view);
    expect(latestCanvas().state.phase).toBe('held');
    expect(view.queryByTestId('tool-revive')).toBeNull();
    expect(view.getByTestId('free-tool-slots').props.accessibilityLabel).toContain('Free tools, 0 of 3.');
    await view.unmount();
  });

  test('an unavailable points shop pauses a flight and closes without spending or activating a tool', async () => {
    const view = await render(<EndlessGameScreen {...harness()} />);
    await measure(view);
    await drag({ x: -24, y: 72 });
    await runFrames(3);
    await fireEvent.press(view.getByTestId('tool-box'));
    await fireEvent.press(view.getByTestId('toolbox-teleport'));
    await fireEvent.press(view.getAllByLabelText(/Land in visible pocket/)[0]);
    await fireEvent.press(view.getByTestId('tool-get-points'));
    expect(view.getByTestId('points-shop')).toBeTruthy();
    expect(view.getByTestId('points-shop-balance').props.children).toEqual([0, ' points']);
    expect(view.getByText('Points shop unavailable')).toBeTruthy();
    const tick = latestCanvas().motion.tick.value;
    await runFrames(100);
    expect(latestCanvas().motion.tick.value).toBe(tick);
    await fireEvent.press(view.getByTestId('points-shop-close'));
    await runFrames(3);
    expect(latestCanvas().motion.tick.value).toBe(tick + 4);
    expect(latestCanvas().previewActive).toBe(false);
    await view.unmount();
  });

  test('route choice is available in the hint and to screen readers', async () => {
    const actual = jest.requireActual<typeof import('../../../game/launch/useLaunchSession')>(
      '../../../game/launch/useLaunchSession',
    );
    jest.mocked(useLaunchSession).mockImplementation((...args) => ({
      ...actual.useLaunchSession(...args), hasAimed: true, challenge: undefined,
      nextPocketIds: ['wide-route', 'reward-route'],
      routeCue: 'Choose the wide pocket, or follow the star for a free tool.',
    }));
    const view = await render(<EndlessGameScreen {...harness()} />);
    await measure(view, 320, 568);
    expect(within(view.getByTestId('launch-challenge-cue')).getByText('Choose the wide pocket, or follow the star for a free tool.')).toBeTruthy();
    expect(view.getByTestId('launch-status').props.children).toBe('Choose the wide pocket, or follow the star for a free tool.');
    await drag({ x: -24, y: 72 });
    expect(view.queryByTestId('launch-challenge-cue')).toBeNull();
    await view.unmount();
  });

  test('temporary-pocket countdown remains visible with hints disabled and expiry disables the gesture', async () => {
    usePreferencesStore.setState({ tutorialHintsEnabled: false });
    const run = endless.createEndlessRun(0);
    run.room = { ...run.room, pockets: run.room.pockets.map((pocket) => pocket.id === run.state.pocketId
      ? { ...pocket, frayTicks: 480 } : pocket) };
    run.state.pocketExpiryTicks = { [run.state.pocketId]: 480 };
    jest.spyOn(endless, 'createEndlessRun').mockReturnValueOnce(run);
    const view = await render(<EndlessGameScreen {...harness()} />);
    await measure(view);
    expect(within(view.getByTestId('launch-challenge-cue')).getByText('Loose pocket · 4 seconds to launch')).toBeTruthy();
    await runFrames(122);
    expect(view.getByTestId('launch-status').props.children).toBe('Loose pocket · 2 seconds to launch');
    await runFrames(120);
    expect(latestCanvas().state.phase).toBe('flying');
    expect(view.queryByTestId('launch-challenge-cue')).toBeNull();
    const gesture = getByGestureTestId('launch-pull-gesture') as ReturnType<typeof Gesture.Pan>;
    expect(gesture.config.enabled).toBe(false);
    await runFrames(90);
    expect(within(view.getByTestId('launch-game-over')).getByText('The pocket unraveled before you launched.')).toBeTruthy();
    await fireEvent.press(view.getByTestId('launch-restart-button'));
    await measure(view);
    expect(latestCanvas().state.phase).toBe('held');
    expect(view.queryByTestId('launch-game-over')).toBeNull();
    await view.unmount();
  });

  test('teaches wall rebounds and lower-pocket recovery after the first catch without obscuring the first launch', async () => {
    const run = endless.createEndlessRun(0);
    run.room = { ...run.room, sideWallRestitution: 0.8 };
    jest.spyOn(endless, 'createEndlessRun').mockReturnValueOnce(run);
    const view = await render(<EndlessGameScreen {...harness()} />);
    await measure(view, 320, 568);
    expect(view.getByTestId('launch-playfield').props.accessibilityLabel).toContain('Padded side walls bounce you back, and lower pockets can catch your fall.');
    expect(view.getByTestId('launch-instruction').props.children).toBe('Pull the button down and left. Let go to catch the pocket above.');
    await drag({ x: -24, y: 72 });
    await runFrames(160);
    expect(view.getByTestId('launch-score').props.children).toBe(1);
    expect(within(view.getByTestId('launch-challenge-cue')).getByText('The padded sides bounce you back. A lower pocket can save a fall.')).toBeTruthy();
    await drag({ x: 0, y: 60 });
    expect(view.queryByTestId('launch-challenge-cue')).toBeNull();
    await view.unmount();
  });

  test('creative setup keeps actions reachable with enlarged text in a compact viewport', async () => {
    jest.mocked(useWindowDimensions).mockReturnValue({ width: 320, height: 568, scale: 2, fontScale: 2 });
    const view = await render(<EndlessGameScreen {...harness()} />);
    await measure(view, 320, 568);
    await fireEvent.press(view.getByTestId('tool-box'));
    await fireEvent.press(view.getByTestId('toolbox-bounce'));
    const footer = within(view.getByTestId('tool-setup-footer'));
    const details = within(view.getByTestId('tool-setup-details'));
    expect(view.queryByTestId('launch-hud')).toBeNull();
    expect(view.queryByTestId('launch-tool-tray')).toBeNull();
    expect(footer.getByTestId('tool-setup-cancel')).toBeTruthy();
    expect(footer.queryByTestId('tool-setup-confirm') ?? footer.getByTestId('tool-setup-points')).toBeTruthy();
    expect(details.queryByTestId('tool-setup-cancel')).toBeNull();
    expect(details.getByTestId('tool-x-decrease')).toBeTruthy();
    expect(details.getByTestId('tool-angle-increase')).toBeTruthy();
    await fireEvent.press(footer.getByTestId('tool-setup-cancel'));
    expect(view.getByTestId('launch-hud')).toBeTruthy();
    expect(latestCanvas().state.toolEffects?.bounce).toBeUndefined();
    await view.unmount();
  });

});
