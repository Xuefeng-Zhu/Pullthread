import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { useEffectiveReducedMotion } from '../../accessibility/useEffectiveReducedMotion';
import { QuiltMapScreen } from '../../screens/QuiltMapScreen/QuiltMapScreen';
import { ResultsScreen } from '../../screens/ResultsScreen/ResultsScreen';
import { SettingsScreen } from '../../screens/SettingsScreen/SettingsScreen';
import { SpikeLevelScreen } from '../../screens/SpikeLevelScreen/SpikeLevelScreen';

export type RootStackParamList = {
  QuiltMap: undefined;
  SpikeLevel: { readonly levelId: string };
  Results: undefined;
  Settings: undefined;
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
        <Stack.Screen name="SpikeLevel" component={SpikeLevelScreen} />
        <Stack.Screen name="Results" component={ResultsScreen} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
