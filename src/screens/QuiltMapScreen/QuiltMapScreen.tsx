import Ionicons from '@expo/vector-icons/Ionicons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { RootStackParamList } from '../../app/navigation/RootNavigator';
import {
  getCampaignLevelAccess,
  type CampaignLevelAccess,
  type CampaignLevelAccessState,
} from '../../game/levels/campaignAccess';
import {
  CAMPAIGN_LEVELS,
  CAMPAIGN_QUILTS,
} from '../../game/levels/campaignLevels';
import type {
  LevelDefinition,
  QuiltDefinition,
} from '../../game/levels/schema';
import {
  useCampaignProgressStore,
  type CampaignLevelProgress,
} from '../../store/useCampaignProgressStore';
import {
  selectHasFullGame,
  useEntitlementStore,
} from '../../store/useEntitlementStore';
import { useGameStore } from '../../store/useGameStore';
import {
  colors,
  radii,
  shadows,
  spacing,
  touchTargets,
} from '../../theme/tokens';

export interface QuiltMapScreenProps {
  readonly navigation: Pick<
    NativeStackNavigationProp<RootStackParamList, 'QuiltMap'>,
    'navigate'
  >;
}

interface QuiltTone {
  readonly surface: string;
  readonly border: string;
  readonly accent: string;
  readonly connector: string;
}

const QUILT_TONES: readonly QuiltTone[] = [
  {
    surface: '#EEDDBD',
    border: '#B49369',
    accent: '#A93238',
    connector: '#C39279',
  },
  {
    surface: '#D8D8C0',
    border: '#7B8768',
    accent: '#526947',
    connector: '#87947A',
  },
  {
    surface: '#D6C9D7',
    border: '#876D88',
    accent: '#724D73',
    connector: '#947C96',
  },
] as const;

function isLocked(state: CampaignLevelAccessState): boolean {
  return state === 'sequence-locked' || state === 'premium-locked';
}

function levelStateLabel(state: CampaignLevelAccessState): string {
  if (state === 'premium-locked') return 'ATELIER LOCKED';
  if (state === 'sequence-locked') return 'LOCKED';
  return state.toUpperCase();
}

function patchLabel(
  level: LevelDefinition,
  state: CampaignLevelAccessState,
  progress?: CampaignLevelProgress,
): string | null {
  if (!level.collectible) return null;
  if (progress?.bestRun.metrics.collectedPatch) return 'PATCH FOUND';
  if (isLocked(state)) return 'PATCH LOCKED';
  return 'PATCH NOT FOUND';
}

function levelAccessibilityLabel(
  level: LevelDefinition,
  state: CampaignLevelAccessState,
  progress?: CampaignLevelProgress,
): string {
  const status =
    state === 'completed'
      ? `completed with ${progress?.bestRun.thimbles ?? 0} of ${
          level.collectible ? 3 : 2
        } thimbles`
      : state === 'current'
        ? 'current level'
        : state === 'premium-locked'
          ? 'Full Atelier locked, opens the one-time unlock paywall'
          : 'locked, complete the previous level to unlock';
  const patch = patchLabel(level, state, progress);
  return `Level ${level.order}, ${level.name}, ${status}${
    patch ? `, ${patch.toLowerCase()}` : ''
  }`;
}

interface LevelNodeProps {
  readonly level: LevelDefinition;
  readonly access: CampaignLevelAccess;
  readonly progress?: CampaignLevelProgress;
  readonly tone: QuiltTone;
  readonly alignRight: boolean;
  readonly onPress: () => void;
}

function LevelNode({
  level,
  access,
  progress,
  tone,
  alignRight,
  onPress,
}: LevelNodeProps) {
  const { state } = access;
  const locked = isLocked(state);
  const disabled = !access.canPlay && !access.openPaywall;
  const thimbles = progress?.bestRun.thimbles ?? 0;
  const availableThimbles = level.collectible ? 3 : 2;
  const collectibleStatus = patchLabel(level, state, progress);

  return (
    <Pressable
      testID={`level-node-${level.id}`}
      accessibilityRole="button"
      accessibilityLabel={levelAccessibilityLabel(level, state, progress)}
      accessibilityHint={
        state === 'premium-locked'
          ? 'Opens the Full Atelier one-time unlock.'
          : state === 'sequence-locked'
            ? 'Complete the previous level to unlock.'
            : 'Opens this level.'
      }
      accessibilityState={{ disabled, selected: state === 'current' }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.levelNode,
        alignRight ? styles.levelNodeRight : styles.levelNodeLeft,
        state === 'completed' && styles.levelNodeCompleted,
        state === 'current' && [
          styles.levelNodeCurrent,
          { borderColor: tone.accent },
        ],
        locked && styles.levelNodeLocked,
        state === 'premium-locked' && styles.levelNodePremiumLocked,
        pressed && !disabled && styles.levelNodePressed,
      ]}
    >
      <View
        style={[
          styles.levelNumber,
          { backgroundColor: state === 'current' ? tone.accent : '#173746' },
          locked && styles.levelNumberLocked,
        ]}
      >
        <Text style={styles.levelNumberText}>{level.order}</Text>
      </View>

      <View style={styles.levelCopy}>
        <Text
          style={[styles.levelName, locked && styles.levelNameLocked]}
          maxFontSizeMultiplier={1.4}
        >
          {level.name}
        </Text>
        <Text
          testID={`level-state-${level.id}`}
          style={[
            styles.levelState,
            state === 'current' && { color: tone.accent },
            locked && styles.levelStateLocked,
            state === 'premium-locked' && styles.levelStatePremiumLocked,
          ]}
        >
          {levelStateLabel(state)}
        </Text>
        {!locked ? (
          <Text style={styles.mechanic} maxFontSizeMultiplier={1.35}>
            {level.mechanic}
          </Text>
        ) : null}
      </View>

      <View style={styles.rewardColumn}>
        <View style={styles.rewardLine}>
          <Ionicons
            name="ribbon-outline"
            size={16}
            color={locked ? '#8B7E77' : '#8B5C22'}
          />
          <Text style={[styles.rewardText, locked && styles.rewardTextLocked]}>
            {thimbles} / {availableThimbles}
          </Text>
        </View>
        {collectibleStatus ? (
          <View style={styles.rewardLine}>
            <Ionicons
              name={
                progress?.bestRun.metrics.collectedPatch
                  ? 'flower'
                  : 'flower-outline'
              }
              size={16}
              color={locked ? '#8B7E77' : tone.accent}
            />
            <Text
              testID={`level-patch-${level.id}`}
              style={[styles.patchText, locked && styles.rewardTextLocked]}
            >
              {collectibleStatus}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

interface QuiltSectionProps {
  readonly quilt: QuiltDefinition;
  readonly quiltIndex: number;
  readonly progressByLevel: Readonly<Record<string, CampaignLevelProgress>>;
  readonly hasFullGame: boolean;
  readonly onOpenLevel: (
    levelId: string,
    access: CampaignLevelAccess,
  ) => void;
}

function QuiltSection({
  quilt,
  quiltIndex,
  progressByLevel,
  hasFullGame,
  onOpenLevel,
}: QuiltSectionProps) {
  const tone = QUILT_TONES[quiltIndex % QUILT_TONES.length];
  const levels = CAMPAIGN_LEVELS.filter((level) => level.quiltId === quilt.id);
  const completedCount = levels.filter((level) => progressByLevel[level.id])
    .length;

  return (
    <View
      testID={`quilt-section-${quilt.id}`}
      accessibilityLabel={`${quilt.name}, ${completedCount} of ${levels.length} levels completed`}
      style={[
        styles.quiltSection,
        { backgroundColor: tone.surface, borderColor: tone.border },
      ]}
    >
      <View style={styles.quiltHeader}>
        <View style={[styles.quiltSwatch, { backgroundColor: tone.accent }]} />
        <View style={styles.quiltHeaderCopy}>
          <Text accessibilityRole="header" style={styles.quiltName}>
            {quilt.name}
          </Text>
          <Text style={styles.quiltDescription}>{quilt.description}</Text>
        </View>
        <Text style={styles.quiltProgress}>
          {completedCount}/{levels.length}
        </Text>
      </View>

      <View style={styles.levelPath}>
        {levels.map((level, sectionIndex) => {
          const access = getCampaignLevelAccess(
            level.id,
            progressByLevel,
            hasFullGame,
          );
          return (
            <View key={level.id}>
              {sectionIndex > 0 ? (
                <View
                  accessible={false}
                  style={[styles.connector, { borderColor: tone.connector }]}
                />
              ) : null}
              <LevelNode
                level={level}
                access={access}
                progress={progressByLevel[level.id]}
                tone={tone}
                alignRight={sectionIndex % 2 === 1}
                onPress={() => onOpenLevel(level.id, access)}
              />
            </View>
          );
        })}
      </View>
    </View>
  );
}

export function QuiltMapScreen({ navigation }: QuiltMapScreenProps) {
  const startLevel = useGameStore((state) => state.startLevel);
  const hasFullGame = useEntitlementStore(selectHasFullGame);
  const progressByLevel = useCampaignProgressStore(
    (state) => state.progressByLevel,
  );
  const collectibleLevels = CAMPAIGN_LEVELS.filter(
    (level) => level.collectible,
  );
  const availableThimbles = CAMPAIGN_LEVELS.length * 2 + collectibleLevels.length;
  const totalThimbles = CAMPAIGN_LEVELS.reduce(
    (total, level) =>
      total + (progressByLevel[level.id]?.bestRun.thimbles ?? 0),
    0,
  );
  const patchesFound = collectibleLevels.filter(
    (level) =>
      progressByLevel[level.id]?.bestRun.metrics.collectedPatch === true,
  ).length;

  return (
    <SafeAreaView
      testID="quilt-map-screen"
      edges={['top', 'bottom']}
      style={styles.screen}
    >
      <ScrollView
        alwaysBounceVertical={false}
        contentContainerStyle={styles.content}
      >
        <View style={styles.topBar}>
          <View style={styles.titleCopy}>
            <Text accessibilityRole="header" style={styles.title}>
              Quilt Journey
            </Text>
            <Text style={styles.subtitle}>
              Stitch each square into one finished story.
            </Text>
          </View>
          <Pressable
            testID="quilt-map-settings-button"
            accessibilityRole="button"
            accessibilityLabel="Open settings"
            onPress={() => navigation.navigate('Settings')}
            hitSlop={spacing.xs}
            style={({ pressed }) => [
              styles.settingsButton,
              pressed && styles.settingsButtonPressed,
            ]}
          >
            <Ionicons name="settings-outline" size={22} color="#173746" />
            <Text style={styles.settingsLabel}>Settings</Text>
          </Pressable>
        </View>

        <Pressable
          testID="quilt-map-daily-scrap-button"
          accessibilityRole="button"
          accessibilityLabel="Open today’s Daily Scrap challenge"
          accessibilityHint="One pattern for the current UTC day with unlimited attempts."
          onPress={() => navigation.navigate('DailyScrap')}
          style={({ pressed }) => [
            styles.dailyCard,
            pressed && styles.levelNodePressed,
          ]}
        >
          <View style={styles.dailyIcon}>
            <Ionicons name="calendar-outline" size={26} color="#F8EDDA" />
          </View>
          <View style={styles.dailyCopy}>
            <Text style={styles.dailyEyebrow}>TODAY’S SCRAP</Text>
            <Text style={styles.dailyTitle}>One pattern. One day.</Text>
            <Text style={styles.dailyDescription}>Unlimited pulls. Lowest thread wins.</Text>
          </View>
          <Ionicons name="arrow-forward" size={24} color="#173746" />
        </Pressable>

        <View style={styles.summaryCard}>
          <View style={styles.summaryItem}>
            <Ionicons name="ribbon" size={22} color="#8B5C22" />
            <View>
              <Text style={styles.summaryLabel}>THIMBLES</Text>
              <Text
                testID="quilt-thimble-total"
                accessibilityLabel={`${totalThimbles} of ${availableThimbles} thimbles earned`}
                style={styles.summaryValue}
              >
                {totalThimbles} / {availableThimbles}
              </Text>
            </View>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Ionicons name="flower" size={22} color="#A93238" />
            <View>
              <Text style={styles.summaryLabel}>PATCHES</Text>
              <Text
                testID="quilt-patch-total"
                accessibilityLabel={`${patchesFound} of ${collectibleLevels.length} collectible patches found`}
                style={styles.summaryValue}
              >
                {patchesFound} / {collectibleLevels.length}
              </Text>
            </View>
          </View>
        </View>

        {CAMPAIGN_QUILTS.map((quilt, index) => (
          <QuiltSection
            key={quilt.id}
            quilt={quilt}
            quiltIndex={index}
            progressByLevel={progressByLevel}
            hasFullGame={hasFullGame}
            onOpenLevel={(levelId, access) => {
              if (access.openPaywall) {
                navigation.navigate('Paywall', { levelId });
                return;
              }
              if (!access.canPlay) return;
              startLevel(levelId);
              navigation.navigate('SpikeLevel', { levelId });
            }}
          />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#162F3A',
  },
  content: {
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  topBar: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 2,
    borderColor: '#C8A979',
    backgroundColor: '#F2E2C5',
    ...shadows.soft,
  },
  titleCopy: {
    flex: 1,
  },
  title: {
    color: colors.textPrimary,
    fontFamily: 'Fraunces_700Bold',
    fontSize: 28,
    lineHeight: 33,
    letterSpacing: -0.3,
  },
  subtitle: {
    marginTop: spacing.xxs,
    color: '#604B45',
    fontFamily: 'NunitoSans_600SemiBold',
    fontSize: 13,
    lineHeight: 18,
  },
  settingsButton: {
    minWidth: touchTargets.minimum,
    minHeight: touchTargets.minimum,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xxs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 2,
    borderColor: '#9D765F',
    backgroundColor: '#FFF9EA',
  },
  settingsButtonPressed: {
    backgroundColor: colors.surfacePressed,
  },
  settingsLabel: {
    color: '#173746',
    fontFamily: 'NunitoSans_700Bold',
    fontSize: 11,
    lineHeight: 13,
  },
  summaryCard: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 2,
    borderColor: '#496574',
    backgroundColor: '#F8EDDA',
    ...shadows.soft,
  },
  dailyCard: {
    minHeight: 92,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.xl,
    borderWidth: 3,
    borderColor: '#D88474',
    backgroundColor: '#F2E2C5',
    ...shadows.raised,
  },
  dailyIcon: {
    width: 50,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    backgroundColor: '#A93238',
  },
  dailyCopy: { flex: 1 },
  dailyEyebrow: {
    color: '#A93238',
    fontFamily: 'NunitoSans_800ExtraBold',
    fontSize: 10,
    letterSpacing: 0.9,
  },
  dailyTitle: {
    color: colors.textPrimary,
    fontFamily: 'Fraunces_700Bold',
    fontSize: 21,
    lineHeight: 26,
  },
  dailyDescription: {
    color: '#604B45',
    fontFamily: 'NunitoSans_600SemiBold',
    fontSize: 12,
    lineHeight: 17,
  },
  summaryItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  summaryDivider: {
    width: 2,
    height: 42,
    marginHorizontal: spacing.sm,
    backgroundColor: '#CEB899',
  },
  summaryLabel: {
    color: '#705B5D',
    fontFamily: 'NunitoSans_800ExtraBold',
    fontSize: 10,
    lineHeight: 13,
    letterSpacing: 0.8,
  },
  summaryValue: {
    color: '#173746',
    fontFamily: 'NunitoSans_800ExtraBold',
    fontSize: 18,
    lineHeight: 22,
    fontVariant: ['tabular-nums'],
  },
  quiltSection: {
    overflow: 'hidden',
    padding: spacing.md,
    borderRadius: radii.xl,
    borderWidth: 2,
    ...shadows.raised,
  },
  quiltHeader: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: 'rgba(255, 249, 234, 0.76)',
  },
  quiltSwatch: {
    width: 12,
    alignSelf: 'stretch',
    minHeight: 44,
    borderRadius: radii.pill,
  },
  quiltHeaderCopy: {
    flex: 1,
  },
  quiltName: {
    color: colors.textPrimary,
    fontFamily: 'Fraunces_700Bold',
    fontSize: 22,
    lineHeight: 27,
  },
  quiltDescription: {
    marginTop: spacing.xxs,
    color: '#604B45',
    fontFamily: 'NunitoSans_600SemiBold',
    fontSize: 13,
    lineHeight: 18,
  },
  quiltProgress: {
    minWidth: 42,
    color: '#173746',
    fontFamily: 'NunitoSans_800ExtraBold',
    fontSize: 17,
    lineHeight: 22,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  levelPath: {
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  connector: {
    width: 1,
    height: spacing.md,
    alignSelf: 'center',
    borderLeftWidth: 3,
    borderStyle: 'dashed',
  },
  levelNode: {
    width: '92%',
    minHeight: 82,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.lg,
    borderWidth: 2,
    borderColor: '#A98968',
    backgroundColor: '#FFF9EA',
    ...shadows.soft,
  },
  levelNodeLeft: {
    alignSelf: 'flex-start',
  },
  levelNodeRight: {
    alignSelf: 'flex-end',
  },
  levelNodeCompleted: {
    borderColor: '#5F7A62',
    backgroundColor: '#F7F4DD',
  },
  levelNodeCurrent: {
    borderWidth: 3,
    backgroundColor: '#FFFDF5',
  },
  levelNodeLocked: {
    borderColor: '#A79A90',
    backgroundColor: '#D7D0C8',
    opacity: 0.82,
    elevation: 0,
  },
  levelNodePremiumLocked: {
    borderColor: '#8B6828',
    backgroundColor: '#E6D7BD',
  },
  levelNodePressed: {
    backgroundColor: colors.surfacePressed,
  },
  levelNumber: {
    width: touchTargets.minimum,
    height: touchTargets.minimum,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
  },
  levelNumberLocked: {
    backgroundColor: '#6F6762',
  },
  levelNumberText: {
    color: colors.textOnDark,
    fontFamily: 'NunitoSans_800ExtraBold',
    fontSize: 16,
    lineHeight: 20,
    fontVariant: ['tabular-nums'],
  },
  levelCopy: {
    flex: 1,
    minWidth: 0,
  },
  levelName: {
    color: colors.textPrimary,
    fontFamily: 'NunitoSans_800ExtraBold',
    fontSize: 16,
    lineHeight: 21,
  },
  levelNameLocked: {
    color: '#514B48',
  },
  levelState: {
    color: colors.success,
    fontFamily: 'NunitoSans_800ExtraBold',
    fontSize: 10,
    lineHeight: 13,
    letterSpacing: 0.8,
  },
  levelStateLocked: {
    color: '#5F5955',
  },
  levelStatePremiumLocked: {
    color: '#72531D',
  },
  mechanic: {
    marginTop: spacing.xxs,
    color: colors.textSecondary,
    fontFamily: 'NunitoSans_500Medium',
    fontSize: 12,
    lineHeight: 16,
  },
  rewardColumn: {
    minWidth: 66,
    alignItems: 'flex-end',
    gap: spacing.xs,
  },
  rewardLine: {
    minHeight: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.xs,
  },
  rewardText: {
    color: '#5D4426',
    fontFamily: 'NunitoSans_800ExtraBold',
    fontSize: 12,
    lineHeight: 16,
    fontVariant: ['tabular-nums'],
  },
  rewardTextLocked: {
    color: '#5F5955',
  },
  patchText: {
    color: colors.textPrimary,
    fontFamily: 'NunitoSans_800ExtraBold',
    fontSize: 8,
    lineHeight: 11,
    letterSpacing: 0.2,
    textAlign: 'right',
  },
});
