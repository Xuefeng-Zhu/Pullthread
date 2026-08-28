import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { useEffectiveReducedMotion } from '../../accessibility/useEffectiveReducedMotion';
import { PaywallScreen } from '../../screens/PaywallScreen/PaywallScreen';
import { DailyReplayScreen } from '../../screens/DailyReplayScreen/DailyReplayScreen';
import { DailyScrapScreen } from '../../screens/DailyScrapScreen/DailyScrapScreen';
import { QuiltMapScreen } from '../../screens/QuiltMapScreen/QuiltMapScreen';
import { ResultsScreen } from '../../screens/ResultsScreen/ResultsScreen';
import { SettingsScreen } from '../../screens/SettingsScreen/SettingsScreen';
import { SpikeLevelScreen } from '../../screens/SpikeLevelScreen/SpikeLevelScreen';

export type RootStackParamList = {
  QuiltMap: undefined;
  DailyScrap: undefined;
  DailyReplay: { readonly challengeId: string; readonly entryId: string };
  SpikeLevel: {
    readonly levelId: string;
    readonly mode?: 'daily';
    readonly challengeId?: string;
  };
  Results: undefined;
  Settings: undefined;
  Paywall: { readonly levelId?: string } | undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const reducedMotion = useEffectiveReducedMotion();

  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          animation: reducedMotion ? 'none' : 'fade',
          contentStyle: { backgroundColor: '#162f3a' },
        }}
      >
        <Stack.Screen name="QuiltMap" component={QuiltMapScreen} />
        <Stack.Screen name="DailyScrap" component={DailyScrapScreen} />
        <Stack.Screen name="DailyReplay" component={DailyReplayScreen} />
        <Stack.Screen name="SpikeLevel" component={SpikeLevelScreen} />
        <Stack.Screen name="Results" component={ResultsScreen} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen name="Paywall" component={PaywallScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
