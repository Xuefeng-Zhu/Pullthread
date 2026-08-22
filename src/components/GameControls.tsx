import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { SimulationPhase } from '../game/core/types';
import { colors, opacity, radii, shadows, spacing, touchTargets } from '../theme/tokens';

interface GameControlsProps {
  readonly phase: SimulationPhase;
  readonly canUndo: boolean;
  readonly onUndo: () => void;
  readonly onReset: () => void;
  readonly onRelease: () => void;
  readonly onRetry: () => void;
  readonly onResults: () => void;
  readonly compact?: boolean;
}

interface UtilityButtonProps {
  readonly testID: string;
  readonly label: string;
  readonly icon: keyof typeof Ionicons.glyphMap;
  readonly disabled?: boolean;
  readonly compact?: boolean;
  readonly onPress: () => void;
}

function UtilityButton({
  testID,
  label,
  icon,
  disabled = false,
  compact = false,
  onPress,
}: UtilityButtonProps) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.utilityButton,
        compact && styles.utilityButtonCompact,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Ionicons name={icon} size={22} color={colors.textPrimary} />
      <Text style={styles.utilityLabel}>{label}</Text>
    </Pressable>
  );
}

export function GameControls({
  phase,
  canUndo,
  onUndo,
  onReset,
  onRelease,
  onRetry,
  onResults,
  compact = false,
}: GameControlsProps) {
  const planning = phase === 'planning';
  const running = phase === 'running';
  const succeeded = phase === 'succeeded';
  const failed = phase === 'failed';
  const primaryTestID = succeeded
    ? 'results-button'
    : failed
      ? 'retry-button'
      : 'release-button';
  const primaryLabel = succeeded
    ? 'View results'
    : failed
      ? 'Retry with these stitches'
      : 'Release traveler';
  const primaryIcon = succeeded
    ? 'ribbon'
    : failed
      ? 'reload'
      : running
        ? 'ellipsis-horizontal'
        : 'play';
  const primaryCopy = succeeded
    ? 'RESULTS'
    : failed
      ? 'RETRY'
      : running
        ? 'ROLLING'
        : 'RELEASE';
  const primaryAction = succeeded ? onResults : failed ? onRetry : onRelease;

  return (
    <View
      style={[styles.shelf, compact && styles.shelfCompact]}
      accessibilityLabel="Game controls"
    >
      <UtilityButton
        testID="undo-button"
        label="UNDO"
        icon="arrow-undo"
        disabled={!planning || !canUndo}
        compact={compact}
        onPress={onUndo}
      />
      <UtilityButton
        testID="reset-button"
        label="RESET"
        icon="refresh"
        disabled={running || succeeded}
        compact={compact}
        onPress={onReset}
      />
      <Pressable
        testID={primaryTestID}
        accessibilityRole="button"
        accessibilityLabel={primaryLabel}
        accessibilityState={{ disabled: running }}
        disabled={running}
        onPress={primaryAction}
        style={({ pressed }) => [
          styles.primaryButton,
          compact && styles.primaryButtonCompact,
          running && styles.primaryDisabled,
          pressed && !running && styles.primaryPressed,
        ]}
      >
        <Ionicons
          name={primaryIcon}
          size={24}
          color={colors.textOnDark}
        />
        <Text style={styles.primaryLabel}>
          {primaryCopy}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  shelf: {
    minHeight: 94,
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    backgroundColor: '#173746',
    borderTopWidth: 2,
    borderTopColor: '#315868',
  },
  utilityButton: {
    width: 72,
    minHeight: touchTargets.primary,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    borderRadius: radii.md,
    borderWidth: 2,
    borderColor: '#c6a980',
    backgroundColor: '#f3e3c4',
    ...shadows.soft,
  },
  utilityButtonCompact: {
    width: 56,
  },
  utilityLabel: {
    color: colors.textPrimary,
    fontFamily: 'NunitoSans_800ExtraBold',
    fontSize: 11,
    letterSpacing: 0.6,
  },
  primaryButton: {
    flex: 1,
    minWidth: 148,
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
  primaryButtonCompact: {
    minWidth: 0,
  },
  primaryLabel: {
    color: colors.textOnDark,
    fontFamily: 'NunitoSans_800ExtraBold',
    fontSize: 18,
    letterSpacing: 0.9,
  },
  disabled: { opacity: opacity.disabled },
  pressed: { transform: [{ translateY: 2 }], backgroundColor: '#e6d2ac' },
  primaryPressed: {
    transform: [{ translateY: 2 }],
    backgroundColor: '#8d2930',
  },
  primaryDisabled: { opacity: 0.72, backgroundColor: '#6f5250' },
  shelfCompact: {
    minHeight: 76,
    gap: 6,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
  },
});
