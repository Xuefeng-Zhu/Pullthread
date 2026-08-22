import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Switch, Text, View } from 'react-native';

import { colors, spacing, touchTargets } from '../theme/tokens';

interface PreferenceSwitchRowProps {
  readonly testID: string;
  readonly label: string;
  readonly icon: keyof typeof Ionicons.glyphMap;
  readonly value: boolean;
  readonly onValueChange: (value: boolean) => void;
}

export function PreferenceSwitchRow({
  testID,
  label,
  icon,
  value,
  onValueChange,
}: PreferenceSwitchRowProps) {
  const stateCopy = value ? 'ON' : 'OFF';

  return (
    <View testID={`${testID}-row`} style={styles.row}>
      <View style={styles.labelGroup}>
        <View style={styles.iconWrap}>
          <Ionicons name={icon} size={24} color="#173746" />
        </View>
        <Text style={styles.label}>{label}</Text>
      </View>

      <View style={styles.switchGroup}>
        <Text style={styles.stateCopy}>{stateCopy}</Text>
        <Switch
          testID={testID}
          accessibilityLabel={label}
          accessibilityHint={`Currently ${stateCopy.toLowerCase()}. Double tap to turn ${
            value ? 'off' : 'on'
          }.`}
          accessibilityState={{ checked: value }}
          value={value}
          onValueChange={onValueChange}
          trackColor={{ false: '#b9a98e', true: colors.success }}
          thumbColor="#fff4dc"
          ios_backgroundColor="#b9a98e"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: '#c8aa7f',
  },
  labelGroup: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  iconWrap: {
    width: touchTargets.minimum,
    height: touchTargets.minimum,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    flexShrink: 1,
    color: '#173746',
    fontFamily: 'NunitoSans_700Bold',
    fontSize: 17,
    lineHeight: 22,
  },
  switchGroup: {
    minWidth: 88,
    minHeight: touchTargets.minimum,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.xs,
  },
  stateCopy: {
    width: 26,
    color: '#46372f',
    fontFamily: 'NunitoSans_800ExtraBold',
    fontSize: 10,
    letterSpacing: 0.4,
    textAlign: 'right',
  },
});
