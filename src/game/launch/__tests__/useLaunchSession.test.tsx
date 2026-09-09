/** @jest-environment node */
import { RankedJournal } from '../../../leaderboard/journal';
import { createRankedSimulation, replayBatch } from '../../../leaderboard/replay';
import type { LeaderboardService, ReplayBatch } from '../../../leaderboard/contracts';
import { act, renderHook } from '@testing-library/react-native';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { AppState, type AppStateStatus } from 'react-native';

import { NoopFeedbackService } from '../../feedback/FeedbackService';
import * as endless from '../endless';
import { useLaunchSession } from '../useLaunchSession';
import { grantFreeTool } from '../toolInventory';
import { deserializeEndlessRun, serializeEndlessRun } from '../snapshots';
import { createLaunchState, launchVelocity, pocketPosition } from '../simulation';
import { findTargetInput, replayNext } from '../testing/routeSolver';

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

  test.each([30, 60, 120])('ranked journal matches the actual hook at %i FPS across gestures and backgrounding', async (fps) => {
    const batches: ReplayBatch[] = [];
    const ranked = new RankedJournal({ id: 'hook-ranked', uid: 'guest', environment: 'sandbox', seed, week: 0, deadline: 9999999999999, ruleset: 'stitched-v4-weekly-1' },
      { getItem: async () => null, setItem: async () => undefined, removeItem: async () => undefined },
      { upload: async (_id, batch) => { batches.push(batch); return { sequence: batch.sequence, score: 0 }; } } as LeaderboardService);
    const view = await renderHook(() => useLaunchSession(seed, true, feedback, ranked));
    await frame(1000 / fps);
    await act(() => { view.result.current.beginAim(start); view.result.current.updateAim({ x: -20, y: 70 }); });
    for (let i = 0; i < fps / 2; i++) await frame(1000 / fps);
    await changeAppState('background'); await frame(5000); await changeAppState('active'); await frame(1000 / fps);
    await act(() => { view.result.current.beginAim(start); view.result.current.updateAim({ x: -20, y: 70 }); view.result.current.releaseAim(); });
    for (let i = 0; i < fps * 2; i++) await frame(1000 / fps);
    const final = view.result.current.getSnapshot();
    await ranked.checkpoint(final); await ranked.flush();
    const replay = createRankedSimulation(seed), cursor = { elapsed: 0, aiming: false };
    for (const batch of batches) await replayBatch(replay, cursor, batch);
    expect(serializeEndlessRun(replay)).toBe(final);
    await view.unmount();
  });

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

  test('aim updates return the applied clamp and the motion container survives event rerenders', async () => {
    const view = await renderHook(() => useLaunchSession(seed, true, feedback));
    const motion = view.result.current.motion;
    await act(() => {
      expect(view.result.current.updateAim({ x: -24, y: 72 })).toBeNull();
      expect(view.result.current.beginAim(start)).toBe(true);
      expect(view.result.current.updateAim({ x: -100, y: 0 })).toEqual({ x: -68, y: 0 });
    });
    expect(view.result.current.motion).toBe(motion);
    expect(motion.travelerX.value).toBe(12);
    await act(() => {
      expect(view.result.current.updateAim({ x: 0, y: 500 })).toEqual({ x: 0, y: 98 });
      expect(view.result.current.updateAim({ x: -24, y: 72 })).toEqual({ x: -24, y: 72 });
      view.result.current.releaseAim();
      expect(view.result.current.updateAim({ x: 90, y: -90 })).toBeNull();
    });
    expect(view.result.current.motion).toBe(motion);
    await frame();
    for (let count = 0; count < 160 && view.result.current.state.phase === 'flying'; count += 1) await frame();
    expect(view.result.current.score.pockets).toBe(1);
    expect(view.result.current.motion).toBe(motion);
    expect(view.result.current.getCameraY()).toBe(motion.cameraY.value);
    await view.unmount();
  });

  test('Land targets use the live simulation clock and stay coherent while suspended', async () => {
    const prepared = endless.createWorldEndlessRun(0);
    grantFreeTool(prepared, 'teleport');
    prepared.room = { ...prepared.room, pockets: prepared.room.pockets.map((pocket) => pocket.id === 'endless-1'
      ? { ...pocket, motion: { amplitude: 35, periodTicks: 360, phaseTicks: 0 } } : pocket) };
    const receiver = prepared.room.pockets.find((pocket) => pocket.id === 'endless-1')!;
    const view = await renderHook(() => useLaunchSession(0, true, feedback));
    await act(() => { view.result.current.restoreSnapshot(serializeEndlessRun(prepared)); });
    for (let count = 0; count < 22; count += 1) await frame();
    expect(view.result.current.motion.tick.value).toBeGreaterThan(view.result.current.state.tick);
    await act(() => view.result.current.suspend());
    const tick = view.result.current.motion.tick.value;
    const targets = view.result.current.getTeleportTargets();
    const target = targets.pockets.find((pocket) => pocket.id === receiver.id)!;
    expect(target).toEqual({ id: receiver.id, width: receiver.width, ...pocketPosition(receiver, tick) });
    expect(target.x).not.toBe(receiver.center.x);
    expect(targets.cameraY).toBe(view.result.current.getCameraY());
    await changeAppState('background');
    await frame(30_000);
    await changeAppState('active');
    await frame(30_000);
    expect(view.result.current.getTeleportTargets()).toEqual(targets);
    await act(() => {
      expect(view.result.current.useFreeTool('teleport', target.id)).toBe(true);
    });
    expect(view.result.current.state.position).toEqual({ x: target.x, y: target.y });
    expect(view.result.current.room.pockets.find((pocket) => pocket.id === target.id)?.motion).toBeUndefined();
    await view.unmount();
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

  test('a legacy bottom-edge recatch never converts a tap or downward pull into an upward launch', async () => {
    const caught = createEndlessRun(0, 1);
    // Historical runs keep their upward-only camera. Isolate a deep recatch to
    // preserve the touch-clamp regression for a resumed legacy session.
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
    const prepared = endless.createWorldEndlessRun(0);
    grantFreeTool(prepared, 'preview');
    grantFreeTool(prepared, 'preview');
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
    grantFreeTool(prepared, 'teleport');
    grantFreeTool(prepared, 'revive');
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
    grantFreeTool(prepared, 'teleport');
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

  test.each([
    { pickupKind: 'needle' as const, awardedKind: 'needle', text: '+1 Needle Tip.' },
    { pickupKind: 'revive' as const, awardedKind: 'preview', text: '+1 Preview. Your extra Revive became a Preview.' },
  ])('a fourth $pickupKind pickup publishes its replacement through the arrival', async ({ pickupKind, awardedKind, text }) => {
    const prepared = createEndlessRun(seed);
    grantFreeTool(prepared, 'sail');
    grantFreeTool(prepared, 'revive');
    grantFreeTool(prepared, 'teleport');
    const receiver = prepared.room.pockets.find(pocket => pocket.id === 'endless-1')!;
    const position = pocketPosition(receiver, prepared.state.tick + 1);
    const center = { x: position.x, y: position.y - 2 };
    prepared.room = { ...prepared.room, pickups: [{ id: 'replacement-pickup', kind: pickupKind, center, radius: 14 }] };
    Object.assign(prepared.state, { phase: 'flying', position: { ...center }, velocity: { x: 0, y: 480 }, sourcePocketImmune: false });
    jest.spyOn(endless, 'createEndlessRun').mockReturnValueOnce(prepared);
    const view = await renderHook(() => useLaunchSession(seed, true, feedback));
    const initialQueue = view.result.current.tools.freeToolQueue;
    expect(initialQueue).toEqual(['sail', 'revive', 'teleport']);
    await frame();
    await frame();
    expect(view.result.current.state.phase).toBe('held');
    expect(view.result.current.state.pocketId).toBe(receiver.id);
    expect(view.result.current.tools.freeToolQueue).toEqual(['revive', 'teleport', awardedKind]);
    expect(initialQueue).toEqual(['sail', 'revive', 'teleport']);
    expect(view.result.current.message).toBe(`${text} Replaced your oldest free tool: Silk Sail.`);
    expect(view.result.current.tools.inventory.sail).toBe(0);
    expect(Object.values(view.result.current.tools.inventory).reduce((total, count) => total + count, 0)).toBe(3);
    await act(() => { expect(view.result.current.beginAim(view.result.current.state.position)).toBe(true); });
    expect(view.result.current.message).toBe('Pull back, then let go.');
    await view.unmount();
  });

  test('a section without a gift describes its routes without promising a tool', async () => {
    const prepared = endless.createWorldEndlessRun(0);
    while (prepared.state.pocketId !== prepared.sectionProgress!.sections[0].exitPocketId) {
      const targets = endless.nextEndlessTargets(prepared);
      const target = targets.find((id) => prepared.room.pockets.find((pocket) => pocket.id === id)?.route !== 'reward') ?? targets[0];
      replayNext(prepared, findTargetInput(prepared, target));
    }
    const section = prepared.sectionProgress!.sections.find((candidate) => candidate.entryPocketId === prepared.state.pocketId)!;
    expect(section.index).toBe(1);
    expect(section.pickupIds).toEqual([]);
    const view = await renderHook(() => useLaunchSession(0, true, feedback));
    await act(() => { expect(view.result.current.restoreSnapshot(serializeEndlessRun(prepared))).toBe(true); });
    expect(view.result.current.routeCue).toBe('Choose the wide pocket, or try the narrower star pocket.');
    expect(view.result.current.challenge?.cue).not.toMatch(/tool|gift/);
    await view.unmount();
  });

  test('revisiting a branch after collecting its gift removes the tool promise from both hints', async () => {
    const prepared = endless.createWorldEndlessRun(0);
    for (let opening = 0; opening < 2; opening += 1) {
      replayNext(prepared, findTargetInput(prepared, prepared.nextPocketId));
    }
    const parent = prepared.state.pocketId;
    const giftId = prepared.sectionProgress!.sections[0].pickupIds[0];
    const view = await renderHook(() => useLaunchSession(0, true, feedback));
    await act(() => { expect(view.result.current.restoreSnapshot(serializeEndlessRun(prepared))).toBe(true); });
    expect(view.result.current.routeCue).toContain('for a free tool');
    for (let hop = 0; hop < 3 && prepared.room.pickups!.some((pickup) => pickup.id === giftId); hop += 1) {
      const target = endless.nextEndlessTargets(prepared)
        .find((id) => prepared.room.pockets.find((pocket) => pocket.id === id)?.route === 'reward')!;
      replayNext(prepared, findTargetInput(prepared, target));
    }
    expect(prepared.collectedPickupIds).toContain(giftId);
    prepared.cameraY = prepared.room.pockets.find((pocket) => pocket.id === parent)!.center.y - 250;
    expect(endless.teleportEndless(prepared, parent, true)).toBe(true);
    await act(() => { expect(view.result.current.restoreSnapshot(serializeEndlessRun(prepared))).toBe(true); });
    expect(view.result.current.routeCue).toBe('Choose the wide pocket, or try the narrower star pocket.');
    expect(view.result.current.challenge?.cue).not.toMatch(/tool|gift/);
    await view.unmount();
  });

  test('temporary-pocket expiry cancels an active pull and preview while publishing the fall', async () => {
    const prepared = endless.createWorldEndlessRun(0);
    prepared.room = { ...prepared.room, pockets: prepared.room.pockets.map((pocket) => pocket.id === prepared.state.pocketId
      ? { ...pocket, frayTicks: 480, route: 'reward' as const } : pocket) };
    prepared.state.pocketExpiryTicks = { [prepared.state.pocketId]: 480 };
    grantFreeTool(prepared, 'preview');
    jest.spyOn(endless, 'createEndlessRun').mockReturnValueOnce(prepared);
    let renders = 0;
    const view = await renderHook(() => { renders += 1; return useLaunchSession(0, true, feedback); });
    await act(() => {
      expect(view.result.current.useFreeTool('preview')).toBe(true);
      expect(view.result.current.beginAim(start)).toBe(true);
      view.result.current.updateAim({ x: -24, y: 72 });
    });
    expect(view.result.current.prediction).not.toBeNull();
    expect(view.result.current.fraySeconds).toBe(4);
    // The React copy cannot alias the mutable simulation's deadline map.
    expect(view.result.current.state.pocketExpiryTicks).not.toBe(prepared.state.pocketExpiryTicks);
    await act(() => view.result.current.cancelAim());
    await frame();
    const before = renders;
    for (let count = 0; count < 30; count += 1) await frame();
    expect(renders).toBe(before);
    await act(() => {
      view.result.current.beginAim(start);
      view.result.current.updateAim({ x: -24, y: 72 });
    });
    for (let count = 0; count < 210; count += 1) await frame();
    expect(view.result.current.state.phase).toBe('flying');
    expect(view.result.current.state.event?.type).toBe('fray');
    expect(view.result.current.motion.pullX.value).toBe(0);
    expect(view.result.current.motion.pullY.value).toBe(0);
    expect(view.result.current.prediction).toBeNull();
    expect(view.result.current.fraySeconds).toBeNull();
    expect(view.result.current.message).toBe('That pocket unraveled. Find a landing!');
    await act(() => {
      expect(view.result.current.updateAim({ x: -40, y: 80 })).toBeNull();
      view.result.current.releaseAim();
    });
    expect(view.result.current.state.launches).toBe(0);
    for (let count = 0; count < 90 && view.result.current.state.phase === 'flying'; count += 1) await frame();
    expect(view.result.current.message).toBe('The pocket unraveled before you launched.');
    await view.unmount();
  });

  test('temporary-pocket accessible countdown freezes through tool suspension and backgrounding', async () => {
    const prepared = endless.createWorldEndlessRun(0);
    prepared.room = { ...prepared.room, pockets: prepared.room.pockets.map((pocket) => pocket.id === prepared.state.pocketId
      ? { ...pocket, frayTicks: 480 } : pocket) };
    prepared.state.pocketExpiryTicks = { [prepared.state.pocketId]: 480 };
    jest.spyOn(endless, 'createEndlessRun').mockReturnValueOnce(prepared);
    const view = await renderHook(() => useLaunchSession(0, true, feedback));
    for (let count = 0; count < 62; count += 1) await frame();
    expect(view.result.current.fraySeconds).toBe(3);
    const tick = view.result.current.motion.tick.value;
    await act(() => view.result.current.suspend());
    await changeAppState('background');
    await frame(30_000);
    await changeAppState('active');
    await frame(30_000);
    expect(view.result.current.fraySeconds).toBe(3);
    expect(view.result.current.motion.tick.value).toBe(tick);
    await act(() => view.result.current.resume());
    await frame(30_000);
    expect(view.result.current.motion.tick.value).toBe(tick);
    await frame();
    expect(view.result.current.motion.tick.value).toBe(tick + 2);
    await view.unmount();
  });

  test('a visited branch stops being advertised at its deadline while waiting in its parent without events', async () => {
    const prepared = endless.createWorldEndlessRun(0);
    let expiredTarget = '';
    let parent = '';
    // Reach a real generated temporary branch, then return with a legal tool.
    for (let catchIndex = 0; catchIndex < 40 && !expiredTarget; catchIndex += 1) {
      const ids = endless.nextEndlessTargets(prepared);
      const temporary = ids.find((id) => prepared.room.pockets.find((pocket) => pocket.id === id)?.frayTicks);
      const target = temporary ?? ids.find((id) => prepared.room.pockets.find((pocket) => pocket.id === id)?.route === 'reward') ?? ids[0];
      parent = prepared.state.pocketId;
      replayNext(prepared, findTargetInput(prepared, target));
      if (temporary) expiredTarget = temporary;
    }
    expect(expiredTarget).not.toBe('');
    expect(endless.teleportEndless(prepared, parent, true)).toBe(true);
    const restored = serializeEndlessRun(prepared);
    let renders = 0;
    const view = await renderHook(() => { renders += 1; return useLaunchSession(0, true, feedback); });
    await act(() => { expect(view.result.current.restoreSnapshot(restored)).toBe(true); });
    const idsBefore = view.result.current.nextPocketIds;
    const geometry = view.result.current.room.pockets;
    const event = view.result.current.state.event;
    expect(idsBefore).toContain(expiredTarget);
    expect(view.result.current.routeCue).toContain('Loose pockets last 4 seconds');
    expect(view.result.current.fraySeconds).toBeNull();
    await frame();
    const before = renders;
    for (let count = 0; count < 239; count += 1) await frame();
    expect(view.result.current.nextPocketIds).toBe(idsBefore);
    expect(renders).toBe(before);
    await frame();
    expect(view.result.current.nextPocketIds).toEqual(idsBefore.filter((id) => id !== expiredTarget));
    expect(view.result.current.routeCue).toBeUndefined();
    expect(view.result.current.room.pockets).toBe(geometry);
    expect(view.result.current.state.event).toBe(event);
    expect(view.result.current.state.phase).toBe('held');
    expect(view.result.current.state.pocketId).toBe(parent);
    expect(renders).toBe(before + 1);
    const remainingIds = view.result.current.nextPocketIds;
    for (let count = 0; count < 60; count += 1) await frame();
    expect(view.result.current.nextPocketIds).toBe(remainingIds);
    expect(renders).toBe(before + 1);
    await view.unmount();
  });

  function orbitalFixture() {
    const run = createEndlessRun(71);
    run.room = { ...run.room, pockets: [{ ...run.room.pockets[0], center: { x: 180, y: 300 }, width: 104,
      orbit: { radius: 48, periodTicks: 720, phaseTicks: 0 } }], barriers: [], switches: [] };
    run.state = createLaunchState(run.room);
    jest.spyOn(endless, 'createEndlessRun').mockReturnValue(run);
    return run;
  }

  test('a stationary off-center hoop hold stays under the finger but cannot arm a launch', async () => {
    const run = orbitalFixture();
    const view = await renderHook(() => useLaunchSession(71, true, feedback));
    await frame();
    const anchor = { ...run.state.position };
    await act(() => expect(view.result.current.beginAim({ x: anchor.x + 24, y: anchor.y - 16 })).toBe(true));
    const camera = run.cameraY;
    for (let index = 0; index < 60; index++) await frame();
    expect(run.state.tick).toBe(120);
    expect(run.state.position).toEqual(pocketPosition(run.room.pockets[0], 120));
    expect(view.result.current.motion.travelerX.value).toBeCloseTo(anchor.x, 2);
    expect(view.result.current.motion.travelerY.value).toBeCloseTo(anchor.y, 2);
    expect(run.cameraY).toBe(camera);
    expect(view.result.current.hasAimed).toBe(false);
    await act(() => view.result.current.releaseAim());
    expect(run.state.phase).toBe('held');
    expect(run.state.launches).toBe(0);
    await view.unmount();
  });

  test('continuous hoop dragging preserves the grab offset and releases with the current orbital momentum', async () => {
    const run = orbitalFixture();
    const view = await renderHook(() => useLaunchSession(71, true, feedback));
    await frame();
    const anchor = { ...run.state.position };
    await act(() => expect(view.result.current.beginAim({ x: anchor.x - 22, y: anchor.y + 9 })).toBe(true));
    for (let index = 1; index <= 30; index++) {
      await act(() => view.result.current.updateAim({ x: -index / 2, y: index * 2 }));
      await frame();
      expect(view.result.current.motion.travelerX.value).toBeCloseTo(anchor.x - index / 2, 2);
      expect(view.result.current.motion.travelerY.value).toBeCloseTo(anchor.y + index * 2, 2);
    }
    const pull = { x: view.result.current.motion.pullX.value, y: view.result.current.motion.pullY.value };
    const expectedVelocity = launchVelocity(run.room.pockets[0], run.state.tick, pull);
    await act(() => view.result.current.releaseAim());
    expect(run.state.phase).toBe('flying');
    expect(run.state.position.x).toBeCloseTo(anchor.x - 15, 2);
    expect(run.state.position.y).toBeCloseTo(anchor.y + 60, 2);
    expect(run.state.velocity.x).toBeCloseTo(expectedVelocity.x, 5);
    expect(run.state.velocity.y).toBeCloseTo(expectedVelocity.y, 5);
    await view.unmount();
  });

  test.each([30, 60, 120])('hoop pulls recompute on each fixed tick at %i FPS and freeze in the background', async (fps) => {
    const run = orbitalFixture();
    const view = await renderHook(() => useLaunchSession(71, true, feedback));
    await frame();
    await act(() => {
      expect(view.result.current.beginAim(run.state.position)).toBe(true);
      view.result.current.updateAim({ x: -20, y: 60 });
    });
    for (let index = 0; index < fps; index++) await frame(1000 / fps);
    expect(run.state.tick).toBe(120);
    expect(view.result.current.motion.travelerX.value).toBeCloseTo(208, 2);
    expect(view.result.current.motion.travelerY.value).toBeCloseTo(360, 2);
    const position = { ...run.state.position };
    await changeAppState('background');
    await frame(30_000);
    expect(run.state.position).toEqual(position);
    expect(run.state.tick).toBe(120);
    await changeAppState('active');
    await frame(30_000);
    await act(() => view.result.current.releaseAim());
    expect(run.state.phase).toBe('held');
    await view.unmount();
  });

  test('world milestones publish on one scored Land, freeze while paused and restore without replaying a banner', async () => {
    const prepared = createEndlessRun(0);
    while (prepared.pocketsCaught < 19) {
      const ids = endless.nextEndlessTargets(prepared);
      const target = prepared.room.pockets.find((pocket) => ids.includes(pocket.id) && pocket.route !== 'reward')!;
      const position = pocketPosition(target, prepared.state.tick + 1);
      Object.assign(prepared.state, { phase: 'flying', position: { x: position.x, y: position.y - 2 },
        velocity: { x: 0, y: 480 }, sourcePocketImmune: false });
      endless.stepEndless(prepared);
      for (let tick = 0; tick < 70; tick++) endless.stepEndless(prepared);
    }
    grantFreeTool(prepared, 'teleport');
    grantFreeTool(prepared, 'teleport');
    let renders = 0;
    const view = await renderHook(() => { renders++; return useLaunchSession(0, true, feedback); });
    await act(() => { expect(view.result.current.restoreSnapshot(serializeEndlessRun(prepared))).toBe(true); });
    expect(view.result.current.worldStage).toBe(0);
    const next = view.result.current.getTeleportPockets().find((pocket) => (pocket.ascentRank ?? 0) > prepared.highestPocket)!;
    expect(next).toBeDefined();
    await act(() => { expect(view.result.current.useFreeTool('teleport', next.id)).toBe(true); });
    expect(view.result.current.score.pockets).toBe(20);
    expect(view.result.current.worldStage).toBe(1);
    expect(view.result.current.worldAnnouncement).toBe(true);
    const transition = view.result.current.worldTransitionTick!;
    await frame();
    const before = renders;
    for (let index = 0; index < 20; index++) await frame();
    expect(renders).toBe(before);
    await act(() => view.result.current.suspend());
    const pausedTick = view.result.current.motion.tick.value;
    await changeAppState('background');
    await frame(30_000);
    expect(view.result.current.motion.tick.value).toBe(pausedTick);
    expect(view.result.current.worldTransitionTick).toBe(transition);
    expect(view.result.current.worldAnnouncement).toBe(true);
    await changeAppState('active');
    await act(() => view.result.current.resume());
    await frame(30_000);
    for (let index = 0; index < 170; index++) await frame();
    expect(view.result.current.worldAnnouncement).toBe(false);
    const saved = view.result.current.getSnapshot();
    await act(() => { expect(view.result.current.restoreSnapshot(saved)).toBe(true); });
    expect(view.result.current.worldStage).toBe(1);
    expect(view.result.current.worldTransitionTick).toBeUndefined();
    expect(view.result.current.worldAnnouncement).toBe(false);
    await view.unmount();
    const restarted = await renderHook(() => useLaunchSession(1, true, feedback));
    expect(restarted.result.current.worldStage).toBe(0);
    expect(restarted.result.current.score.pockets).toBe(0);
    await restarted.unmount();
  });


  test.each(['held', 'flying'] as const)('creative effects preserve their exact state while backgrounded %s', async (phase) => {
    const prepared = createEndlessRun(seed);
    grantFreeTool(prepared, 'sail');
    grantFreeTool(prepared, 'needle');
    const view = await renderHook(() => useLaunchSession(seed, true, feedback));
    await act(() => {
      expect(view.result.current.restoreSnapshot(serializeEndlessRun(prepared))).toBe(true);
      expect(view.result.current.useFreeTool({ tool: 'sail' })).toBe(true);
      expect(view.result.current.useFreeTool({ tool: 'needle' })).toBe(true);
    });
    await frame();
    if (phase === 'flying') {
      await act(() => {
        view.result.current.beginAim(start);
        view.result.current.updateAim({ x: -24, y: 72 });
        view.result.current.releaseAim();
      });
      await frame();
    }
    expect(view.result.current.state.phase).toBe(phase);
    const before = view.result.current.getSnapshot();
    const tick = view.result.current.motion.tick.value;
    await changeAppState('background');
    await frame(30_000);
    await changeAppState('active');
    await frame(30_000);
    expect(view.result.current.getSnapshot()).toBe(before);
    expect(view.result.current.state.toolEffects).toMatchObject({ sail: true, needle: {} });
    expect(view.result.current.tools.inventory.sail).toBe(0);
    expect(view.result.current.tools.inventory.needle).toBe(0);
    await frame();
    expect(view.result.current.motion.tick.value).toBe(tick + 2);
    expect(view.result.current.state.toolEffects).toMatchObject({ sail: true, needle: {} });
    await view.unmount();
  });

});
