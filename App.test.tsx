/** @jest-environment node */
import { act, render, waitFor } from '@testing-library/react-native';
import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import MockReact from 'react';
import { Text as MockText, View as MockView } from 'react-native';

import App from './App';
import { AppMusic } from './src/game/feedback/AppMusic';
import { hydrateEndlessProgress } from './src/store/useEndlessProgressStore';
import { hydratePreferences } from './src/store/usePreferencesStore';

jest.mock('expo-font', () => ({ useFonts: jest.fn(() => [true]) }));
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
jest.mock('react-native-gesture-handler', () => ({ GestureHandlerRootView: MockView }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaProvider: MockView }));
jest.mock('react-native-reanimated', () => ({
  ReduceMotion: { Always: 'always', System: 'system' },
  ReducedMotionConfig: () => null,
}));
jest.mock('./src/app/navigation/RootNavigator', () => ({
  RootNavigator: () => MockReact.createElement(MockText, null, 'Game ready'),
}));
jest.mock('./src/game/feedback/AppMusic', () => ({
  AppMusic: jest.fn(() => null),
}));
jest.mock('./src/store/useEndlessProgressStore', () => ({
  hydrateEndlessProgress: jest.fn(),
  useEndlessProgressStore: Object.assign(jest.fn(), {
    persist: { hasHydrated: jest.fn(() => false) },
  }),
}));
jest.mock('./src/store/usePreferencesStore', () => ({
  hydratePreferences: jest.fn(),
  usePreferencesStore: Object.assign(
    jest.fn((selector: (state: { reducedMotionEnabled: boolean }) => unknown) => selector({ reducedMotionEnabled: false })),
    { persist: { hasHydrated: jest.fn(() => false) } },
  ),
}));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

describe('App startup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(hydratePreferences).mockResolvedValue(undefined);
    jest.mocked(hydrateEndlessProgress).mockResolvedValue(undefined);
  });

  test('waits for preferences and the saved endless best before showing the game', async () => {
    const preferences = deferred();
    const endless = deferred();
    jest.mocked(hydratePreferences).mockReturnValue(preferences.promise);
    jest.mocked(hydrateEndlessProgress).mockReturnValue(endless.promise);
    const view = await render(<App />);
    expect(view.getByLabelText('Loading Pullthread')).toBeTruthy();
    expect(hydratePreferences).toHaveBeenCalledTimes(1);
    expect(hydrateEndlessProgress).toHaveBeenCalledTimes(1);
    await act(async () => { preferences.resolve(); await preferences.promise; });
    expect(view.getByLabelText('Loading Pullthread')).toBeTruthy();
    await act(async () => { endless.resolve(); await endless.promise; });
    await waitFor(() => expect(view.getByText('Game ready')).toBeTruthy());
    expect(AppMusic).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  test('opens the game when either local cache is unavailable', async () => {
    jest.mocked(hydratePreferences).mockRejectedValue(new Error('preference cache unavailable'));
    jest.mocked(hydrateEndlessProgress).mockRejectedValue(new Error('score cache unavailable'));
    const view = await render(<App />);
    await waitFor(() => expect(view.getByText('Game ready')).toBeTruthy());
    await view.unmount();
  });
});
