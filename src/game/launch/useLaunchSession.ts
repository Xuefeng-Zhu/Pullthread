import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';

import type { FeedbackService } from '../feedback';
import type { LaunchCanvasMotion } from './LaunchCanvas';
import { advanceEndless, createEndlessRun, launchEndless, nextEndlessChallenge } from './endless';
import { clampPull, createLaunchClock, MIN_PULL, resetLaunchClock } from './simulation';
import { clampEndlessPull } from './launchInput';
import type { LaunchEvent, LaunchPoint, LaunchState } from './types';

function snapshot(state: LaunchState): LaunchState {
  return { ...state, position: { ...state.position }, previousPosition: { ...state.previousPosition },
    velocity: { ...state.velocity }, checkpoint: { ...state.checkpoint } };
}

/** One uninterrupted run; only a newly mounted session can recover from death. */
export function useLaunchSession(seed: number, active: boolean, feedback: FeedbackService) {
  const initial = useMemo(() => createEndlessRun(seed), [seed]);
  const runRef = useRef(initial);
  const clockRef = useRef(createLaunchClock());
  const aimRef = useRef<LaunchPoint | null>(null);
  const activeRef = useRef(active && AppState.currentState === 'active');
  const [state, setState] = useState(() => snapshot(initial.state));
  const [room, setRoom] = useState(initial.room);
  const roomRef = useRef(initial.room);
  const [score, setScore] = useState({ pockets: 0, height: 0 });
  const [nextPocketId, setNextPocketId] = useState(initial.nextPocketId);
  const [challenge, setChallenge] = useState(() => nextEndlessChallenge(initial));
  const [hasAimed, setHasAimed] = useState(false);
  const [message, setMessage] = useState('');
  const travelerX = useSharedValue(state.position.x);
  const travelerY = useSharedValue(state.position.y);
  const tick = useSharedValue(0);
  const pullX = useSharedValue(0);
  const pullY = useSharedValue(0);
  const cameraY = useSharedValue(0);
  const impactTick = useSharedValue(-1000);
  const impactX = useSharedValue(0);
  const impactY = useSharedValue(0);
  const motion: LaunchCanvasMotion & { cameraY: typeof cameraY } = {
    travelerX, travelerY, tick, pullX, pullY, cameraY, impactTick, impactX, impactY,
  };

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
      || roomRef.current.hazards !== run.room.hazards) {
      roomRef.current = run.room;
      setRoom(run.room);
      setNextPocketId(run.nextPocketId);
      setChallenge(nextEndlessChallenge(run));
    }
  }, [cameraY, pullX, pullY, tick, travelerX, travelerY]);

  const cancelAim = useCallback(() => { aimRef.current = null; publish(); }, [publish]);
  const onEvent = useCallback((event: LaunchEvent) => {
    const run = runRef.current;
    const current = run.state;
    if (event.type === 'bounce' || event.type === 'catch') {
      const bumper = event.type === 'bounce' ? run.room.bumpers.find((item) => item.id === event.id) : null;
      impactX.set(bumper?.center.x ?? current.position.x);
      impactY.set(bumper?.center.y ?? current.position.y);
      impactTick.set(current.tick);
    }
    const cue = event.type === 'bounce' ? 'buttonClick' : event.type === 'catch' ? 'stitchComplete'
      : event.type === 'fail' ? 'failure' : 'travelerRelease';
    void feedback.play(cue);
    if (event.type === 'catch') setMessage('Nice catch. Keep climbing!');
    if (event.type === 'fail') setMessage(event.reason === 'hazard' ? 'Caught on the thorns.' : 'You fell off the fabric.');
    setState(snapshot(current));
    setScore({ pockets: run.pocketsCaught, height: run.height });
    setNextPocketId(run.nextPocketId);
  }, [feedback, impactTick, impactX, impactY]);

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
      if (!activeRef.current) { lastTimestamp = null; return; }
      const elapsed = lastTimestamp === null ? 0 : Math.min((timestamp - lastTimestamp) / 1000, 0.1);
      lastTimestamp = timestamp;
      advanceEndless(runRef.current, clock, elapsed, onEvent, aimRef.current !== null);
      publish();
    };
    frameId = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(frameId);
      subscription.remove();
      activeRef.current = false;
      cancelAim();
      resetLaunchClock(clock);
    };
  }, [active, cancelAim, onEvent, publish]);

  const beginAim = useCallback((point: LaunchPoint, hitRadius = 52) => {
    const current = runRef.current.state;
    if (!activeRef.current || current.phase !== 'held' || Math.hypot(point.x - current.position.x, point.y - current.position.y) > hitRadius) return false;
    aimRef.current = { x: 0, y: 0 };
    setMessage('Pull back, then let go.');
    void feedback.play('fabricTouch');
    return true;
  }, [feedback]);
  const updateAim = useCallback((translation: LaunchPoint) => {
    if (!activeRef.current || aimRef.current === null) return;
    const run = runRef.current;
    const current = run.state;
    const pull = clampPull(translation);
    if (Math.hypot(pull.x, pull.y) >= MIN_PULL) setHasAimed(true);
    aimRef.current = clampEndlessPull(pull, current.position, run.cameraY, run.room.bounds);
    publish();
  }, [publish]);
  const releaseAim = useCallback(() => {
    const pull = aimRef.current;
    aimRef.current = null;
    const run = runRef.current;
    if (pull && activeRef.current && launchEndless(run, pull)) {
      setMessage('');
      if (run.state.event) onEvent(run.state.event);
    }
    publish();
  }, [onEvent, publish]);

  return { state, room, motion, score, nextPocketId, challenge, hasAimed, message, beginAim, updateAim, releaseAim, cancelAim };
}
