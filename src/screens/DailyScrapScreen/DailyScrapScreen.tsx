import Ionicons from '@expo/vector-icons/Ionicons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { RootStackParamList } from '../../app/navigation/RootNavigator';
import type { RunMetrics } from '../../game/core/scoring';
import { useDailyChallengeStore } from '../../store/useDailyChallengeStore';
import { useGameStore } from '../../store/useGameStore';
import { colors, radii, shadows, spacing, touchTargets } from '../../theme/tokens';

type DailyScrapScreenProps = NativeStackScreenProps<
  RootStackParamList,
  'DailyScrap'
>;

function formatTime(completionMs: number): string {
  return `${(completionMs / 1000).toFixed(1)}s`;
}

function millisecondsUntilNextUtcDay(now = new Date()): number {
  const nextUtcDay = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  );
  // Cross the boundary before asking the service for its canonical UTC day.
  return Math.max(1, nextUtcDay - now.getTime() + 25);
}

function MetricRow({ metrics }: { readonly metrics: RunMetrics }) {
  return (
    <View style={styles.metricsRow}>
      <Text style={styles.metric}>{metrics.threadUsed} thread</Text>
      <Text style={styles.metric}>{metrics.stitchesUsed} stitches</Text>
      <Text style={styles.metric}>{formatTime(metrics.completionMs)}</Text>
    </View>
  );
}

export function DailyScrapScreen({ navigation }: DailyScrapScreenProps) {
  const challenge = useDailyChallengeStore((state) => state.challenge);
  const loadStatus = useDailyChallengeStore((state) => state.loadStatus);
  const boardStatus = useDailyChallengeStore((state) => state.boardStatus);
  const statusMessage = useDailyChallengeStore((state) => state.statusMessage);
  const errorMessage = useDailyChallengeStore((state) => state.errorMessage);
  const leaderboard = useDailyChallengeStore((state) => state.leaderboard);
  const personalBest = useDailyChallengeStore((state) => state.personalBest);
  const latestSubmission = useDailyChallengeStore(
    (state) => state.latestSubmission,
  );
  const loadToday = useDailyChallengeStore((state) => state.loadToday);
  const refreshLeaderboard = useDailyChallengeStore(
    (state) => state.refreshLeaderboard,
  );
  const startLevel = useGameStore((state) => state.startLevel);
  const visibleChallenge = loadStatus === 'ready' ? challenge : null;

  useEffect(() => {
    let focused = true;
    let boundaryTimer: ReturnType<typeof setTimeout> | null = null;

    function clearBoundaryTimer() {
      if (boundaryTimer) clearTimeout(boundaryTimer);
      boundaryTimer = null;
    }

    function scheduleBoundaryReload() {
      clearBoundaryTimer();
      boundaryTimer = setTimeout(() => {
        if (!focused) return;
        void loadToday();
        scheduleBoundaryReload();
      }, millisecondsUntilNextUtcDay());
    }

    function reloadForFocus() {
      focused = true;
      void loadToday();
      scheduleBoundaryReload();
    }

    reloadForFocus();
    const removeFocusListener = navigation.addListener('focus', reloadForFocus);
    const removeBlurListener = navigation.addListener('blur', () => {
      focused = false;
      clearBoundaryTimer();
    });

    return () => {
      focused = false;
      clearBoundaryTimer();
      removeFocusListener();
      removeBlurListener();
    };
  }, [loadToday, navigation]);

  const handlePlay = useCallback(() => {
    if (!visibleChallenge) return;
    startLevel(visibleChallenge.levelId, {
      kind: 'daily',
      challenge: visibleChallenge,
    });
    navigation.navigate('SpikeLevel', {
      levelId: visibleChallenge.levelId,
      mode: 'daily',
      challengeId: visibleChallenge.id,
    });
  }, [navigation, startLevel, visibleChallenge]);

  return (
    <SafeAreaView
      testID="daily-scrap-screen"
      edges={['top', 'bottom']}
      style={styles.screen}
    >
      <ScrollView
        alwaysBounceVertical={false}
        contentContainerStyle={styles.content}
      >
        <View style={styles.header}>
          <Pressable
            testID="daily-scrap-back-button"
            accessibilityRole="button"
            accessibilityLabel="Back to quilt map"
            onPress={() => navigation.goBack()}
            style={({ pressed }) => [
              styles.iconButton,
              pressed && styles.buttonPressed,
            ]}
          >
            <Ionicons name="arrow-back" size={23} color="#173746" />
          </Pressable>
          <View style={styles.headerCopy}>
            <Text accessibilityRole="header" style={styles.title}>
              Daily Scrap
            </Text>
            <Text style={styles.headerSubtitle}>
              One pattern. One day. Unlimited pulls.
            </Text>
          </View>
        </View>

        {loadStatus === 'loading' ? (
          <View
            testID="daily-scrap-loading"
            accessible
            accessibilityLabel="Preparing today’s Daily Scrap"
            accessibilityState={{ busy: true }}
            style={styles.loadingCard}
          >
            <ActivityIndicator color="#A93238" />
            <Text style={styles.bodyCopy}>Preparing today’s scrap…</Text>
          </View>
        ) : null}

        {loadStatus === 'error' ? (
          <View accessibilityRole="alert" style={styles.card}>
            <Text style={styles.cardTitle}>Loose thread</Text>
            <Text style={styles.bodyCopy}>{errorMessage}</Text>
            <Pressable
              testID="daily-scrap-retry-button"
              accessibilityRole="button"
              onPress={() => void loadToday()}
              style={({ pressed }) => [
                styles.secondaryButton,
                pressed && styles.buttonPressed,
              ]}
            >
              <Text style={styles.secondaryLabel}>TRY AGAIN</Text>
            </Pressable>
          </View>
        ) : null}

        {loadStatus === 'update-required' ? (
          <View
            testID="daily-scrap-update-required"
            accessibilityRole="alert"
            style={styles.card}
          >
            <Text style={styles.cardTitle}>New scraps are ready</Text>
            <Text style={styles.bodyCopy}>{errorMessage}</Text>
            <Text style={styles.bodyCopy}>
              Your saved campaign progress stays on this device.
            </Text>
          </View>
        ) : null}

        {visibleChallenge ? (
          <View testID="daily-challenge-card" style={styles.challengeCard}>
            <Text style={styles.eyebrow}>{visibleChallenge.challengeDate} UTC</Text>
            <Text style={styles.challengeTitle}>{visibleChallenge.title}</Text>
            <Text style={styles.bodyCopy}>{visibleChallenge.description}</Text>
            <Text style={styles.resetCopy}>New scrap daily at 00:00 UTC.</Text>
            <Pressable
              testID="daily-scrap-play-button"
              accessibilityRole="button"
              accessibilityLabel={
                personalBest ? 'Try today’s Daily Scrap again' : 'Play today’s Daily Scrap'
              }
              onPress={handlePlay}
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && styles.primaryPressed,
              ]}
            >
              <Ionicons name="play" size={21} color={colors.textOnDark} />
              <Text style={styles.primaryLabel}>
                {personalBest ? 'TRY AGAIN' : 'PLAY TODAY’S SCRAP'}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {visibleChallenge ? (
          <View testID="daily-scrap-personal-best" style={styles.card}>
            <View style={styles.sectionTitleRow}>
              <Ionicons name="ribbon-outline" size={20} color="#8B5C22" />
              <Text style={styles.cardTitle}>Your best</Text>
              {latestSubmission?.isNewBest ? (
                <Text style={styles.newBest}>NEW BEST</Text>
              ) : null}
            </View>
            {personalBest ? (
              <>
                <MetricRow metrics={personalBest.metrics} />
                <Pressable
                  testID="daily-personal-best-replay-button"
                  accessibilityRole="button"
                  accessibilityLabel="Watch your best Daily Scrap replay"
                  onPress={() =>
                    navigation.navigate('DailyReplay', {
                      challengeId: visibleChallenge.id,
                      entryId: personalBest.clientRunId,
                    })
                  }
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    styles.replayButton,
                    pressed && styles.buttonPressed,
                  ]}
                >
                  <Ionicons
                    name="play-circle-outline"
                    size={20}
                    color="#173746"
                  />
                  <Text style={styles.secondaryLabel}>WATCH YOUR REPLAY</Text>
                </Pressable>
              </>
            ) : (
              <Text style={styles.bodyCopy}>
                Complete today’s pattern to set your first result.
              </Text>
            )}
          </View>
        ) : null}

        {visibleChallenge ? (
          <View testID="daily-leaderboard-section" style={styles.card}>
            <View style={styles.sectionTitleRow}>
              <Ionicons name="podium-outline" size={21} color="#A93238" />
              <Text style={styles.cardTitle}>Leaderboard</Text>
              {boardStatus === 'loading' ? (
                <ActivityIndicator
                  testID="daily-leaderboard-loading"
                  size="small"
                  color="#A93238"
                />
              ) : null}
            </View>
            <Text style={styles.legend}>
              Lowest wins: thread, then stitches, then time.
            </Text>
            <Text
              testID="daily-scrap-status"
              accessibilityLiveRegion="polite"
              style={styles.statusCopy}
            >
              {statusMessage}
            </Text>
            {leaderboard.length === 0 && boardStatus !== 'loading' ? (
              <Text testID="daily-leaderboard-empty" style={styles.bodyCopy}>
                {boardStatus === 'offline'
                  ? 'Shared ranks are unavailable while offline.'
                  : 'No finished pulls yet. Yours can be first.'}
              </Text>
            ) : null}
            {leaderboard.map((entry) => (
              <Pressable
                key={entry.id}
                testID={`daily-leaderboard-entry-${entry.id}`}
                accessibilityRole="button"
                accessibilityLabel={`Rank ${entry.rank}, ${entry.displayName}, ${entry.metrics.threadUsed} thread, ${entry.metrics.stitchesUsed} stitches, ${formatTime(entry.metrics.completionMs)}.${entry.replay ? ' Watch replay.' : ' Replay unavailable.'}`}
                accessibilityState={{ disabled: !entry.replay }}
                disabled={!entry.replay}
                onPress={() =>
                  navigation.navigate('DailyReplay', {
                    challengeId: visibleChallenge.id,
                    entryId: entry.id,
                  })
                }
                style={({ pressed }) => [
                  styles.entry,
                  entry.isCurrentPlayer && styles.currentEntry,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={styles.rank}>#{entry.rank}</Text>
                <View style={styles.entryCopy}>
                  <Text style={styles.entryName}>
                    {entry.displayName}{entry.isCurrentPlayer ? ' · YOU' : ''}
                  </Text>
                  <MetricRow metrics={entry.metrics} />
                </View>
                <Ionicons name="play-circle-outline" size={23} color="#173746" />
              </Pressable>
            ))}
            {boardStatus === 'offline' ? (
              <Pressable
                testID="daily-leaderboard-retry-button"
                accessibilityRole="button"
                onPress={() => void refreshLeaderboard()}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={styles.secondaryLabel}>REFRESH BOARD</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 2,
    borderColor: '#C8A979',
    backgroundColor: '#F2E2C5',
    ...shadows.soft,
  },
  headerCopy: { flex: 1 },
  title: {
    color: colors.textPrimary,
    fontFamily: 'Fraunces_700Bold',
    fontSize: 28,
  },
  headerSubtitle: {
    color: '#604B45',
    fontFamily: 'NunitoSans_600SemiBold',
    fontSize: 13,
  },
  iconButton: {
    width: touchTargets.minimum,
    height: touchTargets.minimum,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    backgroundColor: '#FFF9EA',
  },
  loadingCard: {
    minHeight: 100,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radii.lg,
    backgroundColor: '#F8EDDA',
  },
  challengeCard: {
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radii.xl,
    borderWidth: 3,
    borderColor: '#D88474',
    backgroundColor: '#F2E2C5',
    ...shadows.raised,
  },
  card: {
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radii.lg,
    borderWidth: 2,
    borderColor: '#B49369',
    backgroundColor: '#F8EDDA',
    ...shadows.soft,
  },
  eyebrow: {
    color: '#A93238',
    fontFamily: 'NunitoSans_800ExtraBold',
    fontSize: 11,
    letterSpacing: 0.9,
  },
  challengeTitle: {
    color: colors.textPrimary,
    fontFamily: 'Fraunces_700Bold',
    fontSize: 26,
  },
  cardTitle: {
    flex: 1,
    color: colors.textPrimary,
    fontFamily: 'NunitoSans_800ExtraBold',
    fontSize: 18,
  },
  bodyCopy: {
    color: '#604B45',
    fontFamily: 'NunitoSans_600SemiBold',
    fontSize: 14,
    lineHeight: 20,
  },
  resetCopy: {
    color: '#705B5D',
    fontFamily: 'NunitoSans_700Bold',
    fontSize: 12,
  },
  primaryButton: {
    minHeight: touchTargets.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
    borderRadius: radii.lg,
    borderWidth: 3,
    borderColor: '#D88474',
    backgroundColor: '#A93238',
    ...shadows.raised,
  },
  primaryPressed: { transform: [{ translateY: 2 }], backgroundColor: '#8D2930' },
  primaryLabel: {
    color: colors.textOnDark,
    fontFamily: 'NunitoSans_800ExtraBold',
    fontSize: 16,
    letterSpacing: 0.7,
  },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  newBest: {
    color: '#7A251F',
    fontFamily: 'NunitoSans_800ExtraBold',
    fontSize: 11,
  },
  metricsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  metric: {
    color: '#173746',
    fontFamily: 'NunitoSans_800ExtraBold',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  legend: {
    color: '#604B45',
    fontFamily: 'NunitoSans_700Bold',
    fontSize: 12,
  },
  statusCopy: {
    color: '#72531D',
    fontFamily: 'NunitoSans_700Bold',
    fontSize: 12,
    lineHeight: 17,
  },
  entry: {
    minHeight: touchTargets.primary,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 2,
    borderColor: '#CEB899',
    backgroundColor: '#FFF9EA',
  },
  currentEntry: { borderColor: '#A93238', backgroundColor: '#F7E2D5' },
  rank: {
    minWidth: 32,
    color: '#A93238',
    fontFamily: 'NunitoSans_800ExtraBold',
    fontSize: 16,
    fontVariant: ['tabular-nums'],
  },
  entryCopy: { flex: 1, gap: spacing.xxs },
  entryName: {
    color: colors.textPrimary,
    fontFamily: 'NunitoSans_800ExtraBold',
    fontSize: 14,
  },
  secondaryButton: {
    minHeight: touchTargets.minimum,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 2,
    borderColor: '#9D765F',
    backgroundColor: '#FFF9EA',
  },
  replayButton: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  secondaryLabel: {
    color: '#173746',
    fontFamily: 'NunitoSans_800ExtraBold',
    fontSize: 13,
  },
  buttonPressed: { opacity: 0.76 },
});
