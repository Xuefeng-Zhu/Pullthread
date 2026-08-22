import type { StyleProp, ViewStyle } from 'react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  getTutorialStep,
  type TutorialStepId,
} from '../game/tutorial/tutorialFlow';
import { colors, radii, shadows, spacing, touchTargets } from '../theme/tokens';

interface TutorialCoachmarkProps {
  readonly step: TutorialStepId;
  readonly onSkip: () => void;
  readonly onNext?: () => void;
  readonly nextDisabled?: boolean;
  readonly compact?: boolean;
  readonly style?: StyleProp<ViewStyle>;
}

export function TutorialCoachmark({
  step,
  onSkip,
  onNext,
  nextDisabled = false,
  compact = false,
  style,
}: TutorialCoachmarkProps) {
  const presentation = getTutorialStep(step);

  return (
    <View
      testID="tutorial-coachmark"
      accessibilityLiveRegion="polite"
      pointerEvents="box-none"
      style={[styles.card, compact && styles.cardCompact, style]}
    >
      <View
        pointerEvents="none"
        style={[styles.copy, compact && styles.copyCompact]}
      >
        <Text
          testID="tutorial-step-title"
          accessibilityRole="header"
          style={[styles.title, compact && styles.titleCompact]}
        >
          {presentation.title}
        </Text>
        <Text
          testID="tutorial-step-detail"
          style={[styles.detail, compact && styles.detailCompact]}
        >
          {presentation.detail}
        </Text>
      </View>

      <View pointerEvents="box-none" style={styles.footer}>
        <Pressable
          testID="tutorial-skip-button"
          accessibilityRole="button"
          accessibilityLabel="Skip tutorial hints"
          hitSlop={spacing.xs}
          onPress={onSkip}
          style={({ pressed }) => [
            styles.skipButton,
            pressed && styles.skipButtonPressed,
          ]}
        >
          <Text style={styles.skipLabel}>SKIP</Text>
        </Pressable>
        <View style={styles.footerEnd}>
          <Text
            testID="tutorial-progress"
            accessibilityLabel={`Tutorial step ${presentation.number} of ${presentation.count}`}
            pointerEvents="none"
            style={styles.progress}
          >
            {presentation.progressLabel}
          </Text>
          {onNext ? (
            <Pressable
              testID="tutorial-next-button"
              accessibilityRole="button"
              accessibilityLabel="Continue tutorial"
              accessibilityState={{ disabled: nextDisabled }}
              disabled={nextDisabled}
              onPress={onNext}
              style={({ pressed }) => [
                styles.nextButton,
                nextDisabled && styles.nextButtonDisabled,
                pressed && !nextDisabled && styles.nextButtonPressed,
              ]}
            >
              <Text style={styles.nextLabel}>NEXT</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    maxWidth: 430,
    alignSelf: 'center',
    overflow: 'hidden',
    borderRadius: radii.lg,
    borderWidth: 2,
    borderColor: '#b49369',
    backgroundColor: '#f3e3c4',
    ...shadows.soft,
  },
  cardCompact: {
    borderRadius: radii.md,
  },
  copy: {
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  copyCompact: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  title: {
    color: '#173746',
    fontFamily: 'Fraunces_700Bold',
    fontSize: 20,
    lineHeight: 25,
    textAlign: 'center',
  },
  titleCompact: {
    fontSize: 18,
    lineHeight: 22,
  },
  detail: {
    marginTop: spacing.xs,
    color: colors.textPrimary,
    fontFamily: 'NunitoSans_600SemiBold',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  detailCompact: {
    fontSize: 12,
    lineHeight: 15,
  },
  footer: {
    minHeight: touchTargets.minimum,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: spacing.md,
    borderTopWidth: 1.5,
    borderTopColor: '#c6a980',
    borderStyle: 'dashed',
  },
  skipButton: {
    minWidth: 64,
    minHeight: touchTargets.minimum,
    alignItems: 'flex-start',
    justifyContent: 'center',
    borderRadius: radii.sm,
  },
  skipButtonPressed: {
    opacity: 0.68,
    transform: [{ translateY: 1 }],
  },
  skipLabel: {
    color: '#173746',
    fontFamily: 'NunitoSans_800ExtraBold',
    fontSize: 12,
    letterSpacing: 0.7,
  },
  progress: {
    color: '#173746',
    fontFamily: 'NunitoSans_700Bold',
    fontSize: 12,
    letterSpacing: 0.2,
  },
  footerEnd: {
    minHeight: touchTargets.minimum,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  nextButton: {
    minWidth: 58,
    minHeight: touchTargets.minimum,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
    borderWidth: 1.5,
    borderColor: '#8f6d4f',
    backgroundColor: '#ead4ad',
  },
  nextButtonPressed: {
    transform: [{ translateY: 1 }],
    backgroundColor: '#ddc293',
  },
  nextButtonDisabled: { opacity: 0.45 },
  nextLabel: {
    color: '#173746',
    fontFamily: 'NunitoSans_800ExtraBold',
    fontSize: 11,
    letterSpacing: 0.7,
  },
});
