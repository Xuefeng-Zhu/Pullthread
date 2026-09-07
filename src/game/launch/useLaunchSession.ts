import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';

import type { ToolKind } from '../../commerce/contracts';
import { TOOL_LABELS } from '../../commerce/toolCatalog';
import type { FeedbackService } from '../feedback';
import type { LaunchCanvasMotion } from './LaunchCanvas';
import { activatePreview, advanceEndless, createEndlessRun, eligibleTeleportPockets, launchEndless, nextEndlessChallenge, reviveEndless, teleportEndless, type EndlessRun } from './endless';
import { cloneEndlessRun, deserializeEndlessRun, serializeEndlessRun } from './snapshots';
import { predictEndlessLaunch } from './prediction';
import { clampPull, createLaunchClock, MIN_PULL, pocketPosition, resetLaunchClock } from './simulation';
import { clampEndlessPull } from './launchInput';
import type { LaunchEvent, LaunchPoint, LaunchState } from './types';

function snapshot(state: LaunchState): LaunchState {
  return { ...state, position: { ...state.position }, previousPosition: { ...state.previousPosition },
    velocity: { ...state.velocity }, checkpoint: { ...state.checkpoint }, pickupIds: [...state.pickupIds] };
}

function applyTool(run: EndlessRun, kind: ToolKind, paid: boolean, pocketId?: string): boolean {
  if (kind === 'preview') return activatePreview(run, paid);
  if (kind === 'revive') return reviveEndless(run, paid);
  return pocketId ? teleportEndless(run, pocketId, paid) : false;
}

/** Simulation and tool mutations share one run; overlays freeze it immediately. */
export function useLaunchSession(seed: number, active: boolean, feedback: FeedbackService) {
  const initial = useMemo(() => createEndlessRun(seed), [seed]);
  const runRef = useRef(initial);
  const clockRef = useRef(createLaunchClock());
  const aimRef = useRef<LaunchPoint | null>(null);
  const activeRef = useRef(active && AppState.currentState === 'active');
  const suspendedRef = useRef(false);
  const discardElapsedRef = useRef(false);
  const [state, setState] = useState(() => snapshot(initial.state));
  const [room, setRoom] = useState(initial.room);
  const roomRef = useRef(initial.room);
  const [score, setScore] = useState({ pockets: 0, height: 0 });
  const [nextPocketId, setNextPocketId] = useState(initial.nextPocketId);
  const [challenge, setChallenge] = useState(() => nextEndlessChallenge(initial));
  const [hasAimed, setHasAimed] = useState(false);
  const [message, setMessage] = useState('');
  const [tools, setTools] = useState(() => ({ inventory: { ...initial.inventory }, reviveUsed: initial.reviveUsed, previewActive: initial.previewActive }));
  const [prediction, setPrediction] = useState<ReturnType<typeof predictEndlessLaunch> | null>(null);
  const predictionTick = useRef(-1000);
  const travelerX = useSharedValue(state.position.x);
  const travelerY = useSharedValue(state.position.y);
  const tick = useSharedValue(0);
  const pullX = useSharedValue(0);
  const pullY = useSharedValue(0);
  const cameraY = useSharedValue(0);
  const impactTick = useSharedValue(-1000);
  const impactX = useSharedValue(0);
  const impactY = useSharedValue(0);
  const motion = useMemo<LaunchCanvasMotion & { cameraY: typeof cameraY }>(() => ({
    travelerX, travelerY, tick, pullX, pullY, cameraY, impactTick, impactX, impactY,
  }), [travelerX, travelerY, tick, pullX, pullY, cameraY, impactTick, impactX, impactY]);

  const publish = useCallback(() => {
    const run = runRef.current;
    travelerX.set(run.state.position.x + (aimRef.current?.x ?? 0));
    travelerY.set(run.state.position.y + (aimRef.current?.y ?? 0));
    tick.set(run.state.tick);
    cameraY.set(run.cameraY);
    pullX.set(aimRef.current?.x ?? 0);
    pullY.set(aimRef.current?.y ?? 0);
    // The moving death boundary changes every tick; only topology belongs in React.
    if (roomRef.current.pockets !== run.room.pockets
      || roomRef.current.bumpers !== run.room.bumpers
      || roomRef.current.hazards !== run.room.hazards
      || roomRef.current.pickups !== run.room.pickups) {
      roomRef.current = run.room;
      setRoom(run.room);
      setNextPocketId(run.nextPocketId);
      setChallenge(nextEndlessChallenge(run));
    }
  }, [cameraY, pullX, pullY, tick, travelerX, travelerY]);

  const publishState = useCallback(() => {
    const run = runRef.current;
    setState(snapshot(run.state));
    setScore({ pockets: run.pocketsCaught, height: run.height });
    setTools({ inventory: { ...run.inventory }, reviveUsed: run.reviveUsed, previewActive: run.previewActive });
    setNextPocketId(run.nextPocketId);
    setChallenge(nextEndlessChallenge(run));
    publish();
  }, [publish]);
  const cancelAim = useCallback(() => { aimRef.current = null; setPrediction(null); publish(); }, [publish]);
  const updatePrediction = useCallback((force = false) => {
    const run = runRef.current;
    if (!run.previewActive || !aimRef.current || Math.hypot(aimRef.current.x, aimRef.current.y) < MIN_PULL) {
      setPrediction(null);
      return;
    }
    // At most 15 predictions per second while clocks keep moving. Rendering and
    // prediction both use the exact current tick, pull clamp and scrolling floor.
    if (force || run.state.tick - predictionTick.current >= 8) {
      predictionTick.current = run.state.tick;
      setPrediction(predictEndlessLaunch(run, aimRef.current));
    }
  }, []);
  const onEvent = useCallback((event: LaunchEvent) => {
    const run = runRef.current;
    const current = run.state;
    if (event.type === 'bounce' || event.type === 'catch') {
      const bumper = event.type === 'bounce' ? run.room.bumpers.find((item) => item.id === event.id) : null;
      impactX.set(bumper?.center.x ?? current.position.x);
      impactY.set(bumper?.center.y ?? current.position.y);
      impactTick.set(current.tick);
    }
    const cue = event.type === 'bounce' ? 'buttonClick' : event.type === 'catch' || event.type === 'pickup' || event.type === 'tool' ? 'stitchComplete'
      : event.type === 'fail' ? 'failure' : 'travelerRelease';
    void feedback.play(cue);
    if (event.type === 'catch') setMessage('Nice catch. Keep climbing!');
    if (event.type === 'pickup') setMessage(event.convertedFrom
      ? '+1 Preview. Your extra Revive became a Preview.' : `+1 ${TOOL_LABELS[event.kind]}. Ready in your tool tray.`);
    if (event.type === 'fail') setMessage(event.reason === 'hazard' ? 'Caught on the thorns.' : 'You fell off the fabric.');
    publishState();
  }, [feedback, impactTick, impactX, impactY, publishState]);

  useEffect(() => {
    activeRef.current = active && AppState.currentState === 'active';
    if (!activeRef.current) cancelAim();
    const clock = clockRef.current;
    resetLaunchClock(clock);
    let lastTimestamp: number | null = null;
    let frameId = 0;
    const subscription = AppState.addEventListener('change', (next) => {
      activeRef.current = active && next === 'active';
      lastTimestamp = null;
      resetLaunchClock(clock);
      cancelAim();
    });
    const frame = (timestamp: number) => {
      frameId = requestAnimationFrame(frame);
      if (discardElapsedRef.current) { lastTimestamp = null; discardElapsedRef.current = false; }
      if (!activeRef.current || suspendedRef.current) { lastTimestamp = null; return; }
      const elapsed = lastTimestamp === null ? 0 : Math.min((timestamp - lastTimestamp) / 1000, 0.1);
      lastTimestamp = timestamp;
      advanceEndless(runRef.current, clock, elapsed, onEvent, aimRef.current !== null);
      publish();
      updatePrediction();
    };
    frameId = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(frameId);
      subscription.remove();
      activeRef.current = false;
      cancelAim();
      resetLaunchClock(clock);
    };
  }, [active, cancelAim, onEvent, publish, updatePrediction]);

  const beginAim = useCallback((point: LaunchPoint, hitRadius = 52) => {
    const current = runRef.current.state;
    if (!activeRef.current || suspendedRef.current || current.phase !== 'held' || Math.hypot(point.x - current.position.x, point.y - current.position.y) > hitRadius) return false;
    aimRef.current = { x: 0, y: 0 };
    setMessage('Pull back, then let go.');
    void feedback.play('fabricTouch');
    return true;
  }, [feedback]);
  const updateAim = useCallback((translation: LaunchPoint): LaunchPoint | null => {
    if (!activeRef.current || suspendedRef.current || aimRef.current === null) return null;
    const run = runRef.current;
    const current = run.state;
    const pull = clampPull(translation);
    if (Math.hypot(pull.x, pull.y) >= MIN_PULL) setHasAimed(true);
    aimRef.current = clampEndlessPull(pull, current.position, run.cameraY, run.room.bounds);
    publish();
    updatePrediction();
    // The gesture already runs on JS. Return its authoritative clamp instead of
    // synchronously reading the same values back from the UI runtime.
    return aimRef.current;
  }, [publish, updatePrediction]);
  const releaseAim = useCallback(() => {
    const pull = aimRef.current;
    aimRef.current = null;
    const run = runRef.current;
    if (pull && activeRef.current && !suspendedRef.current && launchEndless(run, pull)) {
      setMessage('');
      if (run.state.event) onEvent(run.state.event);
    }
    setPrediction(null);
    publish();
  }, [onEvent, publish]);

  const suspend = useCallback(() => {
    suspendedRef.current = true;
    discardElapsedRef.current = true;
    cancelAim();
    resetLaunchClock(clockRef.current);
  }, [cancelAim]);
  const resume = useCallback(() => {
    suspendedRef.current = false;
    discardElapsedRef.current = true;
    resetLaunchClock(clockRef.current);
  }, []);
  const getSnapshot = useCallback(() => serializeEndlessRun(runRef.current), []);
  const restoreSnapshot = useCallback((serialized: string) => {
    const restored = deserializeEndlessRun(serialized);
    if (!restored) return false;
    runRef.current = restored;
    discardElapsedRef.current = true;
    cancelAim();
    resetLaunchClock(clockRef.current);
    predictionTick.current = -1000;
    impactTick.set(-1000);
    setHasAimed(restored.state.launches > 0);
    setMessage('Your tool is ready. Keep climbing!');
    publishState();
    return true;
  }, [cancelAim, impactTick, publishState]);
  const preparePaidTool = useCallback((kind: ToolKind, pocketId?: string) => {
    const copy = cloneEndlessRun(runRef.current);
    if (!applyTool(copy, kind, true, pocketId)) throw new Error('This tool cannot be used here.');
    return serializeEndlessRun(copy);
  }, []);
  const useFreeTool = useCallback((kind: ToolKind, pocketId?: string) => {
    cancelAim();
    if (!applyTool(runRef.current, kind, false, pocketId)) return false;
    discardElapsedRef.current = true;
    resetLaunchClock(clockRef.current);
    predictionTick.current = -1000;
    setMessage(kind === 'preview' ? 'Preview ready. Pull to see your next flight.'
      : kind === 'revive' ? 'Back at your last pocket. Make this one count!' : 'Soft landing. Keep climbing!');
    void feedback.play('stitchComplete');
    publishState();
    return true;
  }, [cancelAim, feedback, publishState]);
  const getTeleportPockets = useCallback(() => eligibleTeleportPockets(runRef.current), []);
  const getCameraY = useCallback(() => runRef.current.cameraY, []);
  const getTeleportTargets = useCallback(() => {
    const run = runRef.current;
    return {
      cameraY: run.cameraY,
      pockets: eligibleTeleportPockets(run).map((pocket) => ({
        id: pocket.id, ...pocketPosition(pocket, run.state.tick), width: pocket.width,
      })),
    };
  }, []);

  return { state, room, motion, score, tools, prediction, nextPocketId, challenge, hasAimed, message,
    beginAim, updateAim, releaseAim, cancelAim, suspend, resume, getSnapshot, restoreSnapshot, preparePaidTool, useFreeTool,
    getTeleportPockets, getCameraY, getTeleportTargets };
}
