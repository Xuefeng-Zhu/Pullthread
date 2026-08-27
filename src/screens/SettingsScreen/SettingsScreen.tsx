import Ionicons from '@expo/vector-icons/Ionicons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useEffect } from 'react';
import {
  AccessibilityInfo,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PreferenceSwitchRow } from '../../components/PreferenceSwitchRow';
import type { RootStackParamList } from '../../app/navigation/RootNavigator';
import { useCampaignProgressStore } from '../../store/useCampaignProgressStore';
import {
  selectHasFullGame,
  useEntitlementStore,
} from '../../store/useEntitlementStore';
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
  const hasFullGame = useEntitlementStore(selectHasFullGame);
  const entitlementStatus = useEntitlementStore((state) => state.status);
  const entitlementNotice = useEntitlementStore((state) => state.notice);
  const restorePurchases = useEntitlementStore(
    (state) => state.restorePurchases,
  );
  const setDebugEntitlement = useEntitlementStore(
    (state) => state.setDebugEntitlement,
  );
  const debugCompleteFreeCampaign = useCampaignProgressStore(
    (state) => state.debugCompleteFreeCampaign,
  );
  const entitlementBusy =
    entitlementStatus === 'purchasing' ||
    entitlementStatus === 'restoring' ||
    entitlementStatus === 'refreshing';

  useEffect(() => {
    if (Platform.OS === 'ios' && entitlementNotice?.message) {
      AccessibilityInfo.announceForAccessibility(entitlementNotice.message);
    }
  }, [entitlementNotice?.message]);

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

        <View style={styles.commercePanel}>
          <View style={styles.commerceHeading}>
            <Ionicons name="storefront-outline" size={22} color="#173746" />
            <View style={styles.commerceCopy}>
              <Text style={styles.commerceTitle}>Full Atelier</Text>
              <Text
                testID="settings-entitlement-status"
                style={styles.commerceStatus}
              >
                {hasFullGame
                  ? 'FULL ATELIER OWNED — LEVELS 7–15 INCLUDED'
                  : 'FREE CAMPAIGN — LEVELS 1–6'}
              </Text>
            </View>
          </View>
          <Pressable
            testID="settings-restore-button"
            accessibilityRole="button"
            accessibilityLabel="Restore Full Atelier purchase"
            accessibilityState={{ disabled: entitlementBusy }}
            disabled={entitlementBusy}
            onPress={() => void restorePurchases()}
            style={({ pressed }) => [
              styles.restoreButton,
              entitlementBusy && styles.buttonDisabled,
              pressed && !entitlementBusy && styles.restoreButtonPressed,
            ]}
          >
            <Ionicons name="refresh" size={19} color="#173746" />
            <Text style={styles.restoreLabel}>
              {entitlementStatus === 'restoring'
                ? 'RESTORING…'
                : 'RESTORE PURCHASES'}
            </Text>
          </Pressable>
          {entitlementNotice ? (
            <Text
              testID="settings-entitlement-notice"
              accessibilityLiveRegion="polite"
              style={[
                styles.entitlementNotice,
                entitlementNotice.kind === 'error' && styles.errorNotice,
              ]}
            >
              {entitlementNotice.message}
            </Text>
          ) : null}
        </View>

        {__DEV__ ? (
          <View testID="entitlement-debug-panel" style={styles.debugPanel}>
            <Text style={styles.debugTitle}>DEVELOPMENT ENTITLEMENT</Text>
            <Text style={styles.debugCopy}>
              Test the premium boundary without a store transaction.
            </Text>
            <View style={styles.debugActions}>
              <Pressable
                testID="debug-entitlement-lock"
                accessibilityRole="button"
                onPress={() => setDebugEntitlement(false)}
                style={({ pressed }) => [
                  styles.debugButton,
                  pressed && styles.restoreButtonPressed,
                ]}
              >
                <Text style={styles.debugButtonLabel}>LOCK</Text>
              </Pressable>
              <Pressable
                testID="debug-entitlement-unlock"
                accessibilityRole="button"
                onPress={() => setDebugEntitlement(true)}
                style={({ pressed }) => [
                  styles.debugButton,
                  pressed && styles.restoreButtonPressed,
                ]}
              >
                <Text style={styles.debugButtonLabel}>UNLOCK</Text>
              </Pressable>
              <Pressable
                testID="debug-entitlement-follow-service"
                accessibilityRole="button"
                onPress={() => setDebugEntitlement(null)}
                style={({ pressed }) => [
                  styles.debugButton,
                  pressed && styles.restoreButtonPressed,
                ]}
              >
                <Text style={styles.debugButtonLabel}>AUTO</Text>
              </Pressable>
            </View>
            <Pressable
              testID="debug-complete-free-campaign"
              accessibilityRole="button"
              accessibilityLabel="Complete free campaign for testing"
              onPress={debugCompleteFreeCampaign}
              style={({ pressed }) => [
                styles.debugButton,
                styles.debugSeedButton,
                pressed && styles.restoreButtonPressed,
              ]}
            >
              <Text style={styles.debugButtonLabel}>COMPLETE FREE PATH</Text>
            </Pressable>
          </View>
        ) : null}

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
  commercePanel: {
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.lg,
    borderWidth: 2,
    borderColor: '#b49369',
    backgroundColor: '#f2e2c5',
    ...shadows.soft,
  },
  commerceHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  commerceCopy: {
    flex: 1,
  },
  commerceTitle: {
    color: colors.textPrimary,
    fontFamily: 'Fraunces_700Bold',
    fontSize: 21,
  },
  commerceStatus: {
    marginTop: spacing.xxs,
    color: '#735040',
    fontFamily: 'NunitoSans_800ExtraBold',
    fontSize: 11,
    letterSpacing: 0.5,
  },
  restoreButton: {
    minHeight: touchTargets.minimum,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 2,
    borderColor: '#8e745d',
    backgroundColor: '#fff9ea',
  },
  restoreButtonPressed: {
    backgroundColor: colors.surfacePressed,
  },
  restoreLabel: {
    color: '#173746',
    fontFamily: 'NunitoSans_800ExtraBold',
    fontSize: 13,
    letterSpacing: 0.5,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  entitlementNotice: {
    color: '#315642',
    fontFamily: 'NunitoSans_600SemiBold',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  errorNotice: {
    color: '#8d2930',
  },
  debugPanel: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: '#76909a',
    backgroundColor: '#d9e5e4',
  },
  debugTitle: {
    color: '#173746',
    fontFamily: 'NunitoSans_800ExtraBold',
    fontSize: 12,
    letterSpacing: 0.7,
  },
  debugCopy: {
    color: '#435e68',
    fontFamily: 'NunitoSans_600SemiBold',
    fontSize: 12,
    lineHeight: 17,
  },
  debugActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  debugButton: {
    minHeight: touchTargets.minimum,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: '#496574',
    backgroundColor: '#fff9ea',
  },
  debugButtonLabel: {
    color: '#173746',
    fontFamily: 'NunitoSans_800ExtraBold',
    fontSize: 11,
  },
  debugSeedButton: {
    flex: 0,
    width: '100%',
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
