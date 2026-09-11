/** @jest-environment node */
import { act, render } from '@testing-library/react-native';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { AppState, Platform, type AppStateStatus } from 'react-native';

import { defaultPreferences, usePreferencesStore } from '../../../store/usePreferencesStore';
import { AppMusic } from '../AppMusic';
import { ExpoMusicService } from '../ExpoMusicService';

const mockMusicService = {
  dispose: jest.fn(),
  setAppActive: jest.fn(),
  setEnabled: jest.fn(),
  unlockFromUserGesture: jest.fn(),
};

jest.mock('../ExpoMusicService', () => ({
  ExpoMusicService: jest.fn(() => mockMusicService),
}));

describe('AppMusic', () => {
  let appStateListener: ((state: AppStateStatus) => void) | undefined;
  const remove = jest.fn();
  const initialAppState = AppState.currentState;

  beforeEach(() => {
    jest.clearAllMocks();
    usePreferencesStore.setState({ ...defaultPreferences });
    AppState.currentState = 'active';
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
      appStateListener = listener;
      return { remove };
    });
  });

  afterEach(() => {
    AppState.currentState = initialAppState;
    jest.restoreAllMocks();
  });

  test('owns one player across preference and lifecycle changes', async () => {
    const view = await render(<AppMusic />);

    expect(ExpoMusicService).toHaveBeenCalledTimes(1);
    expect(mockMusicService.setAppActive).toHaveBeenCalledWith(true);
    expect(mockMusicService.setEnabled).toHaveBeenLastCalledWith(true);

    await act(() => usePreferencesStore.getState().setMusicEnabled(false));
    expect(mockMusicService.setEnabled).toHaveBeenLastCalledWith(false);

    await act(() => appStateListener?.('background'));
    expect(mockMusicService.setAppActive).toHaveBeenLastCalledWith(false);
    expect(ExpoMusicService).toHaveBeenCalledTimes(1);

    await view.unmount();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(mockMusicService.dispose).toHaveBeenCalledTimes(1);
  });

  test('forwards browser pointer and keyboard gestures to the player', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    const listeners = new Map<string, EventListener>();
    const addEventListener = jest.fn((event: string, listener: EventListener) => {
      listeners.set(event, listener);
    });
    const removeEventListener = jest.fn();
    const originalDocument = globalThis.document;
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { addEventListener, removeEventListener },
    });

    const view = await render(<AppMusic />);
    listeners.get('pointerdown')?.(new Event('pointerdown'));
    listeners.get('keydown')?.(new Event('keydown'));

    expect(mockMusicService.unlockFromUserGesture).toHaveBeenCalledTimes(2);
    await view.unmount();
    expect(removeEventListener).toHaveBeenCalledTimes(2);

    if (originalDocument === undefined) {
      Reflect.deleteProperty(globalThis, 'document');
    } else {
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: originalDocument,
      });
    }
  });
});
