import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import type { SimulationOutcome } from '../game/core/types';
import {
  colors,
  highContrastColors,
  radii,
  shadows,
  spacing,
} from '../theme/tokens';

interface OutcomeBannerProps {
  readonly outcome: SimulationOutcome;
  readonly highContrast?: boolean;
  readonly reducedMotion?: boolean;
}

function failureCopy(outcome: Extract<SimulationOutcome, { status: 'failure' }>) {
  switch (outcome.reason) {
    case 'out_of_bounds':
      return ['Loose end', 'The button slipped off. Move the ridge toward its route.'];
    case 'stuck':
      return ['Still on the quilt', 'The button settled early. Try a steeper pull.'];
    case 'timeout':
      return ['Thread went quiet', 'The route took too long. Make the slope more direct.'];
    case 'hazard':
      return ['Snagged', 'The button caught on the quilt. Redirect it and retry.'];
  }
}

export function OutcomeBanner({
  outcome,
  highContrast = false,
  reducedMotion = false,
}: OutcomeBannerProps) {
  const success = outcome.status === 'success';
  const statusColor = success
    ? highContrast
      ? highContrastColors.goal
      : colors.success
    : highContrast
      ? highContrastColors.thread
      : colors.failure;
  const [title, detail] = success
    ? [
        'Perfect pull!',
        `The button found the embroidery in ${(outcome.completionMs / 1000).toFixed(1)}s.`,
      ]
    : failureCopy(outcome);

  return (
    <Animated.View
      testID="outcome-banner"
      entering={reducedMotion ? undefined : FadeInDown.duration(220)}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[styles.banner, { borderColor: statusColor }]}
    >
      <View style={styles.iconWrap}>
        <Ionicons
          name={success ? 'checkmark' : 'cut-outline'}
          size={20}
          color={statusColor}
        />
      </View>
      <View style={styles.copy}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.detail}>{detail}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.lg,
    zIndex: 4,
    minHeight: 74,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 2,
    backgroundColor: '#fff7e7',
    ...shadows.raised,
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1dfbd',
  },
  copy: { flex: 1 },
  title: {
    color: colors.textPrimary,
    fontFamily: 'Fraunces_700Bold',
    fontSize: 18,
  },
  detail: {
    marginTop: 2,
    color: colors.textSecondary,
    fontFamily: 'NunitoSans_600SemiBold',
    fontSize: 12,
    lineHeight: 16,
  },
});
