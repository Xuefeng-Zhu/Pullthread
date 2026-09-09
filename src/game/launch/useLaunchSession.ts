import type { RankedJournal } from '../../leaderboard/journal';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';

import type { ToolKind } from '../../commerce/contracts';
import type { ToolUse } from '../../commerce/toolUse';
import { TOOL_LABELS } from '../../commerce/toolCatalog';
import type { FeedbackService } from '../feedback';
import type { LaunchCanvasMotion } from './LaunchCanvas';
import { advanceEndless, createEndlessRun, eligibleTeleportPockets, launchEndless, nextEndlessChallenge, nextEndlessTargets, type EndlessRun } from './endless';
import { cloneEndlessRun, deserializeEndlessRun, serializeEndlessRun } from './snapshots';
import { predictEndlessLaunch } from './prediction';
import { clampPull, createLaunchClock, LAUNCH_HZ, MIN_PULL, pocketPosition, resetLaunchClock } from './simulation';
import { WORLD_ANNOUNCEMENT_TICKS, worldStageForScore } from './progression';
import { clampEndlessPull } from './launchInput';
import { applyEndlessTool, validateToolUse, eligiblePinTargets, eligibleVelcroTargets, getToolPlacement, effectivePockets } from './tools';
import type { LaunchEvent, LaunchPoint, LaunchState } from './types';

interface WorldPresentation { worldStage: number; worldTransitionTick?: number; worldAnnouncement: boolean }

function snapshot(state: LaunchState): LaunchState {
  return { ...state, position: { ...state.position }, previousPosition: { ...state.previousPosition },
    velocity: { ...state.velocity }, checkpoint: { ...state.checkpoint }, pickupIds: [...state.pickupIds],
    ...(state.brokenBarrierIds ? { brokenBarrierIds: [...state.brokenBarrierIds] } : {}),
    ...(state.activatedSwitchIds ? { activatedSwitchIds: [...state.activatedSwitchIds] } : {}),
    ...(state.pocketExpiryTicks ? { pocketExpiryTicks: { ...state.pocketExpiryTicks } } : {}),
    ...(state.toolEffects ? { toolEffects: JSON.parse(JSON.stringify(state.toolEffects)) as LaunchState['toolEffects'] } : {}),
    ...(state.stitchedPocket ? { stitchedPocket: { ...state.stitchedPocket, pocket: { ...state.stitchedPocket.pocket, center: { ...state.stitchedPocket.pocket.center } } } } : {}),
    ...(state.toolPhaseOffsets ? { toolPhaseOffsets: { ...state.toolPhaseOffsets } } : {}) };
}

function remainingFraySeconds(run: EndlessRun): number | null {
  const expiry = run.state.pocketExpiryTicks?.[run.state.pocketId];
  return run.state.phase === 'held' && expiry !== undefined
    ? Math.max(0, Math.ceil((expiry - run.state.tick) / LAUNCH_HZ)) : null;
}

function nextTargetExpiry(run: EndlessRun, ids: readonly string[]): number {
  return ids.reduce((expiry, id) => Math.min(expiry, run.state.pocketExpiryTicks?.[id] ?? Infinity), Infinity);
}

function toolUse(value: ToolUse | ToolKind, pocketId?: string): ToolUse {
  return typeof value === 'string' ? (value === 'teleport' ? { tool: value, pocketId: pocketId ?? '' } : { tool: value }) as ToolUse : value;
}

/** Simulation and tool mutations share one run; overlays freeze it immediately. */
export function useLaunchSession(seed: number, active: boolean, feedback: FeedbackService, ranked?: RankedJournal | null) {
  const initial = useMemo(() => (ranked?.snapshot ? deserializeEndlessRun(ranked.snapshot) : null) ?? createEndlessRun(seed), [seed, ranked]);
  const runRef = useRef(initial);
  const clockRef = useRef(createLaunchClock());
  const aimRef = useRef<LaunchPoint | null>(null);
  const gestureRef = useRef<{ anchor: LaunchPoint; translation: LaunchPoint; armed: boolean } | null>(null);
  const activeRef = useRef(active && AppState.currentState === 'active');
  const suspendedRef = useRef(false);
  const discardElapsedRef = useRef(false);
  const lastBounceFeedbackTickRef = useRef(-1000);
  const [state, setState] = useState(() => snapshot(initial.state));
  const [room, setRoom] = useState(initial.room);
  const roomRef = useRef(initial.room);
  const [score, setScore] = useState({ pockets: initial.pocketsCaught, height: initial.height });
  const [world, setWorld] = useState<WorldPresentation>({ worldStage: 0, worldAnnouncement: false });
  const worldRef = useRef(world);
  const [nextPocketId, setNextPocketId] = useState(initial.nextPocketId);
  const [nextPocketIds, setNextPocketIds] = useState(() => nextEndlessTargets(initial));
  const targetIdsRef = useRef(nextPocketIds);
  const targetExpiryRef = useRef(nextTargetExpiry(initial, nextPocketIds));
  const [fraySeconds, setFraySeconds] = useState<number | null>(() => remainingFraySeconds(initial));
  const fraySecondsRef = useRef(fraySeconds);
  const [challenge, setChallenge] = useState(() => nextEndlessChallenge(initial));
  const [hasAimed, setHasAimed] = useState(false);
  const [message, setMessage] = useState('');
  const [tools, setTools] = useState(() => ({ inventory: { ...initial.inventory }, reviveUsed: initial.reviveUsed, previewActive: initial.previewActive, creativeEnabled: (initial.generationVersion ?? 1) >= 5, freeToolQueue: initial.freeToolQueue ? [...initial.freeToolQueue] : undefined }));
  const [prediction, setPrediction] = useState<ReturnType<typeof predictEndlessLaunch> | null>(null);
  const predictionTick = useRef(-1000);
  const travelerX = useSharedValue(state.position.x);
  const travelerY = useSharedValue(state.position.y);
  const tick = useSharedValue(0);
  const velocityY = useSharedValue(state.velocity.y);
  const pullX = useSharedValue(0);
  const pullY = useSharedValue(0);
  const cameraY = useSharedValue(0);
  const impactTick = useSharedValue(-1000);
  const impactX = useSharedValue(0);
  const impactY = useSharedValue(0);
  const motion = useMemo<LaunchCanvasMotion & { cameraY: typeof cameraY }>(() => ({
    travelerX, travelerY, velocityY, tick, pullX, pullY, cameraY, impactTick, impactX, impactY,
  }), [travelerX, travelerY, velocityY, tick, pullX, pullY, cameraY, impactTick, impactX, impactY]);

  const publishTargets = useCallback(() => {
    const run = runRef.current;
    const ids = nextEndlessTargets(run);
    if (ids.length !== targetIdsRef.current.length || ids.some((id, index) => id !== targetIdsRef.current[index])) {
      targetIdsRef.current = ids;
      setNextPocketIds(ids);
    }
    targetExpiryRef.current = nextTargetExpiry(run, ids);
  }, []);

  const recomputeAim = useCallback(() => {
    const gesture = gestureRef.current;
    const run = runRef.current;
    if (!gesture || aimRef.current === null || run.state.phase !== 'held') return;
    const pocket = effectivePockets(run.room, run.state).find((candidate) => candidate.id === run.state.pocketId);
    const anchor = pocket ? pocketPosition(pocket, run.state.tick, run.state) : run.state.position;
    // Finger translation preserves the initial off-center grab. The intended
    // handle stays under that finger while an orbital anchor continues moving.
    const intendedPull = pocket?.orbit ? {
      x: gesture.anchor.x + gesture.translation.x - anchor.x,
      y: gesture.anchor.y + gesture.translation.y - anchor.y,
    } : gesture.translation;
    aimRef.current = clampEndlessPull(intendedPull, anchor, run.cameraY, run.room.bounds);
  }, []);

  const publish = useCallback(() => {
    const run = runRef.current;
    travelerX.set(run.state.position.x + (aimRef.current?.x ?? 0));
    travelerY.set(run.state.position.y + (aimRef.current?.y ?? 0));
    tick.set(run.state.tick);
    velocityY.set(run.state.velocity.y);
    cameraY.set(run.cameraY);
    pullX.set(aimRef.current?.x ?? 0);
    pullY.set(aimRef.current?.y ?? 0);
    const stage = (run.generationVersion ?? 1) >= 3 ? worldStageForScore(run.pocketsCaught) : 0;
    const previousWorld = worldRef.current;
    if (stage !== previousWorld.worldStage) {
      const nextWorld = { worldStage: stage, worldTransitionTick: run.state.tick, worldAnnouncement: true };
      worldRef.current = nextWorld;
      setWorld(nextWorld);
    } else if (previousWorld.worldAnnouncement
      && run.state.tick >= (previousWorld.worldTransitionTick ?? 0) + WORLD_ANNOUNCEMENT_TICKS) {
      const nextWorld = { worldStage: stage, worldAnnouncement: false };
      worldRef.current = nextWorld;
      setWorld(nextWorld);
    }
    // Only accessible text needs React. The ring and number animate on the
    // simulation's shared tick, including during a pull and after pause/resume.
    const seconds = remainingFraySeconds(run);
    if (seconds !== fraySecondsRef.current) {
      fraySecondsRef.current = seconds;
      setFraySeconds(seconds);
    }
    // A previously visited destination can expire while its parent is held.
    // That changes route hints without an event or a geometry replacement.
    if (run.state.tick >= targetExpiryRef.current) publishTargets();
    // The moving death boundary changes every tick; only topology belongs in React.
    if (roomRef.current.pockets !== run.room.pockets
      || roomRef.current.bumpers !== run.room.bumpers
      || roomRef.current.hazards !== run.room.hazards
      || roomRef.current.pickups !== run.room.pickups
      || roomRef.current.windZones !== run.room.windZones
      || roomRef.current.barriers !== run.room.barriers
      || roomRef.current.switches !== run.room.switches) {
      roomRef.current = run.room;
      setRoom(run.room);
      setNextPocketId(run.nextPocketId);
      publishTargets();
      setChallenge(nextEndlessChallenge(run));
    }
  }, [cameraY, publishTargets, pullX, pullY, tick, travelerX, travelerY, velocityY]);

  const publishState = useCallback(() => {
    const run = runRef.current;
    setState(snapshot(run.state));
    setScore({ pockets: run.pocketsCaught, height: run.height });
    setTools({ inventory: { ...run.inventory }, reviveUsed: run.reviveUsed, previewActive: run.previewActive, creativeEnabled: (run.generationVersion ?? 1) >= 5, freeToolQueue: run.freeToolQueue ? [...run.freeToolQueue] : undefined });
    setNextPocketId(run.nextPocketId);
    publishTargets();
    setChallenge(nextEndlessChallenge(run));
    publish();
  }, [publish, publishTargets]);
  const cancelAim = useCallback(() => { if (aimRef.current) ranked?.action({ type: 'cancel' }); aimRef.current = null; gestureRef.current = null; setPrediction(null); publish(); }, [publish, ranked]);
  const updatePrediction = useCallback((force = false) => {
    const run = runRef.current;
    // Cancellation/release clear the preview immediately. Idle frames need no
    // state setter, including the frame after a target deadline changes hints.
    if (!run.previewActive || !aimRef.current) return;
    if (!gestureRef.current?.armed || run.state.phase !== 'held' || Math.hypot(aimRef.current.x, aimRef.current.y) < MIN_PULL) {
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
    if (current.phase !== 'held' && (aimRef.current !== null || gestureRef.current !== null)) {
      aimRef.current = null;
      gestureRef.current = null;
      setPrediction(null);
    }
    const repeatedBounce = event.type === 'bounce'
      && current.tick - lastBounceFeedbackTickRef.current < Math.ceil(LAUNCH_HZ / 10);
    if (event.type === 'bounce' && !repeatedBounce) lastBounceFeedbackTickRef.current = current.tick;
    if ((!repeatedBounce && event.type === 'bounce') || event.type === 'catch' || event.type === 'break' || event.type === 'switch') {
      const bumper = event.type === 'bounce' ? run.room.bumpers.find((item) => item.id === event.id) : null;
      impactX.set(bumper?.center.x ?? current.position.x);
      impactY.set(bumper?.center.y ?? current.position.y);
      impactTick.set(current.tick);
    }
    const cue = event.type === 'break' ? 'threadDraw' : event.type === 'bounce' || event.type === 'switch' ? 'buttonClick' : event.type === 'catch' || event.type === 'pickup' || event.type === 'tool' ? 'stitchComplete'
      : event.type === 'fail' ? 'failure' : 'travelerRelease';
    if (!repeatedBounce) void feedback.play(cue);
    if (event.type === 'catch') setMessage(previous => previous.startsWith('+1') ? previous
      : current.pocketExpiryTicks?.[current.pocketId] !== undefined
        ? 'Loose stitches! Launch before the four-second timer runs out.' : 'Nice catch. Keep climbing!');
    if (event.type === 'pickup') {
      const pickup = event.convertedFrom ? '+1 Preview. Your extra Revive became a Preview.' : `+1 ${TOOL_LABELS[event.kind]}.`;
      setMessage(event.replacedKind ? `${pickup} Replaced your oldest free tool: ${TOOL_LABELS[event.replacedKind]}.`
        : event.convertedFrom ? pickup : `${pickup} Ready in your tool tray.`);
    }
    if (event.type === 'fray') setMessage('That pocket unraveled. Find a landing!');
    if (event.type === 'break') setMessage('The cloth is torn. That passage stays open.');
    if (event.type === 'switch') setMessage('Door open. Follow the matching stitches.');
    if (event.type === 'fail') setMessage(event.reason === 'hazard' ? 'Caught on a sharp obstacle.'
      : current.frayedFall ? 'The pocket unraveled before you launched.'
        : event.reason === 'timeout' ? 'That flight ran out of time.' : 'You fell off the fabric.');
    // Position and impact animation use shared values on the enclosing frame.
    // Avoid a React render for every physical bounce, especially at corners.
    if (event.type !== 'bounce' || event.id === 'tool-bounce') publishState();
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
      advanceEndless(runRef.current, clock, elapsed, onEvent, () => aimRef.current !== null, () => { ranked?.tick(); if (runRef.current.state.phase !== 'held') ranked?.cancelActiveAim(); recomputeAim(); });
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
  }, [active, cancelAim, onEvent, publish, ranked, recomputeAim, updatePrediction]);

  const beginAim = useCallback((point: LaunchPoint, hitRadius = 52) => {
    const current = runRef.current.state;
    if (!activeRef.current || suspendedRef.current || current.phase !== 'held' || Math.hypot(point.x - current.position.x, point.y - current.position.y) > hitRadius) return false;
    ranked?.action({ type: 'aim' });
    aimRef.current = { x: 0, y: 0 };
    gestureRef.current = { anchor: { ...current.position }, translation: { x: 0, y: 0 }, armed: false };
    setMessage('Pull back, then let go.');
    void feedback.play('fabricTouch');
    return true;
  }, [feedback, ranked]);
  const updateAim = useCallback((translation: LaunchPoint): LaunchPoint | null => {
    if (!activeRef.current || suspendedRef.current || aimRef.current === null) return null;
    const run = runRef.current;
    const current = run.state;
    if (current.phase !== 'held') { cancelAim(); return null; }
    const pull = clampPull(translation);
    if (Math.hypot(pull.x, pull.y) >= MIN_PULL) setHasAimed(true);
    const gesture = gestureRef.current;
    if (!gesture) return null;
    gesture.translation = Number.isFinite(translation.x) && Number.isFinite(translation.y)
      ? { ...translation } : { x: 0, y: 0 };
    if (Math.hypot(pull.x, pull.y) >= MIN_PULL) gesture.armed = true;
    recomputeAim();
    publish();
    updatePrediction();
    // The gesture already runs on JS. Return its authoritative clamp instead of
    // synchronously reading the same values back from the UI runtime.
    return aimRef.current;
  }, [cancelAim, publish, recomputeAim, updatePrediction]);
  const releaseAim = useCallback(() => {
    recomputeAim();
    const pull = aimRef.current;
    const armed = gestureRef.current?.armed;
    aimRef.current = null;
    gestureRef.current = null;
    const run = runRef.current;
    if (pull && armed && activeRef.current && !suspendedRef.current && launchEndless(run, pull)) {
      ranked?.action({ type: 'launch', x: pull.x, y: pull.y });
      setMessage('');
      if (run.state.event) onEvent(run.state.event);
    }
    if (pull && run.state.phase === 'held') ranked?.action({ type: 'cancel' });
    setPrediction(null);
    publish();
  }, [onEvent, publish, ranked, recomputeAim]);

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
  const restoreSnapshot = useCallback((serialized: string, announceWorld = false) => {
    const restored = deserializeEndlessRun(serialized);
    if (!restored) return false;
    if (!announceWorld) {
      const restoredWorld = { worldStage: (restored.generationVersion ?? 1) >= 3 ? worldStageForScore(restored.pocketsCaught) : 0,
        worldAnnouncement: false };
      worldRef.current = restoredWorld;
      setWorld(restoredWorld);
    }
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
  const preparePaidTool = useCallback((value: ToolUse | ToolKind, pocketId?: string) => {
    const copy = cloneEndlessRun(runRef.current);
    if (!applyEndlessTool(copy, toolUse(value, pocketId), true)) throw new Error('This tool cannot be used here.');
    return serializeEndlessRun(copy);
  }, []);
  const useFreeTool = useCallback((value: ToolUse | ToolKind, pocketId?: string) => {
    const use = toolUse(value, pocketId);
    const kind = use.tool;
    cancelAim();
    if (!applyEndlessTool(runRef.current, use, false)) return false;
    ranked?.action({ type: 'tool', ...use });
    if (kind === 'revive') {
      const restoredWorld = { worldStage: (runRef.current.generationVersion ?? 1) >= 3 ? worldStageForScore(runRef.current.pocketsCaught) : 0, worldAnnouncement: false };
      worldRef.current = restoredWorld;
      setWorld(restoredWorld);
    }
    discardElapsedRef.current = true;
    resetLaunchClock(clockRef.current);
    predictionTick.current = -1000;
    setMessage(kind === 'preview' ? 'Preview ready. Pull to see your next flight.'
      : kind === 'revive' ? 'Back at your last pocket. Make this one count!' : kind === 'teleport' ? 'Soft landing. Keep climbing!' : `${TOOL_LABELS[kind]} ready for your next flight.`);
    void feedback.play('stitchComplete');
    publishState();
    return true;
  }, [cancelAim, feedback, publishState, ranked]);
  const getTeleportPockets = useCallback(() => eligibleTeleportPockets(runRef.current), []);
  const getCameraY = useCallback(() => runRef.current.cameraY, []);
  const getTeleportTargets = useCallback(() => {
    const run = runRef.current;
    return {
      cameraY: run.cameraY,
      pockets: eligibleTeleportPockets(run).map((pocket) => ({
        id: pocket.id, ...pocketPosition(pocket, run.state.tick, run.state), width: pocket.width,
      })),
    };
  }, []);

  const validateUse = useCallback((use: ToolUse) => validateToolUse(runRef.current, use), []);
  const placementForTool = useCallback((kind: 'bounce' | 'stitch', position: LaunchPoint, angle = 0) =>
    getToolPlacement(runRef.current, kind, position, angle), []);
  const getToolSetup = useCallback((kind: ToolKind) => {
    const run = runRef.current;
    const targets = kind === 'pin' ? eligiblePinTargets(run).map((target) => ({
      id: target.id, ...target.position, width: 48, label: target.label,
    })) : kind === 'velcro' ? eligibleVelcroTargets(run).map((pocket, index) => ({
      id: pocket.id, ...pocketPosition(pocket, run.state.tick, run.state), width: pocket.width,
      label: `Pocket ${index + 1}`,
    })) : [];
    const placements: LaunchPoint[] = [];
    if (kind === 'bounce' || kind === 'stitch') {
      for (let y = Math.ceil(run.cameraY / 20) * 20; y <= run.cameraY + 560; y += 20) {
        for (let x = 40; x <= 320; x += 20) {
          const use = getToolPlacement(run, kind, { x, y });
          if (use && 'position' in use) placements.push(use.position);
        }
      }
    }
    return { cameraY: run.cameraY, targets, placements,
      position: placements.reduce((best, point) => Math.hypot(point.x - run.state.position.x, point.y - run.state.position.y + 180)
        < Math.hypot(best.x - run.state.position.x, best.y - run.state.position.y + 180) ? point : best,
      placements[0] ?? { x: 180, y: run.state.position.y - 180 }) };
  }, []);

  const availablePockets = effectivePockets(room, state).filter((pocket) => nextPocketIds.includes(pocket.id));
  const loosePocketAhead = availablePockets.some((pocket) => pocket.frayTicks);
  // Section-owned pickup IDs share their pocket's section prefix, including restored runs.
  const rewardToolAhead = availablePockets.some((pocket) => pocket.route === 'reward'
    && pocket.sectionId !== undefined
    && room.pickups?.some((pickup) => pickup.id.startsWith(`${pocket.sectionId}-`)));
  const routeCue = room.barriers !== undefined && availablePockets.length > 1
    ? 'Choose a roomier route, or aim through the tighter shortcut.' : loosePocketAhead
    ? availablePockets.length > 1 ? rewardToolAhead
      ? 'Wide pocket, or loose stitches for a tool. Loose pockets last 4 seconds.'
      : 'Wide pocket, or loose stitches. Loose pockets last 4 seconds.'
      : 'Loose stitches ahead. Land, then launch within four seconds.'
    : availablePockets.length > 1 ? rewardToolAhead
      ? 'Choose the wide pocket, or follow the star for a free tool.'
      : 'Choose the wide pocket, or try the narrower star pocket.' : undefined;

  return { state, room, motion, score, ...world, tools, prediction, nextPocketId, nextPocketIds, challenge, routeCue, fraySeconds, hasAimed, message,
    beginAim, updateAim, releaseAim, cancelAim, suspend, resume, getSnapshot, restoreSnapshot, preparePaidTool, useFreeTool,
    getTeleportPockets, getCameraY, getTeleportTargets, getToolSetup, placementForTool, validateUse };
}
