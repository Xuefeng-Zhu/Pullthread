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
import type {
  SimulationOutcome,
  Stitch,
  StitchType,
} from '../../game/core/types';
import {
  ExpoFeedbackService,
  type FeedbackService,
} from '../../game/feedback';
import {
  createStitch,
  createValidStitch,
  findStitchNearPoint,
  viewPointToFabric,
  type CanvasSize,
} from '../../game/input/stitchGesture';
import {
  SPIKE_LEVEL,
  TUTORIAL_GUIDED_PINCH_STITCH,
} from '../../game/levels/spikeLevel';
import { getCampaignLevelAccess } from '../../game/levels/campaignAccess';
import {
  createLevelWorld,
  getCampaignLevel,
} from '../../game/levels/levelLoader';
import { FabricCanvas } from '../../game/rendering/FabricCanvas';
import {
  simulateRoute,
  useGameSession,
} from '../../game/runtime/useGameSession';
import {
  createTutorialFlowState,
  tutorialFlowReducer,
} from '../../game/tutorial/tutorialFlow';
import { useCampaignProgressStore } from '../../store/useCampaignProgressStore';
import { useDailyChallengeStore } from '../../store/useDailyChallengeStore';
import {
  selectHasFullGame,
  useEntitlementStore,
} from '../../store/useEntitlementStore';
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
  stitchType: StitchType,
): string {
  if (phase === 'running') return 'Gravity is taking over…';
  if (phase === 'succeeded') return 'The cloth carried it home.';
  if (phase === 'failed') return 'That pull changed the route. Refine it and retry.';
  if (stitchCount === 0) {
    return stitchType === 'pocket'
      ? 'Drag a pocket beneath the button’s route.'
      : 'Drag a long stitch beside the button.';
  }
  if (routeSucceeds) return 'The route reaches the embroidery. Release it!';
  return 'The route changed. Release it or move the stitch.';
}

type SpikeLevelScreenProps = NativeStackScreenProps<
  RootStackParamList,
  'SpikeLevel'
>;

export function SpikeLevelScreen({
  navigation,
  route: screenRoute,
}: SpikeLevelScreenProps) {
  const level = useMemo(
    () => getCampaignLevel(screenRoute.params.levelId),
    [screenRoute.params.levelId],
  );
  const isDaily = screenRoute.params.mode === 'daily';
  const dailyChallenge = useDailyChallengeStore((state) => state.challenge);
  const validDailyChallenge =
    isDaily &&
    dailyChallenge &&
    dailyChallenge.id === screenRoute.params.challengeId &&
    dailyChallenge.levelId === level.id
      ? dailyChallenge
      : null;
  const progressByLevel = useCampaignProgressStore(
    (state) => state.progressByLevel,
  );
  const hasFullGame = useEntitlementStore(selectHasFullGame);
  const levelAccess = useMemo(
    () =>
      isDaily
        ? {
            state: 'current' as const,
            canPlay: Boolean(validDailyChallenge),
            openPaywall: false,
            requiresFullGame: false,
          }
        : getCampaignLevelAccess(level.id, progressByLevel, hasFullGame),
    [hasFullGame, isDaily, level.id, progressByLevel, validDailyChallenge],
  );
  const viewport = useWindowDimensions();
  const compactViewport = viewport.width < 350 || viewport.height < 700;
  const phase = useGameStore((state) => state.phase);
  const storedStitches = useGameStore((state) => state.stitches);
  const activeLevelId = useGameStore((state) => state.activeLevelId);
  const activeSession = useGameStore((state) => state.activeSession);
  const stitches = useMemo(
    () => (activeLevelId === level.id ? storedStitches : []),
    [activeLevelId, level.id, storedStitches],
  );
  const outcome = useGameStore((state) => state.outcome);
  const commitStitch = useGameStore((state) => state.commitStitch);
  const removeStitch = useGameStore((state) => state.removeStitch);
  const undo = useGameStore((state) => state.undo);
  const clearStitches = useGameStore((state) => state.clearStitches);
  const release = useGameStore((state) => state.release);
  const retry = useGameStore((state) => state.retry);
  const resolve = useGameStore((state) => state.resolve);
  const resetSession = useGameStore((state) => state.resetSession);
  const startLevel = useGameStore((state) => state.startLevel);
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
  const [stitchSelection, setStitchSelection] = useState<{
    readonly levelId: string;
    readonly type: StitchType;
  }>({ levelId: level.id, type: level.allowedStitchTypes[0] });
  const activeStitchType =
    stitchSelection.levelId === level.id &&
    level.allowedStitchTypes.includes(stitchSelection.type)
      ? stitchSelection.type
    : level.allowedStitchTypes[0];
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

  const route = useMemo(
    () => simulateRoute(level, stitches),
    [level, stitches],
  );
  const displayWorld = useMemo(
    () =>
      createLevelWorld(
        level,
        preview ? [...stitches, preview] : stitches,
      ),
    [level, preview, stitches],
  );

  useEffect(() => {
    if (isDaily && !validDailyChallenge) {
      navigation.replace('DailyScrap');
      return;
    }
    if (levelAccess.openPaywall) {
      navigation.replace('Paywall', { levelId: level.id });
      return;
    }

    if (!levelAccess.canPlay) {
      navigation.replace('QuiltMap');
    }
  }, [
    isDaily,
    level.id,
    levelAccess.canPlay,
    levelAccess.openPaywall,
    navigation,
    validDailyChallenge,
  ]);

  useEffect(() => {
    const sessionMatches = isDaily
      ? activeSession.kind === 'daily' &&
        activeSession.challenge.id === validDailyChallenge?.id
      : activeSession.kind === 'campaign';
    if (levelAccess.canPlay && (activeLevelId !== level.id || !sessionMatches)) {
      if (validDailyChallenge) {
        startLevel(level.id, { kind: 'daily', challenge: validDailyChallenge });
      } else {
        startLevel(level.id);
      }
    }
  }, [
    activeLevelId,
    activeSession,
    isDaily,
    level.id,
    levelAccess.canPlay,
    startLevel,
    validDailyChallenge,
  ]);

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
    level,
    // A guarded deep link must not inherit and advance a different level's
    // running session while navigation redirects it away.
    phase: levelAccess.canPlay ? phase : 'planning',
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
      setDraft(createStitch('preview', activeStitchType, start, start));
      void feedback.play('fabricTouch');
      void feedback.play('threadDraw');
    },
    [activeStitchType, feedback, setDraft],
  );

  const updateDrag = useCallback(
    (startX: number, startY: number, endX: number, endY: number) => {
      const start = { x: startX, y: startY };
      const end = { x: endX, y: endY };
      const next = createStitch('preview', activeStitchType, start, end);
      setDraft(next);
    },
    [activeStitchType, setDraft],
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
      const stitch = createValidStitch(
        `stitch-${stitchNumber}`,
        activeStitchType,
        start,
        end,
      );
      if (!stitch) return;
      const committed = commitStitch(stitch, {
        maxStitches: level.maxStitches,
        threadBudget: level.threadBudget,
      });
      if (committed) {
        void feedback.play('stitchComplete');
      }
    },
    [activeStitchType, commitStitch, feedback, level, setDraft, stitches],
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
        level.fabricBounds,
      );
      const stitch = findStitchNearPoint(stitches, point);
      if (stitch) {
        removeStitch(stitch.id);
        void feedback.play('buttonClick');
      }
    },
    [canvasSize, feedback, level.fabricBounds, phase, removeStitch, stitches],
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
          level.fabricBounds.x +
          Math.max(0, Math.min(1, viewStartX / canvasSize.width)) *
            level.fabricBounds.width;
        gestureStartY.value =
          level.fabricBounds.y +
          Math.max(0, Math.min(1, viewStartY / canvasSize.height)) *
            level.fabricBounds.height;
        gestureThreadTick.value = 0;
        runOnJS(beginDrag)(gestureStartX.value, gestureStartY.value);
      })
      .onUpdate((event) => {
        const endX =
          level.fabricBounds.x +
          Math.max(0, Math.min(1, event.x / canvasSize.width)) *
            level.fabricBounds.width;
        const endY =
          level.fabricBounds.y +
          Math.max(0, Math.min(1, event.y / canvasSize.height)) *
            level.fabricBounds.height;
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
          level.fabricBounds.x +
          Math.max(0, Math.min(1, event.x / canvasSize.width)) *
            level.fabricBounds.width;
        const endY =
          level.fabricBounds.y +
          Math.max(0, Math.min(1, event.y / canvasSize.height)) *
            level.fabricBounds.height;
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
    level.fabricBounds,
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
    if (!isDaily && route.outcome.status === 'success' && !tutorial.completed) {
      dispatchTutorial({ type: 'released' });
      completeTutorial(CURRENT_TUTORIAL_VERSION);
    }
    void feedback.play('travelerRelease');
    void feedback.play('travelerRoll');
    release();
  }, [
    completeTutorial,
    feedback,
    isDaily,
    release,
    route.outcome.status,
    setDraft,
    tutorial,
  ]);

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

  const handleOpenMap = useCallback(() => {
    resetSession();
    void feedback.play('buttonClick');
    navigation.popTo(isDaily ? 'DailyScrap' : 'QuiltMap');
  }, [feedback, isDaily, navigation, resetSession]);

  const handleResults = useCallback(() => {
    void feedback.play('buttonClick');
    navigation.navigate('Results');
  }, [feedback, navigation]);

  const previewThread = preview?.threadCost ?? 0;
  const displayedThread = Math.min(
    level.threadBudget,
    threadUsed + previewThread,
  );
  const status = statusCopy(
    phase,
    stitches.length,
    route.outcome.status === 'success',
    activeStitchType,
  );
  const showTutorial =
    !isDaily &&
    level.id === SPIKE_LEVEL.id &&
    phase === 'planning' &&
    tutorialHintsEnabled &&
    completedTutorialVersion < CURRENT_TUTORIAL_VERSION &&
    !tutorial.completed;

  if (!levelAccess.canPlay) {
    return (
      <SafeAreaView
        testID="level-access-guard"
        style={styles.accessGuard}
        edges={['top', 'bottom']}
      >
        <Text style={styles.accessGuardText}>
          {levelAccess.openPaywall
            ? 'Opening Full Atelier…'
            : isDaily
              ? 'Returning to Daily Scrap…'
              : 'Returning to the quilt map…'}
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      testID={isDaily ? 'daily-level-screen' : 'spike-level-screen'}
      style={[styles.screen, highContrast && styles.screenHighContrast]}
      edges={['top', 'bottom']}
    >
      <View style={[styles.header, compactViewport && styles.headerCompact]}>
        <Pressable
          testID="game-map-button"
          accessibilityRole="button"
          accessibilityLabel={isDaily ? 'Return to Daily Scrap' : 'Return to quilt map'}
          accessibilityState={{ disabled: phase === 'running' }}
          disabled={phase === 'running'}
          onPress={handleOpenMap}
          style={({ pressed }) => [
            styles.settingsButton,
            highContrast && styles.outlineHighContrast,
            phase === 'running' && styles.settingsButtonDisabled,
            pressed && phase !== 'running' && styles.settingsButtonPressed,
          ]}
        >
          <Ionicons
            name={isDaily ? 'calendar-outline' : 'map-outline'}
            size={23}
            color="#173746"
          />
        </Pressable>
        <View
          style={[
            styles.titlePlaque,
            highContrast && styles.outlineHighContrast,
          ]}
        >
          <Text style={[styles.title, compactViewport && styles.titleCompact]}>
            {validDailyChallenge?.title ?? level.name}
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

      {level.allowedStitchTypes.length > 1 ? (
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel="Stitch type"
          style={styles.stitchTypeRow}
        >
          {level.allowedStitchTypes.map((stitchType) => {
            const selected = stitchType === activeStitchType;
            return (
              <Pressable
                key={stitchType}
                testID={`stitch-type-${stitchType}`}
                accessibilityRole="radio"
                accessibilityLabel={`${stitchType} stitch`}
                accessibilityState={{
                  selected,
                  disabled: phase !== 'planning',
                }}
                disabled={phase !== 'planning'}
                onPress={() => {
                  setPreview(null);
                  setStitchSelection({ levelId: level.id, type: stitchType });
                  void feedback.play('buttonClick');
                }}
                style={({ pressed }) => [
                  styles.stitchTypeButton,
                  selected && styles.stitchTypeButtonSelected,
                  phase !== 'planning' && styles.settingsButtonDisabled,
                  pressed && styles.settingsButtonPressed,
                ]}
              >
                <Ionicons
                  name={
                    stitchType === 'pocket'
                      ? 'ellipse-outline'
                      : 'git-commit-outline'
                  }
                  size={17}
                  color={selected ? '#f8ead0' : '#173746'}
                />
                <Text
                  style={[
                    styles.stitchTypeLabel,
                    selected && styles.stitchTypeLabelSelected,
                  ]}
                >
                  {stitchType.toUpperCase()}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <View style={[styles.hudRow, compactViewport && styles.hudRowCompact]}>
        <View
          style={[styles.hudPill, highContrast && styles.outlineHighContrast]}
        >
          <Text testID="stitch-count" style={styles.hudValue}>
            {stitches.length} / {level.maxStitches}
          </Text>
          <Text style={styles.hudLabel}>STITCHES</Text>
        </View>
        <View
          style={[styles.hudPill, highContrast && styles.outlineHighContrast]}
        >
          <Text style={styles.hudValue}>
            {displayedThread} / {level.threadBudget}
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
              level={level}
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
  accessGuard: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#162f3a',
    padding: spacing.lg,
  },
  accessGuardText: {
    color: colors.textOnDark,
    fontFamily: 'NunitoSans_700Bold',
    fontSize: 16,
    textAlign: 'center',
  },
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
  stitchTypeRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xs,
  },
  stitchTypeButton: {
    minWidth: 112,
    minHeight: touchTargets.comfortable,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderRadius: radii.md,
    borderWidth: 2,
    borderColor: '#b49369',
    backgroundColor: '#eeddbd',
  },
  stitchTypeButtonSelected: {
    borderColor: '#d88474',
    backgroundColor: '#8d3f48',
  },
  stitchTypeLabel: {
    color: '#173746',
    fontFamily: 'NunitoSans_800ExtraBold',
    fontSize: 11,
    letterSpacing: 0.7,
  },
  stitchTypeLabelSelected: { color: '#f8ead0' },
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
