import Ionicons from '@expo/vector-icons/Ionicons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useEffectiveReducedMotion } from '../../accessibility/useEffectiveReducedMotion';
import type { RootStackParamList } from '../../app/navigation/RootNavigator';
import type { SimulationOutcome, SimulationPhase } from '../../game/core/types';
import { utcChallengeDate } from '../../game/daily';
import { getCampaignLevelAccess } from '../../game/levels/campaignAccess';
import {
  getLevelVersion,
  getNextCampaignLevel,
} from '../../game/levels/levelLoader';
import { useCampaignProgressStore } from '../../store/useCampaignProgressStore';
import { useDailyChallengeStore } from '../../store/useDailyChallengeStore';
import {
  selectHasFullGame,
  useEntitlementStore,
} from '../../store/useEntitlementStore';
import { useGameStore } from '../../store/useGameStore';
import { usePreferencesStore } from '../../store/usePreferencesStore';
import {
  colors,
  highContrastColors,
  opacity,
  radii,
  shadows,
  spacing,
  touchTargets,
} from '../../theme/tokens';
import { ReplayStage, type ReplayStatus } from './ReplayStage';

export interface ResultsScreenProps {
  readonly navigation: Pick<
    NativeStackNavigationProp<RootStackParamList, 'Results'>,
    'navigate' | 'popTo'
  >;
}

interface StatTileProps {
  readonly label: string;
  readonly value: string;
  readonly testID: string;
  readonly highContrast: boolean;
}

function StatTile({
  label,
  value,
  testID,
  highContrast,
}: StatTileProps) {
  return (
    <View
      style={[
        styles.statTile,
        highContrast && styles.highContrastBorder,
      ]}
    >
      <Text style={styles.statLabel}>{label}</Text>
      <Text testID={testID} style={styles.statValue}>
        {value}
      </Text>
    </View>
  );
}

export function ResultsScreen({ navigation }: ResultsScreenProps) {
  const completedRun = useGameStore((state) => state.completedRun);
  const isDaily = completedRun?.session?.kind === 'daily';
  const dailySubmitStatus = useDailyChallengeStore((state) => state.submitStatus);
  const dailyStatusMessage = useDailyChallengeStore((state) => state.statusMessage);
  const dailyErrorMessage = useDailyChallengeStore((state) => state.errorMessage);
  const dailyPersonalBest = useDailyChallengeStore((state) => state.personalBest);
  const dailyLatestSubmission = useDailyChallengeStore(
    (state) => state.latestSubmission,
  );
  const activeLevelId = useGameStore((state) => state.activeLevelId);
  const startLevel = useGameStore((state) => state.startLevel);
  const resetSession = useGameStore((state) => state.resetSession);
  const progressByLevel = useCampaignProgressStore(
    (state) => state.progressByLevel,
  );
  const hasFullGame = useEntitlementStore(selectHasFullGame);
  const highContrast = usePreferencesStore(
    (state) => state.highContrastEnabled,
  );
  const reducedMotion = useEffectiveReducedMotion();
  const [replayStatus, setReplayStatus] = useState<ReplayStatus>('ready');
  const [replayPhase, setReplayPhase] =
    useState<SimulationPhase>('succeeded');
  const tighteningTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const replayBusy =
    replayStatus === 'tightening' || replayStatus === 'playing';
  const reducedMotionCompletion = reducedMotion && replayBusy;
  const visibleReplayStatus = reducedMotionCompletion
    ? 'complete'
    : replayStatus;
  const visibleReplayPhase = reducedMotionCompletion
    ? 'succeeded'
    : replayPhase;
  const replayControlsLocked = replayBusy && !reducedMotionCompletion;

  useEffect(
    () => () => {
      if (tighteningTimer.current) clearTimeout(tighteningTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!reducedMotionCompletion) return;

    if (tighteningTimer.current) {
      clearTimeout(tighteningTimer.current);
      tighteningTimer.current = null;
    }
    const settleTimer = setTimeout(() => {
      setReplayPhase('succeeded');
      setReplayStatus('complete');
    }, 0);

    return () => clearTimeout(settleTimer);
  }, [reducedMotionCompletion]);

  const handleTryAgain = useCallback(() => {
    const levelId = completedRun?.levelId ?? activeLevelId;
    if (completedRun?.session?.kind === 'daily') {
      const challenge = completedRun.session.challenge;
      if (challenge.challengeDate !== utcChallengeDate(new Date())) {
        resetSession();
        navigation.popTo('DailyScrap');
        return;
      }
      startLevel(levelId, completedRun.session);
      navigation.popTo('SpikeLevel', {
        levelId,
        mode: 'daily',
        challengeId: challenge.id,
      });
      return;
    }
    const access = getCampaignLevelAccess(
      levelId,
      progressByLevel,
      hasFullGame,
    );
    if (access.openPaywall) {
      navigation.navigate('Paywall', { levelId });
      return;
    }
    if (!access.canPlay) {
      resetSession();
      navigation.popTo('QuiltMap');
      return;
    }
    startLevel(levelId);
    navigation.popTo('SpikeLevel', { levelId });
  }, [
    activeLevelId,
    completedRun,
    hasFullGame,
    navigation,
    progressByLevel,
    resetSession,
    startLevel,
  ]);

  const handleMap = useCallback(() => {
    resetSession();
    navigation.popTo(isDaily ? 'DailyScrap' : 'QuiltMap');
  }, [isDaily, navigation, resetSession]);

  const handleNextLevel = useCallback(() => {
    if (!completedRun) return;
    const nextLevel = getNextCampaignLevel(completedRun.levelId);
    if (!nextLevel) {
      handleMap();
      return;
    }
    const access = getCampaignLevelAccess(
      nextLevel.id,
      progressByLevel,
      hasFullGame,
    );
    if (access.openPaywall) {
      navigation.navigate('Paywall', { levelId: nextLevel.id });
      return;
    }
    if (!access.canPlay) {
      handleMap();
      return;
    }
    startLevel(nextLevel.id);
    navigation.popTo('SpikeLevel', { levelId: nextLevel.id });
  }, [
    completedRun,
    handleMap,
    hasFullGame,
    navigation,
    progressByLevel,
    startLevel,
  ]);

  const handleSettings = useCallback(() => {
    navigation.navigate('Settings');
  }, [navigation]);

  const handleWatchReplay = useCallback(() => {
    if (reducedMotion) {
      setReplayPhase('succeeded');
      setReplayStatus('complete');
      return;
    }

    setReplayPhase('planning');
    setReplayStatus('tightening');
    if (tighteningTimer.current) clearTimeout(tighteningTimer.current);
    tighteningTimer.current = setTimeout(() => {
      tighteningTimer.current = null;
      setReplayPhase('running');
      setReplayStatus('playing');
    }, 620);
  }, [reducedMotion]);

  const handleReplayOutcome = useCallback((outcome: SimulationOutcome) => {
    setReplayPhase(outcome.status === 'success' ? 'succeeded' : 'failed');
    setReplayStatus('complete');
  }, []);

  if (!completedRun) {
    return (
      <SafeAreaView
        testID="results-screen"
        edges={['top', 'bottom']}
        style={styles.screen}
      >
        <View style={styles.missingRun}>
          <Text accessibilityRole="header" style={styles.title}>
            No completed pull
          </Text>
          <Text style={styles.subtitle}>
            Finish First Pull to prepare a replay.
          </Text>
          <Pressable
            testID="try-again-button"
            accessibilityRole="button"
            accessibilityLabel="Return to First Pull"
            onPress={handleTryAgain}
            style={({ pressed }) => [
              styles.secondaryButton,
              pressed && styles.secondaryPressed,
            ]}
          >
            <Text style={styles.secondaryLabel}>TRY AGAIN</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const threadUsed = completedRun.replay.stitches.reduce(
    (total, stitch) => total + stitch.threadCost,
    0,
  );
  const level = getLevelVersion(
    completedRun.levelId,
    completedRun.replay.levelVersion,
  );
  const nextLevel = isDaily ? null : getNextCampaignLevel(level.id);
  const activeDailySubmission =
    completedRun.session?.kind === 'daily' &&
    dailyLatestSubmission?.personalBest.challengeId ===
      completedRun.session.challenge.id
      ? dailyLatestSubmission
      : null;
  const resultIsNewBest = activeDailySubmission
    ? activeDailySubmission.isNewBest
    : completedRun.isNewBest;
  const resultBestMetrics =
    completedRun.session?.kind === 'daily' &&
    dailyPersonalBest?.challengeId === completedRun.session.challenge.id
      ? dailyPersonalBest.metrics
      : completedRun.bestMetrics;
  const availableThimbles = level.collectible ? 3 : 2;
  const timeSeconds = `${(completedRun.outcome.completionMs / 1000).toFixed(1)}s`;
  return (
    <SafeAreaView
      testID="results-screen"
      edges={['top', 'bottom']}
      style={styles.screen}
    >
      <ScrollView
        alwaysBounceVertical={false}
        contentContainerStyle={styles.content}
      >
        <View
          style={[
            styles.titlePlaque,
            highContrast && styles.highContrastBorder,
          ]}
        >
          <Ionicons name="flower-outline" size={22} color="#a93238" />
          <Text accessibilityRole="header" style={styles.title}>
            {isDaily ? 'Scrap complete!' : 'Perfect pull!'}
          </Text>
          <Ionicons name="flower-outline" size={22} color="#a93238" />
        </View>
        <Text style={styles.subtitle}>
          {isDaily
            ? dailySubmitStatus === 'error'
              ? 'The pull finished, but its result could not be saved.'
              : dailySubmitStatus === 'volatile'
                ? 'The pull finished, but it is kept only for this session.'
                : dailyLatestSubmission?.syncStatus === 'expired'
                  ? 'The pull finished after its shared-board window closed.'
                : `${completedRun.session?.kind === 'daily' ? completedRun.session.challenge.title : level.name} is recorded for today.`
            : `${level.name} is sewn into the quilt.`}
        </Text>

        <ReplayStage
          replay={completedRun.replay}
          highContrast={highContrast}
          phase={visibleReplayPhase}
          status={visibleReplayStatus}
          onOutcome={handleReplayOutcome}
        />

        <View style={styles.statsRow}>
          <StatTile
            testID="thread-result"
            label="THREAD"
            value={`${threadUsed} / ${level.threadBudget}`}
            highContrast={highContrast}
          />
          <StatTile
            testID="stitches-result"
            label="STITCHES"
            value={`${completedRun.replay.stitches.length} / ${level.maxStitches}`}
            highContrast={highContrast}
          />
          <StatTile
            testID="time-result"
            label="TIME"
            value={timeSeconds}
            highContrast={highContrast}
          />
        </View>

        {!isDaily ? <View style={styles.rewardRow}>
          <View
            testID="results-thimbles"
            accessibilityLabel={`${completedRun.scoredRun.thimbles} of ${availableThimbles} thimbles earned`}
            style={styles.rewardPill}
          >
            <Ionicons name="medal" size={18} color="#664917" />
            <Text style={styles.rewardText}>
              {completedRun.scoredRun.thimbles} / {availableThimbles} THIMBLES
            </Text>
          </View>
          {level.collectible ? (
            <View testID="results-patch" style={styles.rewardPill}>
              <Ionicons
                name={
                  completedRun.scoredRun.metrics.collectedPatch
                    ? 'sparkles'
                    : 'ellipse-outline'
                }
                size={17}
                color="#664917"
              />
              <Text style={styles.rewardText}>
                {completedRun.scoredRun.metrics.collectedPatch
                  ? 'PATCH FOUND'
                  : 'PATCH MISSED'}
              </Text>
            </View>
          ) : null}
        </View> : null}

        {isDaily ? (
          <View
            testID="daily-run-submit-status"
            accessibilityLiveRegion="polite"
            style={styles.dailyStatus}
          >
            <Ionicons
              name={
                dailySubmitStatus === 'saving'
                  ? 'cloud-upload-outline'
                  : dailySubmitStatus === 'error' ||
                      dailySubmitStatus === 'volatile'
                    ? 'alert-circle-outline'
                    : 'checkmark-circle-outline'
              }
              size={18}
              color="#4F3B24"
            />
            <Text style={styles.dailyStatusText}>
              {dailySubmitStatus === 'saving'
                ? 'Saving on this device…'
                : dailySubmitStatus === 'error'
                  ? dailyErrorMessage ?? 'This pull could not be saved.'
                  : dailyStatusMessage}
            </Text>
          </View>
        ) : null}

        <View
          style={[
            styles.bestBadge,
            highContrast && styles.highContrastBestBadge,
          ]}
        >
          <Ionicons name="ribbon-outline" size={17} color="#4f3b24" />
          <Text style={styles.bestText}>
            {resultIsNewBest
              ? 'NEW BEST'
              : `BEST ${resultBestMetrics.threadUsed} THREAD`}
          </Text>
        </View>

        <Pressable
          testID="watch-replay-button"
          accessibilityRole="button"
          accessibilityLabel="Watch deterministic replay"
          accessibilityState={{ disabled: replayControlsLocked }}
          disabled={replayControlsLocked}
          onPress={handleWatchReplay}
          style={({ pressed }) => [
            styles.primaryButton,
            replayControlsLocked && styles.primaryDisabled,
            pressed && !replayControlsLocked && styles.primaryPressed,
          ]}
        >
          <Ionicons name="play" size={22} color={colors.textOnDark} />
          <Text style={styles.primaryLabel}>WATCH REPLAY</Text>
        </Pressable>

        {nextLevel ? (
          <Pressable
            testID="next-level-button"
            accessibilityRole="button"
            accessibilityLabel={`Play next level, ${nextLevel.name}`}
            accessibilityState={{ disabled: replayControlsLocked }}
            disabled={replayControlsLocked}
            onPress={handleNextLevel}
            style={({ pressed }) => [
              styles.primaryButton,
              styles.nextButton,
              replayControlsLocked && styles.primaryDisabled,
              pressed && !replayControlsLocked && styles.primaryPressed,
            ]}
          >
            <Text style={styles.primaryLabel}>NEXT LEVEL</Text>
            <Ionicons name="arrow-forward" size={22} color={colors.textOnDark} />
          </Pressable>
        ) : null}

        <View style={styles.bottomActions}>
          <Pressable
            testID="results-map-button"
            accessibilityRole="button"
            accessibilityLabel={isDaily ? 'Return to Daily Scrap' : 'Return to quilt map'}
            accessibilityState={{ disabled: replayControlsLocked }}
            disabled={replayControlsLocked}
            onPress={handleMap}
            style={({ pressed }) => [
              styles.settingsButton,
              replayControlsLocked && styles.primaryDisabled,
              pressed && !replayControlsLocked && styles.secondaryPressed,
            ]}
          >
            <Ionicons
              name={isDaily ? 'calendar' : 'map'}
              size={27}
              color="#173746"
            />
          </Pressable>
          <Pressable
            testID="try-again-button"
            accessibilityRole="button"
            accessibilityLabel={`Reset and try ${level.name} again`}
            onPress={handleTryAgain}
            style={({ pressed }) => [
              styles.secondaryButton,
              pressed && styles.secondaryPressed,
            ]}
          >
            <Text style={styles.secondaryLabel}>TRY AGAIN</Text>
          </Pressable>
          <Pressable
            testID="results-settings-button"
            accessibilityRole="button"
            accessibilityLabel="Open settings"
            accessibilityState={{ disabled: replayControlsLocked }}
            disabled={replayControlsLocked}
            onPress={handleSettings}
            style={({ pressed }) => [
              styles.settingsButton,
              replayControlsLocked && styles.primaryDisabled,
              pressed && !replayControlsLocked && styles.secondaryPressed,
            ]}
          >
            <Ionicons name="settings" size={27} color="#173746" />
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#162f3a',
  },
  content: {
    flexGrow: 1,
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  titlePlaque: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 2,
    borderColor: '#c8a979',
    backgroundColor: '#f2e2c5',
    ...shadows.soft,
  },
  title: {
    color: colors.textPrimary,
    fontFamily: 'Fraunces_700Bold',
    fontSize: 28,
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  subtitle: {
    color: '#f3e5ca',
    fontFamily: 'NunitoSans_600SemiBold',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  statsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  statTile: {
    minHeight: 62,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
    borderRadius: radii.md,
    borderWidth: 2,
    borderColor: '#b49369',
    backgroundColor: '#eeddbd',
    ...shadows.soft,
  },
  statLabel: {
    color: '#634b40',
    fontFamily: 'NunitoSans_800ExtraBold',
    fontSize: 10,
    letterSpacing: 0.7,
  },
  statValue: {
    marginTop: 1,
    color: '#173746',
    fontFamily: 'NunitoSans_800ExtraBold',
    fontSize: 16,
  },
  bestBadge: {
    minHeight: 34,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.pill,
    borderWidth: 2,
    borderColor: '#8b6828',
    backgroundColor: '#d8a938',
  },
  bestText: {
    color: '#34272a',
    fontFamily: 'NunitoSans_800ExtraBold',
    fontSize: 12,
    letterSpacing: 0.8,
  },
  rewardRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  rewardPill: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 2,
    borderColor: '#8b6828',
    backgroundColor: '#f0d783',
  },
  rewardText: {
    color: '#493816',
    fontFamily: 'NunitoSans_800ExtraBold',
    fontSize: 11,
    letterSpacing: 0.6,
  },
  dailyStatus: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 2,
    borderColor: '#B49369',
    backgroundColor: '#F2E2C5',
  },
  dailyStatusText: {
    flex: 1,
    color: '#4F3B24',
    fontFamily: 'NunitoSans_700Bold',
    fontSize: 12,
    lineHeight: 17,
  },
  primaryButton: {
    minHeight: touchTargets.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radii.lg,
    borderWidth: 3,
    borderColor: '#d88474',
    backgroundColor: '#a93238',
    ...shadows.raised,
  },
  primaryPressed: {
    transform: [{ translateY: 2 }],
    backgroundColor: '#8d2930',
  },
  primaryDisabled: {
    opacity: opacity.disabled,
  },
  primaryLabel: {
    color: colors.textOnDark,
    fontFamily: 'NunitoSans_800ExtraBold',
    fontSize: 18,
    letterSpacing: 0.8,
  },
  nextButton: { backgroundColor: '#356e61', borderColor: '#79aa92' },
  bottomActions: {
    minHeight: touchTargets.primary,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  secondaryButton: {
    minHeight: touchTargets.primary,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radii.lg,
    borderWidth: 2,
    borderColor: '#b49369',
    backgroundColor: '#f2e2c5',
    ...shadows.soft,
  },
  secondaryPressed: {
    transform: [{ translateY: 2 }],
    backgroundColor: '#e6d2ac',
  },
  secondaryLabel: {
    color: '#173746',
    fontFamily: 'NunitoSans_800ExtraBold',
    fontSize: 16,
    letterSpacing: 0.7,
  },
  settingsButton: {
    width: touchTargets.primary,
    minHeight: touchTargets.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    borderWidth: 2,
    borderColor: '#b49369',
    backgroundColor: '#f2e2c5',
    ...shadows.soft,
  },
  highContrastBorder: {
    borderColor: highContrastColors.fabricOutline,
    borderWidth: 3,
  },
  highContrastBestBadge: {
    borderColor: '#34272a',
    borderWidth: 3,
  },
  missingRun: {
    flex: 1,
    alignItems: 'stretch',
    justifyContent: 'center',
    gap: spacing.lg,
    padding: spacing.xl,
  },
});
