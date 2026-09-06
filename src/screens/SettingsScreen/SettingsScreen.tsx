import Ionicons from '@expo/vector-icons/Ionicons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PreferenceSwitchRow } from '../../components/PreferenceSwitchRow';
import type { RootStackParamList } from '../../app/navigation/RootNavigator';
import { usePreferencesStore } from '../../store/usePreferencesStore';
import {
  colors,
  radii,
  shadows,
  spacing,
  touchTargets,
} from '../../theme/tokens';

export interface SettingsScreenProps {
  readonly navigation: Pick<
    NativeStackNavigationProp<RootStackParamList, 'Settings'>,
    'goBack'
  >;
}

export function SettingsScreen({ navigation }: SettingsScreenProps) {
  const soundEnabled = usePreferencesStore((state) => state.soundEnabled);
  const hapticsEnabled = usePreferencesStore((state) => state.hapticsEnabled);
  const reducedMotionEnabled = usePreferencesStore(
    (state) => state.reducedMotionEnabled,
  );
  const highContrastEnabled = usePreferencesStore(
    (state) => state.highContrastEnabled,
  );
  const tutorialHintsEnabled = usePreferencesStore(
    (state) => state.tutorialHintsEnabled,
  );
  const setSoundEnabled = usePreferencesStore(
    (state) => state.setSoundEnabled,
  );
  const setHapticsEnabled = usePreferencesStore(
    (state) => state.setHapticsEnabled,
  );
  const setReducedMotionEnabled = usePreferencesStore(
    (state) => state.setReducedMotionEnabled,
  );
  const setHighContrastEnabled = usePreferencesStore(
    (state) => state.setHighContrastEnabled,
  );
  const setTutorialHintsEnabled = usePreferencesStore(
    (state) => state.setTutorialHintsEnabled,
  );
  return (
    <SafeAreaView
      testID="settings-screen"
      edges={['top', 'bottom']}
      style={styles.screen}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        alwaysBounceVertical={false}
      >
        <View style={styles.titlePlaque}>
          <Ionicons name="settings-outline" size={24} color="#173746" />
          <Text accessibilityRole="header" style={styles.title}>
            Settings
          </Text>
        </View>

        <View style={styles.panel}>
          <PreferenceSwitchRow
            testID="sound-switch"
            label="Sound"
            icon="volume-high-outline"
            value={soundEnabled}
            onValueChange={setSoundEnabled}
          />
          <PreferenceSwitchRow
            testID="haptics-switch"
            label="Haptics"
            icon="hand-left-outline"
            value={hapticsEnabled}
            onValueChange={setHapticsEnabled}
          />
          <PreferenceSwitchRow
            testID="reduced-motion-switch"
            label="Reduced motion"
            icon="ellipse-outline"
            value={reducedMotionEnabled}
            onValueChange={setReducedMotionEnabled}
          />
          <PreferenceSwitchRow
            testID="high-contrast-switch"
            label="High contrast"
            icon="contrast-outline"
            value={highContrastEnabled}
            onValueChange={setHighContrastEnabled}
          />
          <PreferenceSwitchRow
            testID="tutorial-hints-switch"
            label="Tutorial hints"
            icon="flower-outline"
            value={tutorialHintsEnabled}
            onValueChange={setTutorialHintsEnabled}
          />
        </View>

        <Pressable
          testID="settings-done-button"
          accessibilityRole="button"
          accessibilityLabel="Done"
          onPress={navigation.goBack}
          style={({ pressed }) => [
            styles.doneButton,
            pressed && styles.doneButtonPressed,
          ]}
        >
          <Text style={styles.doneLabel}>DONE</Text>
        </Pressable>
        <Text style={styles.saveCopy}>Changes save on this device.</Text>
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
    justifyContent: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  titlePlaque: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.lg,
    borderWidth: 2,
    borderColor: '#c8a979',
    backgroundColor: '#f2e2c5',
    ...shadows.soft,
  },
  title: {
    color: colors.textPrimary,
    fontFamily: 'Fraunces_700Bold',
    fontSize: 30,
    letterSpacing: -0.3,
  },
  panel: {
    overflow: 'hidden',
    borderRadius: radii.lg,
    borderWidth: 2,
    borderColor: '#b49369',
    backgroundColor: '#eeddbd',
    ...shadows.raised,
  },
  doneButton: {
    minHeight: touchTargets.primary,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    minWidth: 220,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.lg,
    borderWidth: 3,
    borderColor: '#d88474',
    backgroundColor: '#a93238',
    ...shadows.raised,
  },
  doneButtonPressed: {
    transform: [{ translateY: 2 }],
    backgroundColor: '#8d2930',
  },
  doneLabel: {
    color: colors.textOnDark,
    fontFamily: 'NunitoSans_800ExtraBold',
    fontSize: 20,
    letterSpacing: 1,
  },
  saveCopy: {
    color: '#f3e5ca',
    fontFamily: 'NunitoSans_600SemiBold',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
});
