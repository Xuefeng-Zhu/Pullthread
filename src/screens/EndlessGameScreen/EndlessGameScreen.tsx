import Ionicons from '@expo/vector-icons/Ionicons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useIsFocused } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { RootStackParamList } from '../../app/navigation/RootNavigator';
import { useEffectiveReducedMotion } from '../../accessibility/useEffectiveReducedMotion';
import { ExpoFeedbackService } from '../../game/feedback';
import { LaunchCanvas } from '../../game/launch/LaunchCanvas';
import type { LaunchPoint } from '../../game/launch/types';
import { useLaunchSession } from '../../game/launch/useLaunchSession';
import { getLaunchViewport } from '../../game/launch/viewport';
import { useEndlessProgressStore } from '../../store/useEndlessProgressStore';
import { usePreferencesStore } from '../../store/usePreferencesStore';
import { useChallengeCue } from './useChallengeCue';
import { TOOL_COSTS, type ToolKind } from '../../commerce/contracts';
import { PaidToolJournal } from '../../commerce/paidToolJournal';
import { TOOL_DESCRIPTIONS, TOOL_LABELS } from '../../commerce/toolCatalog';
import { ToolIcon } from '../../components/ToolIcon';
import { deserializeEndlessRun } from '../../game/launch/snapshots';
import { getCommerceService } from '../../services/commerce';
import { isInsufficientPointsError } from '../../services/commerce/errors';
import { useCommerceStore } from '../../store/useCommerceStore';
import { ToolTray } from './ToolTray';
import { PointsShop } from './PointsShop';

type Props = NativeStackScreenProps<RootStackParamList, 'EndlessGame'>;

function Action({ label, onPress, testID, primary = false, disabled = false }: {
  label: string; onPress: () => void; testID: string; primary?: boolean; disabled?: boolean;
}) {
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label}
    disabled={disabled} accessibilityState={{ disabled }}
    onPress={onPress} style={({ pressed }) => [styles.action, primary && styles.primary, disabled && styles.disabled, pressed && styles.pressed]}>
    <Text style={[styles.actionText, primary && styles.primaryText]}>{label}</Text>
  </Pressable>;
}

function IconAction({ label, icon, onPress, testID, disabled = false }: {
  label: string; icon: 'pause' | 'settings-outline'; onPress: () => void; testID: string; disabled?: boolean;
}) {
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label}
    disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.iconAction, disabled && styles.disabled, pressed && styles.pressed]}>
    <Ionicons name={icon} size={23} color="#244b45" />
  </Pressable>;
}

type ToolLayer = { type: 'shop' } | { type: 'tool'; kind: ToolKind; pocketId?: string }
  | { type: 'land'; cameraY: number; pockets: readonly { id: string; x: number; y: number; width: number }[] }
  | { type: 'recovery' } | null;

function EndlessFlight({ seed, best, onRestart, onScore, onSettings }: {
  seed: number; best: number; onRestart: () => void; onScore: (score: number) => void; onSettings: () => void;
}) {
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { fontScale = 1 } = useWindowDimensions();
  const [paused, setPaused] = useState(false);
  const [toolLayer, setToolLayer] = useState<ToolLayer>(null);
  const [toolBusy, setToolBusy] = useState(true);
  const [toolError, setToolError] = useState('');
  const [toolNotice, setToolNotice] = useState('');
  const [trayHeight, setTrayHeight] = useState(46);
  const [runId] = useState(() => `run-${seed}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
  const operationCounter = useRef(0);
  const toolLock = useRef(false);
  const returnToRecovery = useRef(false);
  const commerce = useCommerceStore();
  const journal = useMemo(() => new PaidToolJournal(AsyncStorage, getCommerceService(),
    (value) => deserializeEndlessRun(value) !== null), []);
  const [area, setArea] = useState({ width: 1, height: 1 });
  const [hudHeight, setHudHeight] = useState(68);
  const reducedMotion = useEffectiveReducedMotion();
  const highContrast = usePreferencesStore((s) => s.highContrastEnabled);
  const hints = usePreferencesStore((s) => s.tutorialHintsEnabled);
  const sound = usePreferencesStore((s) => s.soundEnabled);
  const haptics = usePreferencesStore((s) => s.hapticsEnabled);
  const feedback = useMemo(() => new ExpoFeedbackService(), []);
  useEffect(() => { feedback.setPreferences({ soundEnabled: sound, hapticsEnabled: haptics }); }, [feedback, sound, haptics]);
  useEffect(() => () => feedback.dispose(), [feedback]);
  const session = useLaunchSession(seed, focused && !paused && !toolLayer && !toolBusy, feedback);
  const { state, room, motion, score, beginAim, updateAim, releaseAim, cancelAim } = session;
  const { cue: challengeCue, beginCuePull, updateCuePull, cancelCuePull } = useChallengeCue(session.challenge, state.pocketId, hints);
  const { scale, offsetX, offsetY } = getLaunchViewport(area, room.bounds, insets.bottom);
  const { suspend, resume, getSnapshot, restoreSnapshot, preparePaidTool, useFreeTool: consumeFreeTool,
    getCameraY, getTeleportTargets } = session;
  const failedTool = useCallback((error: unknown) => {
    suspend();
    setToolError(error instanceof Error ? error.message : 'Your tool could not be checked. Try again.');
    setToolLayer({ type: 'recovery' });
  }, [suspend]);

  useEffect(() => {
    let mounted = true;
    void useCommerceStore.getState().initialize();
    void journal.recover().then((recovered) => {
      if (!mounted) return;
      if (recovered.snapshot) restoreSnapshot(recovered.snapshot);
      if (recovered.result) useCommerceStore.getState().acceptWallet(recovered.result.wallet);
      if (recovered.snapshot) setToolNotice('Your saved run is ready to continue.');
      if (recovered.refunded) setToolNotice('Your unused tool was refunded to points.');
      if (recovered.cancelled) setToolNotice('Not enough points for that tool. No points were spent.');
    }).catch((error: unknown) => { if (mounted) failedTool(error); })
      .finally(() => { if (mounted) setToolBusy(false); });
    return () => { mounted = false; };
  }, [failedTool, journal, restoreSnapshot]);

  // Only runs with a paid receipt are persisted. Free runs keep their immediate
  // start/restart behavior; a paid effect always has a recoverable run snapshot.
  useEffect(() => {
    if (!toolBusy) void journal.saveRun(getSnapshot()).catch(failedTool);
  }, [failedTool, getSnapshot, journal, state.event, toolBusy]);
  useEffect(() => {
    const listener = AppState.addEventListener('change', (next) => {
      if (next !== 'active') void journal.saveRun(getSnapshot()).catch(failedTool);
    });
    return () => listener.remove();
  }, [failedTool, getSnapshot, journal]);
  const closeTools = useCallback(() => {
    if (toolBusy || useCommerceStore.getState().busy) return;
    if (returnToRecovery.current) {
      returnToRecovery.current = false;
      setToolLayer({ type: 'recovery' });
      return;
    }
    setToolLayer(null); setToolError(''); resume();
  }, [resume, toolBusy]);
  const openShop = useCallback(() => {
    returnToRecovery.current = toolLayer?.type === 'recovery';
    suspend(); setToolLayer({ type: 'shop' });
    void useCommerceStore.getState().initialize();
  }, [suspend, toolLayer]);
  const restartRun = useCallback(async () => {
    if (toolBusy || toolLock.current) return;
    toolLock.current = true;
    suspend(); setToolBusy(true);
    try { await journal.abandonRun(); onRestart(); }
    catch (error) { failedTool(error); }
    finally { toolLock.current = false; setToolBusy(false); }
  }, [failedTool, journal, onRestart, suspend, toolBusy]);
  const openSettings = useCallback(async () => {
    if (toolBusy) return;
    suspend();
    try { await journal.saveRun(getSnapshot()); onSettings(); resume(); }
    catch (error) { failedTool(error); }
  }, [failedTool, getSnapshot, journal, onSettings, resume, suspend, toolBusy]);
  const chooseTool = useCallback((kind: ToolKind) => {
    if (toolBusy) return;
    suspend(); setToolError(''); setToolNotice('');
    if (kind === 'teleport') {
      setToolLayer({ type: 'land', ...getTeleportTargets() });
      return;
    }
    if (session.tools.inventory[kind] > 0) {
      if (consumeFreeTool(kind)) { setPaused(false); resume(); return; }
    }
    setToolLayer({ type: 'tool', kind });
  }, [resume, session.tools.inventory, suspend, toolBusy, consumeFreeTool, getTeleportTargets]);
  const landAt = useCallback((pocketId: string) => {
    if (toolBusy) return;
    if (session.tools.inventory.teleport > 0 && consumeFreeTool('teleport', pocketId)) {
      setToolLayer(null); resume();
    } else setToolLayer({ type: 'tool', kind: 'teleport', pocketId });
  }, [resume, session.tools.inventory.teleport, toolBusy, consumeFreeTool]);
  const buyTool = useCallback(async (kind: ToolKind, pocketId?: string) => {
    if (toolBusy || toolLock.current) return;
    toolLock.current = true;
    suspend(); setToolBusy(true); setToolError('');
    const operationId = `${runId}-${++operationCounter.current}-${Date.now().toString(36)}`;
    try {
      const before = getSnapshot();
      const after = preparePaidTool(kind, pocketId);
      const request = {
        operationId,
        runId: runId, tool: kind, expectedCost: TOOL_COSTS[kind],
        contextKey: `${state.tick}:${state.pocketId}:${kind}:${pocketId ?? ''}`,
      };
      const result = await journal.redeem(request, before, after);
      if (result.result) useCommerceStore.getState().acceptWallet(result.result.wallet);
      if (result.snapshot && !restoreSnapshot(result.snapshot)) throw new Error('Your saved tool needs recovery.');
      setToolLayer(null); setPaused(false); resume();
      void feedback.play('stitchComplete');
    } catch (error) {
      if (isInsufficientPointsError(error, operationId)) {
        setToolError('You need more points for this tool. No points were spent.');
        setToolLayer({ type: 'tool', kind, pocketId });
        void useCommerceStore.getState().refreshWallet().catch(() => undefined);
      } else failedTool(error);
    }
    finally { toolLock.current = false; setToolBusy(false); }
  }, [failedTool, feedback, getSnapshot, journal, preparePaidTool, restoreSnapshot, resume, runId, state.pocketId, state.tick, suspend, toolBusy]);
  const recoverTool = useCallback(async () => {
    if (toolBusy || toolLock.current) return;
    toolLock.current = true;
    setToolBusy(true);
    try {
      const result = await journal.recover();
      if (result.result) useCommerceStore.getState().acceptWallet(result.result.wallet);
      if (result.snapshot) restoreSnapshot(result.snapshot);
      setToolNotice(result.cancelled ? 'Not enough points for that tool. No points were spent.'
        : result.refunded ? 'Your unused tool was refunded.' : 'Your tool is ready.');
      if (result.cancelled) void useCommerceStore.getState().refreshWallet().catch(() => undefined);
      setToolLayer(null); setToolError(''); resume();
    } catch (error) { failedTool(error); }
    finally { toolLock.current = false; setToolBusy(false); }
  }, [failedTool, journal, restoreSnapshot, resume, toolBusy]);
  const cancelGesture = useCallback(() => {
    cancelCuePull();
    cancelAim();
  }, [cancelAim, cancelCuePull]);
  const updatePull = useCallback((pull: LaunchPoint) => {
    const clamped = updateAim(pull);
    if (clamped) updateCuePull(clamped);
  }, [updateAim, updateCuePull]);

  // Resizing changes the finger-to-world mapping. Discard a pull instead of
  // releasing it through a different projection; the flight itself is preserved.
  useEffect(() => { cancelGesture(); }, [cancelGesture, offsetX, offsetY, scale]);
  useEffect(() => { if (!focused || paused || toolLayer || toolBusy) cancelGesture(); }, [cancelGesture, focused, paused, toolBusy, toolLayer]);
  const gesture = useMemo(() => Gesture.Pan().withTestId('launch-pull-gesture').runOnJS(true).minDistance(0).maxPointers(1)
    .enabled(focused && !paused && !toolLayer && !toolBusy && state.phase === 'held')
    .onBegin((event) => {
      const accepted = beginAim({ x: (event.x - offsetX) / scale, y: (event.y - offsetY) / scale + getCameraY() }, Math.max(52, 24 / scale));
      beginCuePull(accepted);
    })
    .onUpdate((event) => updatePull({ x: event.translationX / scale, y: event.translationY / scale }))
    .onEnd((event, success) => {
      if (success) {
        updatePull({ x: event.translationX / scale, y: event.translationY / scale });
        releaseAim();
      } else cancelGesture();
    })
    .onFinalize(() => cancelGesture()),
  [beginAim, beginCuePull, cancelGesture, focused,
    getCameraY, offsetX, offsetY, paused, releaseAim, scale, state.phase, toolBusy, toolLayer, updatePull]);
  useEffect(() => { onScore(score.pockets); }, [onScore, score.pockets]);
  const measure = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setArea((previous) => previous.width === width && previous.height === height ? previous : { width, height });
  };
  const dead = state.phase === 'failed';
  const status = dead ? session.message : paused ? 'Your run is paused.'
    : state.phase === 'flying' ? 'Find your next landing…' : session.message || 'Pull back. Keep climbing.';
  const showCue = hints && !session.hasAimed && score.pockets === 0 && state.phase === 'held' && !paused && !toolLayer;
  const showChallengeCue = !showCue && hints && focused && !paused && state.phase === 'held'
    && !toolLayer && challengeCue;
  const trayTop = insets.top + hudHeight + 20;
  const cueTop = trayTop + trayHeight + 8;
  const teleportTargets = toolLayer?.type === 'land' ? toolLayer.pockets.map((pocket) => ({
    id: pocket.id, x: offsetX + pocket.x * scale,
    y: offsetY + (pocket.y - toolLayer.cameraY) * scale, width: pocket.width * scale,
  })).filter((target) => target.y - 12 >= cueTop && target.y + 32 < area.height - insets.bottom - 74
    && target.x - target.width / 2 >= 0 && target.x + target.width / 2 <= area.width) : [];

  return <View style={styles.run} testID="launch-run-screen">
    {focused && <StatusBar style="dark" />}
    <View style={styles.playArea} onLayout={measure} testID="launch-play-area">
      {area.width > 1 && area.height > 1 && <GestureDetector gesture={gesture}>
        <View testID="launch-playfield" collapsable={false} style={[styles.canvasFrame, area]}
          accessibilityLabel="Endless fabric playground. Pull the button's pocket backward and release. Catch pockets above you. Falling off or touching thorns ends the run.">
          <LaunchCanvas room={room} state={state} motion={motion} size={area} bottomInset={insets.bottom}
            nextPocketId={session.nextPocketId} highContrast={highContrast} reducedMotion={reducedMotion}
            showTutorial={showCue} prediction={session.prediction} previewActive={session.tools.previewActive} />
        </View>
      </GestureDetector>}
    </View>

    <View testID="launch-hud" pointerEvents="box-none"
      onLayout={(event) => setHudHeight(event.nativeEvent.layout.height)}
      style={[styles.hud, { top: insets.top + 12, left: insets.left + 12, right: insets.right + 12 }]}>
      <Pressable testID="launch-points-button" accessibilityRole="button" accessibilityLabel={`Points shop. ${commerce.wallet?.points ?? 0} points`}
        disabled={toolBusy || !!toolLayer} onPress={openShop} style={[styles.walletBadge, highContrast && styles.contrastSurface]}>
      <View style={styles.scoreBadge}>
        <View style={styles.metric}>
          <Text style={styles.metricLabel}>POCKETS</Text>
          <Text testID="launch-score" accessibilityLabel={`${score.pockets} pockets reached`} style={styles.metricValue}>{score.pockets}</Text>
        </View>
        <View style={styles.metricDivider} />
        <View style={styles.metric}>
          <Text style={styles.metricLabel}>BEST</Text>
          <Text testID="launch-best" accessibilityLabel={`Best ${best} pockets`} style={styles.bestValue}>{best}</Text>
        </View>
      </View>
      <Text testID="launch-points-balance" style={styles.pointsLabel}>✧ {commerce.wallet?.points ?? 0} points <Text style={styles.pointsPlus}>＋</Text></Text>
      </Pressable>
      <View pointerEvents="box-none" style={styles.hudActions}>
        {!dead && !paused && <IconAction label="Pause" icon="pause" testID="launch-pause-button" disabled={toolBusy || !!toolLayer}
          onPress={() => { cancelGesture(); setPaused(true); }} />}
        <IconAction label="Settings" icon="settings-outline" testID="launch-settings-button" disabled={toolBusy || !!toolLayer} onPress={() => void openSettings()} />
      </View>
    </View>
    {!paused && <View pointerEvents="box-none" onLayout={(event) => setTrayHeight(event.nativeEvent.layout.height)}
      style={[styles.toolTray, { top: trayTop, left: insets.left + 12, right: insets.right + 12 }]}>
      <ToolTray inventory={session.tools.inventory} previewActive={session.tools.previewActive}
        reviveUsed={session.tools.reviveUsed} phase={state.phase} disabled={toolBusy || !!toolLayer}
        highContrast={highContrast} onTool={chooseTool} />
    </View>}

    {showCue && <View testID="launch-cue" pointerEvents="none"
      style={[styles.cue, highContrast && styles.contrastSurface, { top: cueTop }]}>
      <Text testID="launch-instruction" numberOfLines={fontScale > 1.3 ? 3 : 2} style={styles.hint}>
        Pull the button down and left. Let go to catch the gold pocket.
      </Text>
    </View>}
    {showChallengeCue && <View testID="launch-challenge-cue" pointerEvents="none"
      style={[styles.cue, highContrast && styles.contrastSurface,
        { top: cueTop, left: insets.left + 20, right: insets.right + 20 }]}>
      <Text accessibilityLiveRegion="polite" numberOfLines={fontScale > 1.3 ? 3 : 2} style={styles.hint}>
        {challengeCue}
      </Text>
    </View>}
    {!showCue && !showChallengeCue && !toolLayer && !paused && !dead
      && (toolNotice || session.tools.previewActive || session.message.startsWith('+1')) && <View pointerEvents="none" style={[styles.cue, { top: cueTop }]}>
      <Text style={styles.hint}>{toolNotice || (session.tools.previewActive ? session.prediction?.horizon
        ? 'Preview ends at 8 seconds · … means the flight continues' : 'Preview ready · pull to see your flight' : session.message)}</Text>
    </View>}
    <Text testID="launch-status" accessibilityLiveRegion="polite" style={styles.screenReaderStatus}>{status}</Text>

    {(dead || paused) && !toolLayer && <View style={[styles.modalLayer, { paddingTop: cueTop + 12, paddingBottom: insets.bottom + 16 }]}>
      <View testID={dead ? 'launch-game-over' : 'launch-paused'} style={styles.overlay}>
        <Text style={styles.overlayEyebrow}>PULLTHREAD</Text>
        <Text accessibilityRole="header" style={styles.overlayTitle}>{dead ? 'Run over' : 'Paused'}</Text>
        <Text style={styles.overlayCopy}>{dead ? session.message : 'Your next little leap can wait.'}</Text>
        {dead && <Text style={styles.result}>{score.pockets} {score.pockets === 1 ? 'pocket' : 'pockets'} reached · best {best}</Text>}
        {dead && !session.tools.reviveUsed && <Pressable testID="launch-revive-button" accessibilityRole="button"
          disabled={toolBusy} onPress={() => chooseTool('revive')} style={styles.reviveButton}>
          <ToolIcon kind="revive" size={20} color="#28594b" />
          <Text style={styles.actionText}>{session.tools.inventory.revive > 0 ? 'Use free Revive' : `Revive · ${TOOL_COSTS.revive} points`}</Text>
        </Pressable>}
        {dead && session.tools.reviveUsed && <Text style={styles.overlayCopy}>Revive used this run.</Text>}
        <View style={styles.controls}>
          {dead ? <Action label="Play again" testID="launch-restart-button" disabled={toolBusy} primary onPress={() => void restartRun()} /> : <>
            <Action label="New run" testID="launch-restart-button" disabled={toolBusy} onPress={() => void restartRun()} />
            <Action label="Resume" testID="launch-resume-button" primary onPress={() => setPaused(false)} />
          </>}
        </View>
      </View>
    </View>}
    {toolLayer?.type === 'land' && <View testID="teleport-selection" style={styles.targetLayer} pointerEvents="box-none" accessibilityViewIsModal>
      {teleportTargets.map((target, index) => <Pressable key={target.id} testID={`teleport-${target.id}`}
        accessibilityRole="button" accessibilityLabel={`Land in visible pocket ${index + 1}`}
        onPress={() => landAt(target.id)} style={[styles.landingTarget, { left: target.x - Math.max(48, target.width) / 2,
          top: target.y - 12, width: Math.max(48, target.width) }]}>
        <Text style={styles.landingText}>LAND HERE</Text>
      </Pressable>)}
      <View style={[styles.landingInstructions, { bottom: insets.bottom + 12, left: insets.left + 12, right: insets.right + 12 }]}>
        <Text style={styles.landingCopy}>{teleportTargets.length ? 'Tap a highlighted pocket.' : 'No clear landing is visible here.'}</Text>
        <Pressable testID="teleport-cancel" accessibilityRole="button" onPress={closeTools} style={styles.cancelLanding}><Text style={styles.actionText}>Cancel</Text></Pressable>
      </View>
    </View>}
    {toolLayer && toolLayer.type !== 'land' && <View style={[styles.shopLayer,
      { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12, paddingLeft: insets.left + 14, paddingRight: insets.right + 14 }]}>
      {toolLayer.type === 'shop' ? <PointsShop onClose={closeTools} /> : <ScrollView contentContainerStyle={styles.dialogScroll} style={styles.dialogScroller}>
        <View testID={toolLayer.type === 'recovery' ? 'tool-recovery' : 'tool-confirmation'} style={styles.overlay} accessibilityViewIsModal>
          {toolLayer.type === 'tool' ? <>
            <ToolIcon kind={toolLayer.kind} size={36} color="#28594b" />
            <Text accessibilityRole="header" style={styles.overlayTitle}>{TOOL_LABELS[toolLayer.kind]}</Text>
            <Text style={styles.overlayCopy}>{TOOL_DESCRIPTIONS[toolLayer.kind]}</Text>
            <Text style={styles.result}>{TOOL_COSTS[toolLayer.kind]} points · {commerce.wallet?.points ?? 0} available</Text>
            {!!toolError && <Text accessibilityLiveRegion="polite" style={styles.overlayCopy}>{toolError}</Text>}
            {commerce.status !== 'ready' && <Text style={[styles.overlayCopy, { marginTop: 10 }]}>Find free tools in the climb. The points shop is unavailable on this device right now.</Text>}
            <View style={styles.controls}>
              <Action label="Cancel" testID="tool-confirm-cancel" disabled={toolBusy} onPress={closeTools} />
              {commerce.status === 'ready' && (commerce.wallet?.points ?? 0) >= TOOL_COSTS[toolLayer.kind]
                ? <Action label={`Use ${TOOL_COSTS[toolLayer.kind]} points`} testID="tool-confirm-buy" primary disabled={toolBusy}
                  onPress={() => void buyTool(toolLayer.kind, toolLayer.pocketId)} />
                : <Action label="Get points" testID="tool-get-points" primary disabled={toolBusy} onPress={openShop} />}
            </View>
          </> : <>
            <Text accessibilityRole="header" style={styles.overlayTitle}>Keep your tool</Text>
            <Text style={styles.overlayCopy}>{toolError || 'Checking your saved tool and points.'}</Text>
            <Text style={[styles.overlayCopy, { marginTop: 10 }]}>Your run is paused. Retrying uses the same purchase request.</Text>
            <View style={styles.controls}>
              <Action label="Get points" testID="tool-recovery-shop" disabled={toolBusy} onPress={openShop} />
              <Action label="Try again" testID="tool-recovery-retry" primary disabled={toolBusy} onPress={() => void recoverTool()} />
            </View>
          </>}
          {toolBusy && <ActivityIndicator style={{ marginTop: 14 }} color="#28594b" accessibilityLabel="Checking your tool" />}
        </View>
      </ScrollView>}
    </View>}
  </View>;
}

export function EndlessGameScreen({ navigation }: Props) {
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 0x100000000));
  const best = useEndlessProgressStore((state) => state.bestPockets);
  const onScore = useEndlessProgressStore((state) => state.recordScore);
  const restart = useCallback(() => setSeed((previous) => (previous + 0x9e3779b9) >>> 0), []);
  return <View style={styles.screen} testID="endless-game-screen">
    <EndlessFlight key={seed} seed={seed} best={best} onRestart={restart} onScore={onScore}
      onSettings={() => navigation.navigate('Settings')} />
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#eadfc6' },
  run: { flex: 1 },
  playArea: { ...StyleSheet.absoluteFill },
  canvasFrame: { overflow: 'hidden' },
  hud: { position: 'absolute', zIndex: 2, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  walletBadge: { borderRadius: 18, borderWidth: 1, borderColor: '#c3b695', backgroundColor: 'rgba(255,248,231,0.95)', flexShrink: 1, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 5 },
  scoreBadge: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  pointsLabel: { fontFamily: 'NunitoSans_800ExtraBold', color: '#715416', fontSize: 10, textAlign: 'center', marginTop: 3 },
  pointsPlus: { color: '#28594b' },
  toolTray: { position: 'absolute', zIndex: 2 },
  contrastSurface: { backgroundColor: '#fffdf5', borderColor: '#244b45' },
  metric: { alignItems: 'center', flexShrink: 1 },
  metricLabel: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 9, lineHeight: 12, letterSpacing: 0.6, color: '#62684d' },
  metricValue: { fontFamily: 'Fraunces_600SemiBold', fontSize: 26, lineHeight: 30, color: '#244b45' },
  bestValue: { fontFamily: 'Fraunces_600SemiBold', fontSize: 22, lineHeight: 30, color: '#58715b' },
  metricDivider: { alignSelf: 'stretch', width: 1, backgroundColor: '#d5c7a9' },
  hudActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8 },
  iconAction: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#c3b695', backgroundColor: '#fff8e7' },
  cue: { position: 'absolute', alignSelf: 'center', left: 20, right: 20, maxWidth: 440, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 14, borderWidth: 1, borderColor: '#d5c7a9', backgroundColor: 'rgba(255,248,231,0.94)' },
  hint: { fontFamily: 'NunitoSans_700Bold', fontSize: 12, lineHeight: 17, color: '#425542', textAlign: 'center' },
  screenReaderStatus: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0 },
  modalLayer: { ...StyleSheet.absoluteFill, zIndex: 1, backgroundColor: 'rgba(36,63,55,0.2)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 20 },
  overlay: { width: '100%', maxWidth: 370, alignItems: 'center', backgroundColor: '#fff7e7', borderWidth: 2, borderColor: '#baa987', borderRadius: 24, paddingHorizontal: 20, paddingVertical: 24 },
  overlayEyebrow: { fontFamily: 'NunitoSans_800ExtraBold', color: '#6b6f55', fontSize: 10, letterSpacing: 1.8 },
  overlayTitle: { fontFamily: 'Fraunces_600SemiBold', fontSize: 36, color: '#243f37', marginVertical: 5 },
  overlayCopy: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 13, lineHeight: 19, color: '#62644e', textAlign: 'center' },
  result: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 14, color: '#244b45', marginTop: 12, textAlign: 'center' },
  controls: { flexDirection: 'row', gap: 8, marginTop: 20, width: '100%' },
  action: { flex: 1, minHeight: 48, borderRadius: 14, borderWidth: 1.5, borderColor: '#c7b99b', backgroundColor: '#fff7e7', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, paddingVertical: 10 },
  primary: { backgroundColor: '#28594b', borderColor: '#28594b' },
  actionText: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 13, color: '#354c3f', textAlign: 'center' },
  primaryText: { color: '#fff7e7' }, pressed: { opacity: 0.8 },
  disabled: { opacity: 0.5 },
  reviveButton: { minHeight: 44, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', width: '100%', marginTop: 12, borderRadius: 12, backgroundColor: '#e4ead6' },
  targetLayer: { ...StyleSheet.absoluteFill, zIndex: 3, backgroundColor: 'rgba(255,248,231,0.08)' },
  landingTarget: { position: 'absolute', height: 48, borderWidth: 2, borderStyle: 'dashed', borderColor: '#28594b', backgroundColor: 'rgba(249,246,213,0.88)', borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  landingText: { color: '#244b45', fontFamily: 'NunitoSans_800ExtraBold', fontSize: 11, letterSpacing: 0.5 },
  landingInstructions: { position: 'absolute', flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderWidth: 1, borderColor: '#bba980', borderRadius: 15, backgroundColor: '#fff8e7' },
  landingCopy: { flex: 1, fontFamily: 'NunitoSans_800ExtraBold', fontSize: 12, color: '#244b45' },
  cancelLanding: { minHeight: 44, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 10, backgroundColor: '#eae2cc' },
  shopLayer: { ...StyleSheet.absoluteFill, zIndex: 4, backgroundColor: 'rgba(28,52,44,0.5)', alignItems: 'center', justifyContent: 'center' },
  dialogScroller: { flexGrow: 0, maxHeight: '100%', width: '100%', maxWidth: 370 },
  dialogScroll: { alignItems: 'center' },
});
