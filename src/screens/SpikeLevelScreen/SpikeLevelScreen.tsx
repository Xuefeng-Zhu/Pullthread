import Ionicons from '@expo/vector-icons/Ionicons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import {
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  Gesture,
  GestureDetector,
} from 'react-native-gesture-handler';
import { runOnJS, useSharedValue } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GameControls } from '../../components/GameControls';
import { OutcomeBanner } from '../../components/OutcomeBanner';
import { TutorialCoachmark } from '../../components/TutorialCoachmark';
import type { RootStackParamList } from '../../app/navigation/RootNavigator';
import type { SimulationOutcome, Stitch } from '../../game/core/types';
import {
  ExpoFeedbackService,
  type FeedbackService,
} from '../../game/feedback';
import {
  createPinchStitch,
  createValidPinchStitch,
  findStitchNearPoint,
  viewPointToFabric,
  type CanvasSize,
} from '../../game/input/stitchGesture';
import {
  SPIKE_LEVEL,
  TUTORIAL_GUIDED_PINCH_STITCH,
  createSpikeWorld,
} from '../../game/levels/spikeLevel';
import { FabricCanvas } from '../../game/rendering/FabricCanvas';
import {
  simulateRoute,
  useGameSession,
} from '../../game/runtime/useGameSession';
import {
  createTutorialFlowState,
  tutorialFlowReducer,
} from '../../game/tutorial/tutorialFlow';
import {
  selectThreadUsed,
  useGameStore,
} from '../../store/useGameStore';
import {
  CURRENT_TUTORIAL_VERSION,
  usePreferencesStore,
} from '../../store/usePreferencesStore';
import {
  colors,
  highContrastColors,
  radii,
  shadows,
  spacing,
  touchTargets,
} from '../../theme/tokens';

const EMPTY_SIZE: CanvasSize = { width: 1, height: 1 };
const TUTORIAL_STITCH_ANCHOR_STYLE = {
  left: `${
    ((TUTORIAL_GUIDED_PINCH_STITCH.start.x - SPIKE_LEVEL.fabricBounds.x) /
      SPIKE_LEVEL.fabricBounds.width) *
    100
  }%` as const,
  top: `${
    ((TUTORIAL_GUIDED_PINCH_STITCH.start.y - SPIKE_LEVEL.fabricBounds.y) /
      SPIKE_LEVEL.fabricBounds.height) *
    100
  }%` as const,
};

function statusCopy(
  phase: ReturnType<typeof useGameStore.getState>['phase'],
  stitchCount: number,
  routeSucceeds: boolean,
): string {
  if (phase === 'running') return 'Gravity is taking over…';
  if (phase === 'succeeded') return 'The cloth carried it home.';
  if (phase === 'failed') return 'That pull changed the route. Refine it and retry.';
  if (stitchCount === 0) return 'Drag a long stitch beside the button.';
  if (routeSucceeds) return 'The route reaches the embroidery. Release it!';
  return 'The route changed. Release it or move the stitch.';
}

type SpikeLevelScreenProps = NativeStackScreenProps<
  RootStackParamList,
  'SpikeLevel'
>;

export function SpikeLevelScreen({ navigation }: SpikeLevelScreenProps) {
  const viewport = useWindowDimensions();
  const compactViewport = viewport.width < 350 || viewport.height < 700;
  const phase = useGameStore((state) => state.phase);
  const stitches = useGameStore((state) => state.stitches);
  const outcome = useGameStore((state) => state.outcome);
  const commitStitch = useGameStore((state) => state.commitStitch);
  const removeStitch = useGameStore((state) => state.removeStitch);
  const undo = useGameStore((state) => state.undo);
  const clearStitches = useGameStore((state) => state.clearStitches);
  const release = useGameStore((state) => state.release);
  const retry = useGameStore((state) => state.retry);
  const resolve = useGameStore((state) => state.resolve);
  const resetSession = useGameStore((state) => state.resetSession);
  const threadUsed = useGameStore(selectThreadUsed);
  const soundEnabled = usePreferencesStore((state) => state.soundEnabled);
  const hapticsEnabled = usePreferencesStore((state) => state.hapticsEnabled);
  const reducedMotion = usePreferencesStore(
    (state) => state.reducedMotionEnabled,
  );
  const highContrast = usePreferencesStore(
    (state) => state.highContrastEnabled,
  );
  const tutorialHintsEnabled = usePreferencesStore(
    (state) => state.tutorialHintsEnabled,
  );
  const completedTutorialVersion = usePreferencesStore(
    (state) => state.completedTutorialVersion,
  );
  const completeTutorial = usePreferencesStore(
    (state) => state.completeTutorial,
  );
  const [canvasSize, setCanvasSize] = useState<CanvasSize>(EMPTY_SIZE);
  const [preview, setPreview] = useState<Stitch | null>(null);
  const [tutorial, dispatchTutorial] = useReducer(
    tutorialFlowReducer,
    completedTutorialVersion >= CURRENT_TUTORIAL_VERSION,
    createTutorialFlowState,
  );
  const gestureStartX = useSharedValue(0);
  const gestureStartY = useSharedValue(0);
  const gestureThreadTick = useSharedValue(0);
  const feedback = useMemo<FeedbackService>(
    () => new ExpoFeedbackService(),
    [],
  );

  const route = useMemo(() => simulateRoute(stitches), [stitches]);
  const displayWorld = useMemo(
    () => createSpikeWorld(preview ? [...stitches, preview] : stitches),
    [preview, stitches],
  );

  useEffect(() => {
    feedback.setPreferences({ hapticsEnabled, soundEnabled });
  }, [feedback, hapticsEnabled, soundEnabled]);

  useEffect(() => {
    if (
      tutorial.completed ||
      completedTutorialVersion >= CURRENT_TUTORIAL_VERSION
    ) {
      return;
    }

    if (stitches.length === 0) {
      dispatchTutorial({ type: 'stitchesCleared' });
      return;
    }

    if (tutorial.step === 'pull') {
      dispatchTutorial({ type: 'stitchCommitted' });
      return;
    }

    if (
      tutorial.step === 'release' &&
      route.outcome.status !== 'success'
    ) {
      dispatchTutorial({ type: 'routeFailed' });
    }
  }, [
    completedTutorialVersion,
    route.outcome.status,
    stitches.length,
    tutorial.completed,
    tutorial.step,
  ]);

  const handleOutcome = useCallback(
    (nextOutcome: SimulationOutcome) => {
      resolve(nextOutcome);
      void feedback.play(nextOutcome.status === 'success' ? 'success' : 'failure');
    },
    [feedback, resolve],
  );
  const session = useGameSession({
    phase,
    stitches,
    onOutcome: handleOutcome,
  });

  useEffect(
    () => () => {
      feedback.dispose();
    },
    [feedback],
  );

  const setDraft = useCallback((next: Stitch | null) => {
    setPreview(next);
  }, []);

  const beginDrag = useCallback(
    (startX: number, startY: number) => {
      const start = { x: startX, y: startY };
      setDraft(createPinchStitch('preview', start, start));
      void feedback.play('fabricTouch');
      void feedback.play('threadDraw');
    },
    [feedback, setDraft],
  );

  const updateDrag = useCallback(
    (startX: number, startY: number, endX: number, endY: number) => {
      const start = { x: startX, y: startY };
      const end = { x: endX, y: endY };
      const next = createPinchStitch('preview', start, end);
      setDraft(next);
    },
    [setDraft],
  );

  const finishDrag = useCallback(
    (startX: number, startY: number, endX: number, endY: number) => {
      const start = { x: startX, y: startY };
      const end = { x: endX, y: endY };
      setDraft(null);

      let stitchNumber = 1;
      while (stitches.some((stitch) => stitch.id === `stitch-${stitchNumber}`)) {
        stitchNumber += 1;
      }
      const stitch = createValidPinchStitch(
        `stitch-${stitchNumber}`,
        start,
        end,
      );
      if (!stitch) return;
      const committed = commitStitch(stitch, {
        maxStitches: SPIKE_LEVEL.maxStitches,
        threadBudget: SPIKE_LEVEL.threadBudget,
      });
      if (committed) {
        void feedback.play('stitchComplete');
      }
    },
    [commitStitch, feedback, setDraft, stitches],
  );

  const cancelDrag = useCallback(() => {
    setDraft(null);
  }, [setDraft]);

  const playThreadTick = useCallback(() => {
    void feedback.play('threadTick');
  }, [feedback]);

  const removeAtPoint = useCallback(
    (viewX: number, viewY: number) => {
      if (phase !== 'planning') return;
      const point = viewPointToFabric(
        { x: viewX, y: viewY },
        canvasSize,
        SPIKE_LEVEL.fabricBounds,
      );
      const stitch = findStitchNearPoint(stitches, point);
      if (stitch) {
        removeStitch(stitch.id);
        void feedback.play('buttonClick');
      }
    },
    [canvasSize, feedback, phase, removeStitch, stitches],
  );

  /* eslint-disable react-hooks/immutability -- Gesture worklets intentionally mutate Reanimated SharedValues on the UI thread. */
  const stitchGesture = useMemo(() => {
    const pan = Gesture.Pan()
      .enabled(phase === 'planning')
      .minDistance(8)
      .onBegin((event) => {
        const viewStartX = event.x;
        const viewStartY = event.y;
        gestureStartX.value =
          SPIKE_LEVEL.fabricBounds.x +
          Math.max(0, Math.min(1, viewStartX / canvasSize.width)) *
            SPIKE_LEVEL.fabricBounds.width;
        gestureStartY.value =
          SPIKE_LEVEL.fabricBounds.y +
          Math.max(0, Math.min(1, viewStartY / canvasSize.height)) *
            SPIKE_LEVEL.fabricBounds.height;
        gestureThreadTick.value = 0;
        runOnJS(beginDrag)(gestureStartX.value, gestureStartY.value);
      })
      .onUpdate((event) => {
        const endX =
          SPIKE_LEVEL.fabricBounds.x +
          Math.max(0, Math.min(1, event.x / canvasSize.width)) *
            SPIKE_LEVEL.fabricBounds.width;
        const endY =
          SPIKE_LEVEL.fabricBounds.y +
          Math.max(0, Math.min(1, event.y / canvasSize.height)) *
            SPIKE_LEVEL.fabricBounds.height;
        const threadCost = Math.ceil(
          Math.hypot(endX - gestureStartX.value, endY - gestureStartY.value) *
            100,
        );
        const threadTick = Math.floor(threadCost / 12);
        if (threadTick > gestureThreadTick.value) {
          gestureThreadTick.value = threadTick;
          runOnJS(playThreadTick)();
        }
        runOnJS(updateDrag)(
          gestureStartX.value,
          gestureStartY.value,
          endX,
          endY,
        );
      })
      .onEnd((event) => {
        const endX =
          SPIKE_LEVEL.fabricBounds.x +
          Math.max(0, Math.min(1, event.x / canvasSize.width)) *
            SPIKE_LEVEL.fabricBounds.width;
        const endY =
          SPIKE_LEVEL.fabricBounds.y +
          Math.max(0, Math.min(1, event.y / canvasSize.height)) *
            SPIKE_LEVEL.fabricBounds.height;
        runOnJS(finishDrag)(
          gestureStartX.value,
          gestureStartY.value,
          endX,
          endY,
        );
      })
      .onFinalize((_event, success) => {
        if (!success) runOnJS(cancelDrag)();
      });
    const tap = Gesture.Tap()
      .enabled(phase === 'planning')
      .maxDuration(260)
      .onEnd((event, success) => {
        if (success) runOnJS(removeAtPoint)(event.x, event.y);
      });

    return Gesture.Race(pan, tap);
  }, [
    beginDrag,
    cancelDrag,
    canvasSize.height,
    canvasSize.width,
    finishDrag,
    gestureStartX,
    gestureStartY,
    gestureThreadTick,
    phase,
    playThreadTick,
    removeAtPoint,
    updateDrag,
  ]);
  /* eslint-enable react-hooks/immutability */

  const onPlayfieldLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width > 0 && height > 0) setCanvasSize({ width, height });
  }, []);

  const handleRelease = useCallback(() => {
    setDraft(null);
    if (route.outcome.status === 'success' && !tutorial.completed) {
      dispatchTutorial({ type: 'released' });
      completeTutorial(CURRENT_TUTORIAL_VERSION);
    }
    void feedback.play('travelerRelease');
    void feedback.play('travelerRoll');
    release();
  }, [completeTutorial, feedback, release, route.outcome.status, setDraft, tutorial]);

  const handleUndo = useCallback(() => {
    undo();
    void feedback.play('buttonClick');
  }, [feedback, undo]);

  const handleReset = useCallback(() => {
    setDraft(null);
    if (phase === 'planning') clearStitches();
    else resetSession();
    void feedback.play('buttonClick');
  }, [clearStitches, feedback, phase, resetSession, setDraft]);

  const handleRetry = useCallback(() => {
    retry();
    void feedback.play('buttonClick');
  }, [feedback, retry]);

  const handleSkipTutorial = useCallback(() => {
    dispatchTutorial({ type: 'skipped' });
    completeTutorial(CURRENT_TUTORIAL_VERSION);
    void feedback.play('buttonClick');
  }, [completeTutorial, feedback]);

  const handleNextTutorial = useCallback(() => {
    if (route.outcome.status !== 'success') return;
    dispatchTutorial({ type: 'routeSucceeded' });
    void feedback.play('buttonClick');
  }, [feedback, route.outcome.status]);

  const handleOpenSettings = useCallback(() => {
    void feedback.play('buttonClick');
    navigation.navigate('Settings');
  }, [feedback, navigation]);

  const handleResults = useCallback(() => {
    void feedback.play('buttonClick');
    navigation.navigate('Results');
  }, [feedback, navigation]);

  const previewThread = preview?.threadCost ?? 0;
  const displayedThread = Math.min(
    SPIKE_LEVEL.threadBudget,
    threadUsed + previewThread,
  );
  const status = statusCopy(phase, stitches.length, route.outcome.status === 'success');
  const showTutorial =
    phase === 'planning' &&
    tutorialHintsEnabled &&
    completedTutorialVersion < CURRENT_TUTORIAL_VERSION &&
    !tutorial.completed;

  return (
    <SafeAreaView
      testID="spike-level-screen"
      style={[styles.screen, highContrast && styles.screenHighContrast]}
      edges={['top', 'bottom']}
    >
      <View style={[styles.header, compactViewport && styles.headerCompact]}>
        <View
          style={[
            styles.titlePlaque,
            highContrast && styles.outlineHighContrast,
          ]}
        >
          <Text style={[styles.title, compactViewport && styles.titleCompact]}>
            {SPIKE_LEVEL.name}
          </Text>
        </View>
        <Pressable
          testID="game-settings-button"
          accessibilityRole="button"
          accessibilityLabel="Open settings"
          accessibilityState={{ disabled: phase === 'running' }}
          disabled={phase === 'running'}
          onPress={handleOpenSettings}
          style={({ pressed }) => [
            styles.settingsButton,
            highContrast && styles.outlineHighContrast,
            phase === 'running' && styles.settingsButtonDisabled,
            pressed && phase !== 'running' && styles.settingsButtonPressed,
          ]}
        >
          <Ionicons name="settings-outline" size={23} color="#173746" />
        </Pressable>
      </View>

      <View style={[styles.hudRow, compactViewport && styles.hudRowCompact]}>
        <View
          style={[styles.hudPill, highContrast && styles.outlineHighContrast]}
        >
          <Text testID="stitch-count" style={styles.hudValue}>
            {stitches.length} / {SPIKE_LEVEL.maxStitches}
          </Text>
          <Text style={styles.hudLabel}>STITCHES</Text>
        </View>
        <View
          style={[styles.hudPill, highContrast && styles.outlineHighContrast]}
        >
          <Text style={styles.hudValue}>
            {displayedThread} / {SPIKE_LEVEL.threadBudget}
          </Text>
          <Text style={styles.hudLabel}>THREAD</Text>
        </View>
      </View>

      <View
        style={[styles.statusRow, compactViewport && styles.statusRowCompact]}
      >
        <View style={styles.statusNeedle} />
        <Text
          testID={phase === 'planning' ? 'planning-status' : 'run-status'}
          accessibilityLiveRegion="polite"
          style={styles.statusText}
        >
          {status}
        </Text>
      </View>

      {showTutorial ? (
        <View
          style={[
            styles.tutorialSlot,
            compactViewport && styles.tutorialSlotCompact,
          ]}
        >
          <TutorialCoachmark
            step={tutorial.step}
            compact={compactViewport}
            onSkip={handleSkipTutorial}
            onNext={
              tutorial.step === 'route' ? handleNextTutorial : undefined
            }
            nextDisabled={route.outcome.status !== 'success'}
          />
        </View>
      ) : null}

      <View
        testID="fabric-playfield"
        style={[
          styles.playfieldFrame,
          showTutorial && styles.playfieldWithTutorial,
          compactViewport && styles.playfieldCompact,
          highContrast && styles.playfieldHighContrast,
        ]}
        onLayout={onPlayfieldLayout}
      >
        <GestureDetector gesture={stitchGesture}>
          <View style={StyleSheet.absoluteFill} collapsable={false}>
            <FabricCanvas
              size={canvasSize}
              field={displayWorld.surface}
              stitches={stitches}
              preview={preview}
              route={route.points}
              routeSucceeds={route.outcome.status === 'success'}
              phase={phase}
              travelerX={session.travelerX}
              travelerY={session.travelerY}
              travelerSpeed={session.speed}
              highContrast={highContrast}
            />
          </View>
        </GestureDetector>
        {showTutorial && tutorial.step === 'pull' ? (
          <View
            testID="tutorial-stitch-anchor"
            accessible
            accessibilityLabel="Tutorial stitch guide. Start here and drag upward."
            pointerEvents="none"
            style={[
              styles.tutorialStitchAnchor,
              TUTORIAL_STITCH_ANCHOR_STYLE,
            ]}
          >
            <View style={styles.tutorialStitchAnchorDot} />
          </View>
        ) : null}
        {outcome ? (
          <OutcomeBanner
            outcome={outcome}
            highContrast={highContrast}
            reducedMotion={reducedMotion}
          />
        ) : null}
      </View>

      <GameControls
        phase={phase}
        canUndo={stitches.length > 0}
        onUndo={handleUndo}
        onReset={handleReset}
        onRelease={handleRelease}
        onRetry={handleRetry}
        onResults={handleResults}
        compact={compactViewport}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#162f3a' },
  screenHighContrast: { backgroundColor: '#071e27' },
  header: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
  },
  headerCompact: {
    minHeight: 48,
    paddingTop: 0,
  },
  titlePlaque: {
    flex: 1,
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    borderWidth: 2,
    borderColor: '#c8a979',
    backgroundColor: '#f2e2c5',
    ...shadows.soft,
  },
  settingsButton: {
    width: touchTargets.comfortable,
    height: touchTargets.comfortable,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    borderWidth: 2,
    borderColor: '#c8a979',
    backgroundColor: '#f2e2c5',
    ...shadows.soft,
  },
  settingsButtonPressed: {
    transform: [{ translateY: 2 }],
    backgroundColor: '#e6d2ac',
  },
  settingsButtonDisabled: {
    opacity: 0.5,
  },
  title: {
    color: colors.textPrimary,
    fontFamily: 'Fraunces_700Bold',
    fontSize: 25,
    letterSpacing: -0.3,
  },
  titleCompact: {
    fontSize: 22,
  },
  hudRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  hudRowCompact: {
    paddingTop: spacing.xs,
  },
  hudPill: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: '#b49369',
    backgroundColor: '#eeddbd',
  },
  hudValue: {
    color: '#173746',
    fontFamily: 'NunitoSans_800ExtraBold',
    fontSize: 16,
  },
  hudLabel: {
    color: '#634b40',
    fontFamily: 'NunitoSans_700Bold',
    fontSize: 10,
    letterSpacing: 0.7,
  },
  statusRow: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  statusRowCompact: {
    minHeight: 26,
  },
  statusNeedle: {
    width: 18,
    height: 2,
    borderRadius: 1,
    backgroundColor: '#d9b76e',
    transform: [{ rotate: '-22deg' }],
  },
  statusText: {
    flexShrink: 1,
    color: '#f3e5ca',
    fontFamily: 'NunitoSans_600SemiBold',
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'center',
  },
  tutorialSlot: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  tutorialSlotCompact: {
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.xs,
  },
  playfieldFrame: {
    flex: 1,
    minHeight: 300,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    overflow: 'hidden',
    borderRadius: 22,
    borderWidth: 3,
    borderColor: '#315868',
    backgroundColor: '#eddfc4',
    ...shadows.raised,
  },
  playfieldWithTutorial: { minHeight: 244 },
  playfieldCompact: {
    minHeight: 180,
    marginHorizontal: spacing.sm,
    marginBottom: spacing.xs,
  },
  playfieldHighContrast: { borderColor: highContrastColors.fabricOutline },
  outlineHighContrast: { borderColor: highContrastColors.fabricOutline },
  tutorialStitchAnchor: {
    position: 'absolute',
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#a93238',
    backgroundColor: 'rgba(242, 226, 197, 0.88)',
    transform: [{ translateX: -12 }, { translateY: -12 }],
    ...shadows.soft,
  },
  tutorialStitchAnchorDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#a93238',
  },
});
