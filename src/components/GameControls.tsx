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
}

interface UtilityButtonProps {
  readonly testID: string;
  readonly label: string;
  readonly icon: keyof typeof Ionicons.glyphMap;
  readonly disabled?: boolean;
  readonly onPress: () => void;
}

function UtilityButton({
  testID,
  label,
  icon,
  disabled = false,
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
}: GameControlsProps) {
  const planning = phase === 'planning';
  const running = phase === 'running';
  const terminal = phase === 'succeeded' || phase === 'failed';

  return (
    <View style={styles.shelf} accessibilityLabel="Game controls">
      <UtilityButton
        testID="undo-button"
        label="UNDO"
        icon="arrow-undo"
        disabled={!planning || !canUndo}
        onPress={onUndo}
      />
      <UtilityButton
        testID="reset-button"
        label="RESET"
        icon="refresh"
        disabled={running}
        onPress={onReset}
      />
      <Pressable
        testID={terminal ? 'retry-button' : 'release-button'}
        accessibilityRole="button"
        accessibilityLabel={terminal ? 'Retry with these stitches' : 'Release traveler'}
        accessibilityState={{ disabled: running }}
        disabled={running}
        onPress={terminal ? onRetry : onRelease}
        style={({ pressed }) => [
          styles.primaryButton,
          running && styles.primaryDisabled,
          pressed && !running && styles.primaryPressed,
        ]}
      >
        <Ionicons
          name={terminal ? 'reload' : running ? 'ellipsis-horizontal' : 'play'}
          size={24}
          color={colors.textOnDark}
        />
        <Text style={styles.primaryLabel}>
          {terminal ? 'RETRY' : running ? 'ROLLING' : 'RELEASE'}
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
});
