import AsyncStorage from '@react-native-async-storage/async-storage';
import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import {
  CURRENT_TUTORIAL_VERSION,
  PREFERENCES_STORAGE_KEY,
  defaultPreferences,
  resetPreferencesStoreForTests,
  sanitizePreferences,
  usePreferencesStore,
} from '../usePreferencesStore';

describe('persisted preferences store', () => {
  beforeEach(async () => {
    await resetPreferencesStoreForTests();
  });

  test('starts with safe defaults and keeps settings independent', () => {
    const state = usePreferencesStore.getState();

    expect({
      musicEnabled: state.musicEnabled,
      soundEnabled: state.soundEnabled,
      hapticsEnabled: state.hapticsEnabled,
      reducedMotionEnabled: state.reducedMotionEnabled,
      highContrastEnabled: state.highContrastEnabled,
      tutorialHintsEnabled: state.tutorialHintsEnabled,
      completedTutorialVersion: state.completedTutorialVersion,
    }).toEqual(defaultPreferences);

    state.setMusicEnabled(false);
    state.setSoundEnabled(false);
    state.setReducedMotionEnabled(true);
    state.setTutorialHintsEnabled(false);

    expect(usePreferencesStore.getState()).toMatchObject({
      musicEnabled: false,
      soundEnabled: false,
      hapticsEnabled: true,
      reducedMotionEnabled: true,
      highContrastEnabled: false,
      tutorialHintsEnabled: false,
    });
  });

  test('persists only preference data and rehydrates it', async () => {
    usePreferencesStore.getState().setSoundEnabled(false);
    usePreferencesStore.getState().setHighContrastEnabled(true);
    usePreferencesStore.getState().completeTutorial();

    const serialized = await AsyncStorage.getItem(PREFERENCES_STORAGE_KEY);
    expect(serialized).not.toBeNull();
    expect(JSON.parse(serialized ?? '{}')).toEqual({
      state: {
        ...defaultPreferences,
        soundEnabled: false,
        highContrastEnabled: true,
        completedTutorialVersion: CURRENT_TUTORIAL_VERSION,
      },
      version: 2,
    });

    usePreferencesStore.setState({ ...defaultPreferences });
    await AsyncStorage.setItem(PREFERENCES_STORAGE_KEY, serialized ?? '');
    await usePreferencesStore.persist.rehydrate();

    expect(usePreferencesStore.getState()).toMatchObject({
      soundEnabled: false,
      highContrastEnabled: true,
      completedTutorialVersion: CURRENT_TUTORIAL_VERSION,
    });
    expect(typeof usePreferencesStore.getState().setSoundEnabled).toBe(
      'function',
    );
    expect(typeof usePreferencesStore.getState().setMusicEnabled).toBe(
      'function',
    );
  });

  test('sanitizes missing and malformed durable values', () => {
    expect(
      sanitizePreferences({
        musicEnabled: 'yes',
        soundEnabled: false,
        hapticsEnabled: 'yes',
        reducedMotionEnabled: true,
        highContrastEnabled: null,
        tutorialHintsEnabled: false,
        completedTutorialVersion: -4,
      }),
    ).toEqual({
      ...defaultPreferences,
      soundEnabled: false,
      reducedMotionEnabled: true,
      tutorialHintsEnabled: false,
    });
    expect(sanitizePreferences(null)).toEqual(defaultPreferences);
  });

  test('migrates an older partial value through safe defaults', async () => {
    await AsyncStorage.setItem(
      PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        state: { soundEnabled: false, completedTutorialVersion: 1 },
        version: 1,
      }),
    );

    await usePreferencesStore.persist.rehydrate();

    expect(usePreferencesStore.getState()).toMatchObject({
      ...defaultPreferences,
      soundEnabled: false,
      musicEnabled: true,
      completedTutorialVersion: 1,
    });
  });

  test('keeps a setting active when durable storage rejects the write', async () => {
    jest
      .mocked(AsyncStorage.setItem)
      .mockRejectedValueOnce(new Error('storage unavailable'));

    await expect(
      Promise.resolve(
        usePreferencesStore.getState().setSoundEnabled(false),
      ),
    ).resolves.toBeUndefined();

    expect(usePreferencesStore.getState().soundEnabled).toBe(false);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      PREFERENCES_STORAGE_KEY,
      expect.any(String),
    );
  });

  test('tracks the newest completed tutorial version and can reset it', () => {
    const state = usePreferencesStore.getState();

    state.completeTutorial(2);
    usePreferencesStore.getState().completeTutorial(1);
    expect(usePreferencesStore.getState().completedTutorialVersion).toBe(2);

    usePreferencesStore.getState().resetTutorial();
    expect(usePreferencesStore.getState().completedTutorialVersion).toBe(0);
  });
});
