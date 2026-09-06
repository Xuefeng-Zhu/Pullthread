import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { useEffectiveReducedMotion } from '../../accessibility/useEffectiveReducedMotion';
import { SettingsScreen } from '../../screens/SettingsScreen/SettingsScreen';
import { EndlessGameScreen } from '../../screens/EndlessGameScreen/EndlessGameScreen';

export type RootStackParamList = {
  EndlessGame: undefined;
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const reducedMotion = useEffectiveReducedMotion();

  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="EndlessGame"
        screenOptions={{
          headerShown: false,
          animation: reducedMotion ? 'none' : 'fade',
          contentStyle: { backgroundColor: '#162f3a' },
        }}
      >
        <Stack.Screen name="EndlessGame" component={EndlessGameScreen} options={{ title: 'Pullthread' }} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
