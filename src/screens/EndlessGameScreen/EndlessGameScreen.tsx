import Ionicons from '@expo/vector-icons/Ionicons';
import { useIsFocused } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
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

type Props = NativeStackScreenProps<RootStackParamList, 'EndlessGame'>;

function Action({ label, onPress, testID, primary = false }: {
  label: string; onPress: () => void; testID: string; primary?: boolean;
}) {
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label}
    onPress={onPress} style={({ pressed }) => [styles.action, primary && styles.primary, pressed && styles.pressed]}>
    <Text style={[styles.actionText, primary && styles.primaryText]}>{label}</Text>
  </Pressable>;
}

function IconAction({ label, icon, onPress, testID }: {
  label: string; icon: 'pause' | 'settings-outline'; onPress: () => void; testID: string;
}) {
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label}
    onPress={onPress} style={({ pressed }) => [styles.iconAction, pressed && styles.pressed]}>
    <Ionicons name={icon} size={23} color="#244b45" />
  </Pressable>;
}

function EndlessFlight({ seed, best, onRestart, onScore, onSettings }: {
  seed: number; best: number; onRestart: () => void; onScore: (score: number) => void; onSettings: () => void;
}) {
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { fontScale = 1 } = useWindowDimensions();
  const [paused, setPaused] = useState(false);
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
  const session = useLaunchSession(seed, focused && !paused, feedback);
  const { state, room, motion, score, beginAim, updateAim, releaseAim, cancelAim } = session;
  const { cue: challengeCue, beginCuePull, updateCuePull, cancelCuePull } = useChallengeCue(session.challenge, state.pocketId, hints);
  const { scale, offsetX, offsetY } = getLaunchViewport(area, room.bounds, insets.bottom);
  const cancelGesture = useCallback(() => {
    cancelCuePull();
    cancelAim();
  }, [cancelAim, cancelCuePull]);
  const updatePull = useCallback((pull: LaunchPoint) => {
    updateAim(pull);
    updateCuePull({ x: motion.pullX.get(), y: motion.pullY.get() });
  }, [motion.pullX, motion.pullY, updateAim, updateCuePull]);

  // Resizing changes the finger-to-world mapping. Discard a pull instead of
  // releasing it through a different projection; the flight itself is preserved.
  useEffect(() => { cancelGesture(); }, [cancelGesture, offsetX, offsetY, scale]);
  useEffect(() => { if (!focused || paused) cancelGesture(); }, [cancelGesture, focused, paused]);
  const gesture = useMemo(() => Gesture.Pan().withTestId('launch-pull-gesture').runOnJS(true).minDistance(0).maxPointers(1)
    .enabled(focused && !paused && state.phase === 'held')
    .onBegin((event) => {
      const accepted = beginAim({ x: (event.x - offsetX) / scale, y: (event.y - offsetY) / scale + motion.cameraY.get() }, Math.max(52, 24 / scale));
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
    motion.cameraY, offsetX, offsetY, paused, releaseAim, scale, state.phase, updatePull]);
  useEffect(() => { onScore(score.pockets); }, [onScore, score.pockets]);
  const measure = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setArea((previous) => previous.width === width && previous.height === height ? previous : { width, height });
  };
  const dead = state.phase === 'failed';
  const status = dead ? session.message : paused ? 'Your run is paused.'
    : state.phase === 'flying' ? 'Find your next landing…' : session.message || 'Pull back. Keep climbing.';
  const showCue = hints && !session.hasAimed && score.pockets === 0 && state.phase === 'held' && !paused;
  const showChallengeCue = !showCue && hints && focused && !paused && state.phase === 'held'
    && challengeCue;

  return <View style={styles.run} testID="launch-run-screen">
    {focused && <StatusBar style="dark" />}
    <View style={styles.playArea} onLayout={measure} testID="launch-play-area">
      {area.width > 1 && area.height > 1 && <GestureDetector gesture={gesture}>
        <View testID="launch-playfield" collapsable={false} style={[styles.canvasFrame, area]}
          accessibilityLabel="Endless fabric playground. Pull the button's pocket backward and release. Catch pockets above you. Falling off or touching thorns ends the run.">
          <LaunchCanvas room={room} state={state} motion={motion} size={area} bottomInset={insets.bottom}
            nextPocketId={session.nextPocketId} highContrast={highContrast} reducedMotion={reducedMotion}
            showTutorial={showCue} />
        </View>
      </GestureDetector>}
    </View>

    <View testID="launch-hud" pointerEvents="box-none"
      onLayout={(event) => setHudHeight(event.nativeEvent.layout.height)}
      style={[styles.hud, { top: insets.top + 12, left: insets.left + 12, right: insets.right + 12 }]}>
      <View pointerEvents="none" style={[styles.scoreBadge, highContrast && styles.contrastSurface]}>
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
      <View pointerEvents="box-none" style={styles.hudActions}>
        {!dead && !paused && <IconAction label="Pause" icon="pause" testID="launch-pause-button" onPress={() => setPaused(true)} />}
        <IconAction label="Settings" icon="settings-outline" testID="launch-settings-button" onPress={onSettings} />
      </View>
    </View>

    {showCue && <View testID="launch-cue" pointerEvents="none"
      style={[styles.cue, highContrast && styles.contrastSurface, { top: insets.top + hudHeight + 24 }]}>
      <Text testID="launch-instruction" numberOfLines={fontScale > 1.3 ? 3 : 2} style={styles.hint}>
        Pull the button down and left. Let go to catch the gold pocket.
      </Text>
    </View>}
    {showChallengeCue && <View testID="launch-challenge-cue" pointerEvents="none"
      style={[styles.cue, highContrast && styles.contrastSurface,
        { top: insets.top + hudHeight + 24, left: insets.left + 20, right: insets.right + 20 }]}>
      <Text accessibilityLiveRegion="polite" numberOfLines={fontScale > 1.3 ? 3 : 2} style={styles.hint}>
        {challengeCue}
      </Text>
    </View>}
    <Text testID="launch-status" accessibilityLiveRegion="polite" style={styles.screenReaderStatus}>{status}</Text>

    {(dead || paused) && <View style={[styles.modalLayer, { paddingTop: insets.top + hudHeight + 28, paddingBottom: insets.bottom + 16 }]}>
      <View testID={dead ? 'launch-game-over' : 'launch-paused'} style={styles.overlay}>
        <Text style={styles.overlayEyebrow}>PULLTHREAD</Text>
        <Text accessibilityRole="header" style={styles.overlayTitle}>{dead ? 'Run over' : 'Paused'}</Text>
        <Text style={styles.overlayCopy}>{dead ? session.message : 'Your next little leap can wait.'}</Text>
        {dead && <Text style={styles.result}>{score.pockets} {score.pockets === 1 ? 'pocket' : 'pockets'} reached · best {best}</Text>}
        <View style={styles.controls}>
          {dead ? <Action label="Play again" testID="launch-restart-button" primary onPress={onRestart} /> : <>
            <Action label="New run" testID="launch-restart-button" onPress={onRestart} />
            <Action label="Resume" testID="launch-resume-button" primary onPress={() => setPaused(false)} />
          </>}
        </View>
      </View>
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
  scoreBadge: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, borderWidth: 1, borderColor: '#c3b695', backgroundColor: 'rgba(255,248,231,0.95)', flexShrink: 1 },
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
});
