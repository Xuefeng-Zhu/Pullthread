/** @jest-environment node */
import { act, renderHook } from '@testing-library/react-native';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { AppState, type AppStateStatus } from 'react-native';

import { NoopFeedbackService } from '../../feedback/FeedbackService';
import * as endless from '../endless';
import { useLaunchSession } from '../useLaunchSession';
import { deserializeEndlessRun, serializeEndlessRun } from '../snapshots';

const { createEndlessRun } = endless;
const seed = 14;
const start = { x: 80, y: 490 };

describe('launch session lifecycle', () => {
  let timestamp: number;
  let sequence: number;
  let frames: Map<number, FrameRequestCallback>;
  let appStateListener: (state: AppStateStatus) => void;
  let removeListener: jest.Mock;
  let feedback: NoopFeedbackService;
  const originalAppState = AppState.currentState;

  beforeEach(() => {
    timestamp = 0;
    sequence = 0;
    frames = new Map();
    feedback = new NoopFeedbackService();
    jest.spyOn(feedback, 'play');
    AppState.currentState = 'active';
    removeListener = jest.fn();
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
      appStateListener = listener;
      return { remove: removeListener };
    });
    jest.spyOn(global, 'requestAnimationFrame').mockImplementation((callback) => {
      const id = ++sequence;
      frames.set(id, callback);
      return id;
    });
    jest.spyOn(global, 'cancelAnimationFrame').mockImplementation((id) => { if (typeof id === 'number') frames.delete(id); });
  });

  afterEach(() => {
    AppState.currentState = originalAppState;
    jest.restoreAllMocks();
  });

  async function frame(elapsed = 1000 / 60) {
    await act(() => {
      timestamp += elapsed;
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback(timestamp));
    });
  }

  async function changeAppState(next: AppStateStatus) {
    await act(() => { AppState.currentState = next; appStateListener(next); });
  }

  test('backgrounding cancels a stretched gesture and resuming discards elapsed wall time', async () => {
    const view = await renderHook(() => useLaunchSession(seed, true, feedback));
    await frame();
    await frame();
    const before = view.result.current.motion.tick.value;
    await act(() => {
      expect(view.result.current.beginAim(start)).toBe(true);
      view.result.current.updateAim({ x: -20, y: 70 });
    });
    expect(view.result.current.motion.travelerY.value).toBe(560);
    await changeAppState('background');
    expect(view.result.current.motion.pullY.value).toBe(0);
    expect(view.result.current.motion.travelerY.value).toBe(490);
    await frame(30_000);
    expect(view.result.current.motion.tick.value).toBe(before);
    await changeAppState('active');
    await act(() => view.result.current.releaseAim());
    await frame(30_000);
    expect(view.result.current.motion.tick.value).toBe(before);
    expect(view.result.current.state.phase).toBe('held');
    expect(view.result.current.state.launches).toBe(0);
    await frame();
    expect(view.result.current.motion.tick.value).toBe(before + 2);
    await view.unmount();
    expect(frames.size).toBe(0);
    expect(removeListener).toHaveBeenCalledTimes(1);
  });

  test('blur cancels aiming and freezes a flight until focus resumes', async () => {
    const view = await renderHook(({ active }: { active: boolean }) => useLaunchSession(seed, active, feedback), { initialProps: { active: true } });
    await frame();
    await act(() => {
      view.result.current.beginAim(start);
      view.result.current.updateAim({ x: -20, y: 70 });
    });
    await view.rerender({ active: false });
    await act(() => view.result.current.releaseAim());
    expect(view.result.current.state.launches).toBe(0);
    expect(view.result.current.motion.pullY.value).toBe(0);
    await view.rerender({ active: true });
    await act(() => {
      view.result.current.beginAim(start);
      view.result.current.updateAim({ x: -20, y: 70 });
      view.result.current.releaseAim();
    });
    await frame();
    await frame();
    const position = { x: view.result.current.motion.travelerX.value, y: view.result.current.motion.travelerY.value };
    const tick = view.result.current.motion.tick.value;
    await view.rerender({ active: false });
    await frame(10_000);
    expect(view.result.current.motion.tick.value).toBe(tick);
    expect(view.result.current.motion.travelerY.value).toBe(position.y);
    await view.rerender({ active: true });
    await frame(10_000);
    expect(view.result.current.motion.tick.value).toBe(tick);
    await frame();
    expect(view.result.current.motion.tick.value).toBe(tick + 2);
    expect(view.result.current.motion.travelerY.value).toBeLessThan(position.y);
    await view.unmount();
  });

  test('cancelled gestures and taps do not launch, and flying buttons ignore new aim input', async () => {
    const view = await renderHook(() => useLaunchSession(seed, true, feedback));
    await act(() => {
      expect(view.result.current.beginAim({ x: 400, y: 100 })).toBe(false);
      view.result.current.updateAim({ x: -20, y: 70 });
      view.result.current.releaseAim();
      view.result.current.beginAim(start);
      view.result.current.updateAim({ x: -20, y: 70 });
      view.result.current.cancelAim();
      view.result.current.releaseAim();
      view.result.current.beginAim(start);
      view.result.current.updateAim({ x: 2, y: 3 });
      view.result.current.releaseAim();
    });
    expect(view.result.current.state.launches).toBe(0);
    await act(() => {
      view.result.current.beginAim(start);
      view.result.current.updateAim({ x: -20, y: 70 });
      view.result.current.releaseAim();
    });
    const velocity = view.result.current.state.velocity;
    await act(() => {
      expect(view.result.current.beginAim({ x: 60, y: 560 })).toBe(false);
      view.result.current.updateAim({ x: 100, y: -100 });
      view.result.current.releaseAim();
    });
    expect(view.result.current.state.launches).toBe(1);
    expect(view.result.current.state.velocity).toEqual(velocity);
    expect(feedback.play).toHaveBeenCalledWith('travelerRelease');
    await view.unmount();
  });

  test('a new pocket increases the score once and the camera follows the continuing climb', async () => {
    const view = await renderHook(() => useLaunchSession(seed, true, feedback));
    await frame();
    await act(() => {
      view.result.current.beginAim(start);
      view.result.current.updateAim({ x: -24, y: 72 });
      view.result.current.releaseAim();
    });
    for (let count = 0; count < 160 && view.result.current.state.phase === 'flying'; count += 1) await frame();
    expect(view.result.current.state.phase).toBe('held');
    expect(view.result.current.state.position.y).toBeLessThan(start.y);
    expect(view.result.current.score.pockets).toBe(1);
    expect(view.result.current.score.height).toBeGreaterThan(0);
    expect(view.result.current.motion.cameraY.value).toBeLessThan(0);
    const caughtId = view.result.current.state.pocketId;
    await act(() => {
      view.result.current.beginAim(view.result.current.state.position);
      view.result.current.updateAim({ x: 0, y: 60 });
    });
    const aimingCamera = view.result.current.motion.cameraY.value;
    const aimingTick = view.result.current.motion.tick.value;
    for (let count = 0; count < 60; count += 1) await frame();
    expect(view.result.current.motion.cameraY.value).toBe(aimingCamera);
    expect(view.result.current.motion.tick.value).toBe(aimingTick + 120);
    await act(() => view.result.current.releaseAim());
    for (let count = 0; count < 160 && view.result.current.state.phase === 'flying'; count += 1) await frame();
    expect(view.result.current.state.phase).toBe('held');
    expect(view.result.current.state.pocketId).toBe(caughtId);
    expect(view.result.current.score.pockets).toBe(1);
    await view.unmount();
  });

  test('death is permanent until a fresh session starts, even after waiting or sending more input', async () => {
    const view = await renderHook(() => useLaunchSession(seed, true, feedback));
    await frame();
    await act(() => {
      view.result.current.beginAim(start);
      view.result.current.updateAim({ x: 70, y: 0 });
      view.result.current.releaseAim();
    });
    for (let count = 0; count < 160 && view.result.current.state.phase === 'flying'; count += 1) await frame();
    expect(view.result.current.state.phase).toBe('failed');
    const dead = view.result.current.state;
    for (let count = 0; count < 120; count += 1) await frame();
    await act(() => {
      expect(view.result.current.beginAim(dead.position)).toBe(false);
      view.result.current.updateAim({ x: -20, y: 70 });
      view.result.current.releaseAim();
    });
    expect(view.result.current.state).toEqual(dead);
    await view.unmount();
    const fresh = await renderHook(() => useLaunchSession(seed + 1, true, feedback));
    expect(fresh.result.current.state.phase).toBe('held');
    expect(fresh.result.current.state.launches).toBe(0);
    expect(fresh.result.current.state.position).toEqual(start);
    expect(fresh.result.current.score.pockets).toBe(0);
    await fresh.unmount();
  });

  test('a bottom-edge recatch never converts a tap or downward pull into an upward launch', async () => {
    const caught = createEndlessRun(0);
    // Isolate a deep vertical recatch from authored route obstacles. This
    // specifically exercises the camera floor and touch clamp, not route choice.
    caught.room = { ...caught.room, pockets: [caught.room.pockets[0]], bumpers: [], hazards: [] };
    expect(endless.launchEndless(caught, { x: 0, y: 96.8 })).toBe(true);
    for (let tick = 0; tick < 960 && caught.state.phase === 'flying'; tick += 1) endless.stepEndless(caught);
    expect(caught.state.phase).toBe('held');
    const screenY = caught.state.position.y - caught.cameraY;
    expect(screenY).toBeGreaterThan(588);
    expect(screenY).toBeLessThan(600);
    const launches = caught.state.launches;
    const position = { ...caught.state.position };
    jest.spyOn(endless, 'createEndlessRun').mockReturnValueOnce(caught);
    const view = await renderHook(() => useLaunchSession(0, true, feedback));

    for (const pull of [{ x: 0, y: 0 }, { x: 0, y: 50 }]) {
      await act(() => {
        expect(view.result.current.beginAim(position)).toBe(true);
        view.result.current.updateAim(pull);
      });
      expect(view.result.current.motion.pullY.value).toBe(0);
      await act(() => view.result.current.releaseAim());
      expect(view.result.current.state.phase).toBe('held');
      expect(view.result.current.state.position).toEqual(position);
      expect(view.result.current.state.launches).toBe(launches);
    }
    await view.unmount();
  });

  test('suspending and resuming without an intervening RAF cancels the pull and discards the entire modal interval', async () => {
    const view = await renderHook(() => useLaunchSession(seed, true, feedback));
    await frame();
    await frame();
    const tick = view.result.current.motion.tick.value;
    await act(() => {
      view.result.current.beginAim(start);
      view.result.current.updateAim({ x: -20, y: 70 });
      view.result.current.suspend();
    });
    expect(view.result.current.motion.pullY.value).toBe(0);
    await act(() => {
      expect(view.result.current.beginAim(start)).toBe(false);
      view.result.current.resume();
      view.result.current.releaseAim();
    });
    await frame(30_000);
    expect(view.result.current.motion.tick.value).toBe(tick);
    expect(view.result.current.state.launches).toBe(0);
    await frame();
    expect(view.result.current.motion.tick.value).toBe(tick + 2);
    await view.unmount();
  });

  test('an armed Preview survives cancellation and backgrounding while fresh predictions follow moving-target time', async () => {
    const prepared = createEndlessRun(0);
    prepared.inventory.preview = 2;
    prepared.room = { ...prepared.room, pockets: prepared.room.pockets.map((pocket) => pocket.id === 'endless-1'
      ? { ...pocket, motion: { amplitude: 35, periodTicks: 360, phaseTicks: 0 } } : pocket) };
    const view = await renderHook(() => useLaunchSession(0, true, feedback));
    await act(() => {
      expect(view.result.current.restoreSnapshot(serializeEndlessRun(prepared))).toBe(true);
      expect(view.result.current.useFreeTool('preview')).toBe(true);
      view.result.current.beginAim(start);
      view.result.current.updateAim({ x: -24, y: 72 });
    });
    const prediction = view.result.current.prediction;
    expect(prediction?.outcome).toBe('catch');
    for (let count = 0; count < 6; count += 1) await frame();
    expect(view.result.current.prediction).not.toEqual(prediction);
    await act(() => view.result.current.cancelAim());
    expect(view.result.current.prediction).toBeNull();
    expect(view.result.current.tools).toMatchObject({ previewActive: true, inventory: { preview: 1 } });
    await act(() => {
      view.result.current.beginAim(start);
      view.result.current.updateAim({ x: -24, y: 72 });
    });
    await changeAppState('background');
    expect(view.result.current.prediction).toBeNull();
    expect(view.result.current.tools.previewActive).toBe(true);
    await changeAppState('active');
    await act(() => {
      view.result.current.releaseAim();
      view.result.current.beginAim(start);
      view.result.current.updateAim({ x: 1, y: 2 });
      view.result.current.releaseAim();
    });
    expect(view.result.current.tools.previewActive).toBe(true);
    expect(view.result.current.state.launches).toBe(0);
    await act(() => {
      view.result.current.beginAim(start);
      view.result.current.updateAim({ x: -24, y: 72 });
      view.result.current.releaseAim();
    });
    expect(view.result.current.tools.previewActive).toBe(false);
    expect(view.result.current.tools.inventory.preview).toBe(1);
    expect(view.result.current.prediction).toBeNull();
    await view.unmount();
  });

  test('free Teleport publishes the arrival and revive restores its checkpoint with a fresh render clock', async () => {
    const prepared = createEndlessRun(0);
    prepared.inventory = { preview: 0, teleport: 1, revive: 1 };
    const view = await renderHook(() => useLaunchSession(0, true, feedback));
    await act(() => { view.result.current.restoreSnapshot(serializeEndlessRun(prepared)); });
    await frame();
    await frame();
    await act(() => { expect(view.result.current.useFreeTool('teleport', 'endless-1')).toBe(true); });
    const checkpointTick = view.result.current.state.tick;
    expect(view.result.current.state.pocketId).toBe('endless-1');
    expect(view.result.current.score.pockets).toBe(1);
    expect(view.result.current.tools.inventory.teleport).toBe(0);
    expect(view.result.current.motion.travelerX.value).toBe(240);
    await frame(1000);
    expect(view.result.current.motion.tick.value).toBe(checkpointTick);
    await act(() => {
      view.result.current.beginAim(view.result.current.state.position);
      view.result.current.updateAim({ x: -100, y: 0 });
      view.result.current.releaseAim();
    });
    for (let count = 0; count < 160 && view.result.current.state.phase === 'flying'; count += 1) await frame();
    expect(view.result.current.state.phase).toBe('failed');
    await act(() => { expect(view.result.current.useFreeTool('revive')).toBe(true); });
    expect(view.result.current.state.phase).toBe('held');
    expect(view.result.current.state.pocketId).toBe('endless-1');
    expect(view.result.current.state.tick).toBe(checkpointTick);
    expect(view.result.current.tools).toMatchObject({ reviveUsed: true, inventory: { revive: 0 } });
    expect(view.result.current.score.pockets).toBe(1);
    await frame(1000);
    expect(view.result.current.motion.tick.value).toBe(checkpointTick);
    await view.unmount();
  });

  test('preparing a paid result is isolated and restoring the same journal result is idempotent', async () => {
    const prepared = createEndlessRun(0);
    prepared.inventory.teleport = 1;
    const view = await renderHook(() => useLaunchSession(0, true, feedback));
    await act(() => { view.result.current.restoreSnapshot(serializeEndlessRun(prepared)); });
    await frame();
    await frame();
    const before = view.result.current.getSnapshot();
    const paid = view.result.current.preparePaidTool('teleport', 'endless-1');
    expect(view.result.current.getSnapshot()).toBe(before);
    expect(deserializeEndlessRun(paid)!.inventory.teleport).toBe(1);
    for (let retry = 0; retry < 2; retry += 1) {
      await act(() => { expect(view.result.current.restoreSnapshot(paid)).toBe(true); });
      expect(view.result.current.state.pocketId).toBe('endless-1');
      expect(view.result.current.score.pockets).toBe(1);
      expect(view.result.current.tools.inventory.teleport).toBe(1);
    }
    const restoredTick = view.result.current.motion.tick.value;
    await frame(1000);
    expect(view.result.current.motion.tick.value).toBe(restoredTick);
    const valid = view.result.current.getSnapshot();
    await act(() => { expect(view.result.current.restoreSnapshot('{')).toBe(false); });
    expect(view.result.current.getSnapshot()).toBe(valid);
    await view.unmount();
  });
});
