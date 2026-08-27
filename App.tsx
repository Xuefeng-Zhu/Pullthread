import 'react-native-gesture-handler';

import { Fraunces_600SemiBold } from '@expo-google-fonts/fraunces/600SemiBold';
import { Fraunces_700Bold } from '@expo-google-fonts/fraunces/700Bold';
import { NunitoSans_400Regular } from '@expo-google-fonts/nunito-sans/400Regular';
import { NunitoSans_500Medium } from '@expo-google-fonts/nunito-sans/500Medium';
import { NunitoSans_600SemiBold } from '@expo-google-fonts/nunito-sans/600SemiBold';
import { NunitoSans_700Bold } from '@expo-google-fonts/nunito-sans/700Bold';
import { NunitoSans_800ExtraBold } from '@expo-google-fonts/nunito-sans/800ExtraBold';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import {
  ReduceMotion,
  ReducedMotionConfig,
} from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { RootNavigator } from './src/app/navigation/RootNavigator';
import {
  hydrateCampaignProgress,
  useCampaignProgressStore,
} from './src/store/useCampaignProgressStore';
import {
  hydrateEntitlements,
  initializeEntitlements,
  useEntitlementStore,
} from './src/store/useEntitlementStore';
import {
  hydratePreferences,
  usePreferencesStore,
} from './src/store/usePreferencesStore';

export default function App() {
  const [fontsLoaded] = useFonts({
    Fraunces_600SemiBold,
    Fraunces_700Bold,
    NunitoSans_400Regular,
    NunitoSans_500Medium,
    NunitoSans_600SemiBold,
    NunitoSans_700Bold,
    NunitoSans_800ExtraBold,
  });
  const [storedStateLoaded, setStoredStateLoaded] = useState(
    usePreferencesStore.persist.hasHydrated() &&
      useCampaignProgressStore.persist.hasHydrated() &&
      useEntitlementStore.persist.hasHydrated(),
  );
  const reducedMotionEnabled = usePreferencesStore(
    (state) => state.reducedMotionEnabled,
  );

  useEffect(() => {
    let mounted = true;

    void Promise.all([
      hydratePreferences(),
      hydrateCampaignProgress(),
      hydrateEntitlements(),
    ])
      .catch(() => undefined)
      .finally(() => {
        // RevenueCat may need the network. Its refresh starts only after the
        // fail-soft cache is available and never blocks the offline campaign.
        void initializeEntitlements().catch(() => undefined);
        if (mounted) setStoredStateLoaded(true);
      });

    return () => {
      mounted = false;
    };
  }, []);

  if (!fontsLoaded || !storedStateLoaded) {
    return (
      <View style={styles.loading} accessibilityLabel="Loading Pullthread">
        <View style={styles.loadingButton} />
        <Text style={styles.loadingText}>Pullthread</Text>
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <ReducedMotionConfig
          mode={
            reducedMotionEnabled
              ? ReduceMotion.Always
              : ReduceMotion.System
          }
        />
        <StatusBar style="light" />
        <RootNavigator />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#162f3a',
    gap: 18,
  },
  loadingButton: {
    width: 70,
    height: 70,
    borderRadius: 35,
    borderWidth: 8,
    borderColor: '#193f4b',
    backgroundColor: '#5e9aa0',
    boxShadow: '0 8px 12px rgba(0, 0, 0, 0.24)',
    elevation: 5,
  },
  loadingText: {
    color: '#f5e7cd',
    fontFamily: 'Fraunces_700Bold',
    fontSize: 28,
  },
});
