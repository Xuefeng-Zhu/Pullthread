import { act, render, waitFor } from '@testing-library/react-native';
import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import App from './App';
import { hydrateCampaignProgress } from './src/store/useCampaignProgressStore';
import {
  hydrateEntitlements,
  initializeEntitlements,
} from './src/store/useEntitlementStore';
import { hydratePreferences } from './src/store/usePreferencesStore';

jest.mock('expo-font', () => ({
  useFonts: jest.fn(() => [true]),
}));

jest.mock('expo-status-bar', () => ({
  StatusBar: () => null,
}));

jest.mock('react-native-gesture-handler', () => {
  const { View } = require('react-native');

  return { GestureHandlerRootView: View };
});

jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');

  return { SafeAreaProvider: View };
});

jest.mock('react-native-reanimated', () => ({
  ReduceMotion: { Always: 'always', System: 'system' },
  ReducedMotionConfig: () => null,
}));

jest.mock('./src/app/navigation/RootNavigator', () => {
  const React = require('react');
  const { Text } = require('react-native');

  return {
    RootNavigator: () => React.createElement(Text, null, 'Campaign ready'),
  };
});

jest.mock('./src/store/useCampaignProgressStore', () => ({
  hydrateCampaignProgress: jest.fn(),
  useCampaignProgressStore: Object.assign(jest.fn(), {
    persist: { hasHydrated: jest.fn(() => false) },
  }),
}));

jest.mock('./src/store/useEntitlementStore', () => ({
  hydrateEntitlements: jest.fn(),
  initializeEntitlements: jest.fn(),
  useEntitlementStore: Object.assign(jest.fn(), {
    persist: { hasHydrated: jest.fn(() => false) },
  }),
}));

jest.mock('./src/store/usePreferencesStore', () => ({
  hydratePreferences: jest.fn(),
  usePreferencesStore: Object.assign(
    jest.fn(
      (selector: (state: { reducedMotionEnabled: boolean }) => unknown) =>
        selector({ reducedMotionEnabled: false }),
    ),
    { persist: { hasHydrated: jest.fn(() => false) } },
  ),
}));

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

describe('App startup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(initializeEntitlements).mockResolvedValue(undefined);
  });

  test('waits for every hydration attempt before loading or initializing entitlements', async () => {
    const campaignHydration = deferred();
    const entitlementHydration = deferred();
    jest
      .mocked(hydratePreferences)
      .mockRejectedValue(new Error('preference cache unavailable'));
    jest
      .mocked(hydrateCampaignProgress)
      .mockReturnValue(campaignHydration.promise);
    jest
      .mocked(hydrateEntitlements)
      .mockReturnValue(entitlementHydration.promise);

    const view = await render(<App />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(view.getByLabelText('Loading Pullthread')).toBeTruthy();
    expect(initializeEntitlements).not.toHaveBeenCalled();

    await act(async () => {
      campaignHydration.resolve();
      await campaignHydration.promise;
    });

    expect(view.getByLabelText('Loading Pullthread')).toBeTruthy();
    expect(initializeEntitlements).not.toHaveBeenCalled();

    await act(async () => {
      entitlementHydration.resolve();
      await entitlementHydration.promise;
    });

    await waitFor(() => {
      expect(view.getByText('Campaign ready')).toBeTruthy();
      expect(initializeEntitlements).toHaveBeenCalledTimes(1);
    });
  });
});
