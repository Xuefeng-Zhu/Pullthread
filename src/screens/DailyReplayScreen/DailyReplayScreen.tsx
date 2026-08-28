import Ionicons from '@expo/vector-icons/Ionicons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { RootStackParamList } from '../../app/navigation/RootNavigator';
import { useEffectiveReducedMotion } from '../../accessibility/useEffectiveReducedMotion';
import type { SimulationOutcome, SimulationPhase } from '../../game/core/types';
import { ReplayStage, type ReplayStatus } from '../ResultsScreen/ReplayStage';
import { useDailyChallengeStore } from '../../store/useDailyChallengeStore';
import { usePreferencesStore } from '../../store/usePreferencesStore';
import { colors, radii, shadows, spacing, touchTargets } from '../../theme/tokens';

type DailyReplayScreenProps = NativeStackScreenProps<
  RootStackParamList,
  'DailyReplay'
>;

export function DailyReplayScreen({ navigation, route }: DailyReplayScreenProps) {
  const entry = useDailyChallengeStore((state) =>
    state.challenge?.id === route.params.challengeId
      ? state.leaderboard.find((candidate) => candidate.id === route.params.entryId)
      : undefined,
  );
  const personalBest = useDailyChallengeStore((state) =>
    state.challenge?.id === route.params.challengeId &&
    state.personalBest?.clientRunId === route.params.entryId
      ? state.personalBest
      : null,
  );
  const replay = entry?.replay ?? personalBest?.replay ?? null;
  const highContrast = usePreferencesStore((state) => state.highContrastEnabled);
  const reducedMotion = useEffectiveReducedMotion();
  const [phase, setPhase] = useState<SimulationPhase>(
    reducedMotion ? 'succeeded' : 'running',
  );
  const [status, setStatus] = useState<ReplayStatus>(
    reducedMotion ? 'complete' : 'playing',
  );
  const reducedMotionCompletion = reducedMotion && status === 'playing';
  const visiblePhase = reducedMotionCompletion ? 'succeeded' : phase;
  const visibleStatus = reducedMotionCompletion ? 'complete' : status;

  useEffect(() => {
    if (!reducedMotionCompletion) return;

    const settleTimer = setTimeout(() => {
      setPhase('succeeded');
      setStatus('complete');
    }, 0);

    return () => clearTimeout(settleTimer);
  }, [reducedMotionCompletion]);

  const handleOutcome = useCallback((outcome: SimulationOutcome) => {
    setPhase(outcome.status === 'success' ? 'succeeded' : 'failed');
    setStatus('complete');
  }, []);

  return (
    <SafeAreaView
      testID="daily-replay-screen"
      edges={['top', 'bottom']}
      style={styles.screen}
    >
      <View style={styles.content}>
        <View style={styles.header}>
          <Pressable
            testID="daily-replay-back-button"
            accessibilityRole="button"
            accessibilityLabel="Back to Daily Scrap"
            onPress={() => navigation.goBack()}
            style={styles.backButton}
          >
            <Ionicons name="arrow-back" size={23} color="#173746" />
          </Pressable>
          <Text accessibilityRole="header" style={styles.title}>
            {entry
              ? `${entry.displayName} · #${entry.rank}`
              : personalBest
                ? 'Your best'
                : 'Replay unavailable'}
          </Text>
        </View>
        {replay ? (
          <ReplayStage
            replay={replay.levelReplay}
            highContrast={highContrast}
            phase={visiblePhase}
            status={visibleStatus}
            onOutcome={handleOutcome}
          />
        ) : (
          <View accessibilityRole="alert" style={styles.missing}>
            <Text style={styles.missingTitle}>Replay unavailable</Text>
            <Text style={styles.missingCopy}>
              This compact stitch replay could not be loaded safely.
            </Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#162F3A' },
  content: {
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    gap: spacing.md,
    padding: spacing.md,
  },
  header: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.sm,
    borderRadius: radii.lg,
    backgroundColor: '#F2E2C5',
    ...shadows.soft,
  },
  backButton: {
    width: touchTargets.minimum,
    height: touchTargets.minimum,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    backgroundColor: '#FFF9EA',
  },
  title: {
    flex: 1,
    color: colors.textPrimary,
    fontFamily: 'Fraunces_700Bold',
    fontSize: 22,
  },
  missing: {
    gap: spacing.sm,
    padding: spacing.xl,
    borderRadius: radii.lg,
    backgroundColor: '#F8EDDA',
  },
  missingTitle: {
    color: colors.textPrimary,
    fontFamily: 'NunitoSans_800ExtraBold',
    fontSize: 18,
  },
  missingCopy: {
    color: '#604B45',
    fontFamily: 'NunitoSans_600SemiBold',
    fontSize: 14,
  },
});
