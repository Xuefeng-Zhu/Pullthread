import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { SpikeLevelScreen } from '../../screens/SpikeLevelScreen/SpikeLevelScreen';

export type RootStackParamList = {
  SpikeLevel: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          animation: 'fade',
          contentStyle: { backgroundColor: '#162f3a' },
        }}
      >
        <Stack.Screen name="SpikeLevel" component={SpikeLevelScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
