import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import {
  createJSONStorage,
  persist,
  type StateStorage,
} from 'zustand/middleware';

export const PREFERENCES_STORAGE_KEY = 'pullthread.preferences';
export const PREFERENCES_STORAGE_VERSION = 1;
export const CURRENT_TUTORIAL_VERSION = 1;

export interface PersistedPreferences {
  readonly soundEnabled: boolean;
  readonly hapticsEnabled: boolean;
  readonly reducedMotionEnabled: boolean;
  readonly highContrastEnabled: boolean;
  readonly tutorialHintsEnabled: boolean;
  readonly completedTutorialVersion: number;
}

type BooleanPreferenceKey = Exclude<
  keyof PersistedPreferences,
  'completedTutorialVersion'
>;

interface PreferencesStore extends PersistedPreferences {
  readonly setSoundEnabled: (enabled: boolean) => void;
  readonly setHapticsEnabled: (enabled: boolean) => void;
  readonly setReducedMotionEnabled: (enabled: boolean) => void;
  readonly setHighContrastEnabled: (enabled: boolean) => void;
  readonly setTutorialHintsEnabled: (enabled: boolean) => void;
  readonly completeTutorial: (version?: number) => void;
  readonly resetTutorial: () => void;
}

export const defaultPreferences: PersistedPreferences = {
  soundEnabled: true,
  hapticsEnabled: true,
  reducedMotionEnabled: false,
  highContrastEnabled: false,
  tutorialHintsEnabled: true,
  completedTutorialVersion: 0,
};

/**
 * Persistence must never make an otherwise local setting unusable. AsyncStorage
 * can reject on a full device or when browser storage is unavailable, so reads
 * fall back to defaults and writes become best-effort no-ops.
 */
const failSoftPreferencesStorage: StateStorage = {
  getItem: async (name) => {
    try {
      return await AsyncStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: async (name, value) => {
    try {
      await AsyncStorage.setItem(name, value);
    } catch {
      // The in-memory preference remains active for this app session.
    }
  },
  removeItem: async (name) => {
    try {
      await AsyncStorage.removeItem(name);
    } catch {
      // Clearing durable state is also best-effort outside test cleanup.
    }
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function booleanPreference(
  source: Record<string, unknown>,
  key: BooleanPreferenceKey,
): boolean {
  const value = source[key];
  return typeof value === 'boolean' ? value : defaultPreferences[key];
}

function tutorialVersionPreference(source: Record<string, unknown>): number {
  const value = source.completedTutorialVersion;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : defaultPreferences.completedTutorialVersion;
}

/**
 * Treat persisted data as untrusted input. This also lets version 0 installs
 * migrate safely when fields are missing or malformed.
 */
export function sanitizePreferences(value: unknown): PersistedPreferences {
  const source = isRecord(value) ? value : {};

  return {
    soundEnabled: booleanPreference(source, 'soundEnabled'),
    hapticsEnabled: booleanPreference(source, 'hapticsEnabled'),
    reducedMotionEnabled: booleanPreference(source, 'reducedMotionEnabled'),
    highContrastEnabled: booleanPreference(source, 'highContrastEnabled'),
    tutorialHintsEnabled: booleanPreference(source, 'tutorialHintsEnabled'),
    completedTutorialVersion: tutorialVersionPreference(source),
  };
}

function persistedPreferences(state: PreferencesStore): PersistedPreferences {
  return {
    soundEnabled: state.soundEnabled,
    hapticsEnabled: state.hapticsEnabled,
    reducedMotionEnabled: state.reducedMotionEnabled,
    highContrastEnabled: state.highContrastEnabled,
    tutorialHintsEnabled: state.tutorialHintsEnabled,
    completedTutorialVersion: state.completedTutorialVersion,
  };
}

function normalizedTutorialVersion(version: number): number {
  return Number.isSafeInteger(version) && version >= 0
    ? version
    : CURRENT_TUTORIAL_VERSION;
}

export const usePreferencesStore = create<PreferencesStore>()(
  persist<PreferencesStore, [], [], PersistedPreferences>(
    (set) => ({
      ...defaultPreferences,
      setSoundEnabled: (soundEnabled) => set({ soundEnabled }),
      setHapticsEnabled: (hapticsEnabled) => set({ hapticsEnabled }),
      setReducedMotionEnabled: (reducedMotionEnabled) =>
        set({ reducedMotionEnabled }),
      setHighContrastEnabled: (highContrastEnabled) =>
        set({ highContrastEnabled }),
      setTutorialHintsEnabled: (tutorialHintsEnabled) =>
        set({ tutorialHintsEnabled }),
      completeTutorial: (version = CURRENT_TUTORIAL_VERSION) =>
        set((state) => ({
          completedTutorialVersion: Math.max(
            state.completedTutorialVersion,
            normalizedTutorialVersion(version),
          ),
        })),
      resetTutorial: () => set({ completedTutorialVersion: 0 }),
    }),
    {
      name: PREFERENCES_STORAGE_KEY,
      version: PREFERENCES_STORAGE_VERSION,
      storage: createJSONStorage(() => failSoftPreferencesStorage),
      partialize: persistedPreferences,
      migrate: (value) => sanitizePreferences(value),
      merge: (persisted, current) => ({
        ...current,
        ...sanitizePreferences(persisted),
      }),
      // App boot explicitly hydrates before showing tutorial UI, preventing a
      // persisted completion state from flashing the guide for one frame.
      skipHydration: true,
    },
  ),
);

let hydrationPromise: Promise<void> | null = null;

/** Hydrate once per app process; concurrent callers share the same read. */
export function hydratePreferences(): Promise<void> {
  if (usePreferencesStore.persist.hasHydrated()) {
    return Promise.resolve();
  }

  if (!hydrationPromise) {
    hydrationPromise = Promise.resolve(usePreferencesStore.persist.rehydrate())
      .then(() => undefined)
      .finally(() => {
        hydrationPromise = null;
      });
  }

  return hydrationPromise;
}

/** Test-only reset that also removes the durable value. */
export async function resetPreferencesStoreForTests(): Promise<void> {
  await Promise.resolve(
    usePreferencesStore.setState({ ...defaultPreferences }),
  );
  await AsyncStorage.removeItem(PREFERENCES_STORAGE_KEY);
}
