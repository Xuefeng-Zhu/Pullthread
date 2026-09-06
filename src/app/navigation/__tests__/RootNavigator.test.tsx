/** @jest-environment node */
import { render } from '@testing-library/react-native';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import type { ComponentType, ReactNode } from 'react';
import MockReact from 'react';
import { View as MockView } from 'react-native';

import { useEffectiveReducedMotion } from '../../../accessibility/useEffectiveReducedMotion';
import { EndlessGameScreen } from '../../../screens/EndlessGameScreen/EndlessGameScreen';
import { RootNavigator } from '../RootNavigator';

jest.mock('@react-navigation/native', () => {
  return { NavigationContainer: ({ children }: { children: ReactNode }) => MockReact.createElement(MockView, null, children) };
});

jest.mock('@react-navigation/native-stack', () => {
  return {
    createNativeStackNavigator: () => ({
      Navigator: ({ children, ...props }: { children: ReactNode }) => MockReact.createElement(MockView, { ...props, testID: 'root-stack' }, children),
      Screen: ({ name, component }: { name: string; component: ComponentType }) => {
        const props = { testID: `root-route-${name}`, routeComponent: component };
        return MockReact.createElement(MockView, props);
      },
    }),
  };
});

jest.mock('../../../accessibility/useEffectiveReducedMotion', () => ({ useEffectiveReducedMotion: jest.fn(() => false) }));
jest.mock('../../../screens/EndlessGameScreen/EndlessGameScreen', () => ({ EndlessGameScreen: jest.fn(() => null) }));
jest.mock('../../../screens/SettingsScreen/SettingsScreen', () => ({ SettingsScreen: jest.fn(() => null) }));

const testGlobals = globalThis as typeof globalThis & { __DEV__: boolean };
const initialDev = __DEV__;

describe('official game navigation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(useEffectiveReducedMotion).mockReturnValue(false);
  });

  afterEach(() => { testGlobals.__DEV__ = initialDev; });

  test.each([true, false])('registers only endless play and Settings when development is %s', async (development) => {
    testGlobals.__DEV__ = development;
    const view = await render(<RootNavigator />);
    expect(view.getByTestId('root-stack').props.initialRouteName).toBe('EndlessGame');
    expect(view.getByTestId('root-route-EndlessGame').props.routeComponent).toBe(EndlessGameScreen);
    expect(view.queryByTestId('root-route-LaunchPrototype')).toBeNull();
    expect(view.getByTestId('root-route-Settings')).toBeTruthy();
    expect(view.getAllByTestId(/^root-route-/)).toHaveLength(2);
    for (const name of ['QuiltMap', 'SpikeLevel', 'DailyScrap', 'DailyReplay', 'Results', 'Paywall']) {
      expect(view.queryByTestId(`root-route-${name}`)).toBeNull();
    }
    await view.unmount();
  });

  test('the main game navigation honors reduced-motion preferences', async () => {
    jest.mocked(useEffectiveReducedMotion).mockReturnValue(true);
    const view = await render(<RootNavigator />);
    expect(view.getByTestId('root-stack').props.screenOptions.animation).toBe('none');
    await view.unmount();
  });
});
