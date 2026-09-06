import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

export const ENDLESS_PROGRESS_STORAGE_KEY = 'pullthread.endless-progress.v1';
export const ENDLESS_PROGRESS_STORAGE_VERSION = 1;

export interface PersistedEndlessProgress {
  readonly bestPockets: number;
}

interface EndlessProgressStore extends PersistedEndlessProgress {
  readonly recordScore: (pockets: number) => void;
}

function validScore(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function sanitizeEndlessProgress(value: unknown): PersistedEndlessProgress {
  const score = typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>).bestPockets
    : undefined;
  return { bestPockets: validScore(score) ? score : 0 };
}

// Serialize writes so an older best cannot finish after a newer score and replace it.
let pendingWrite: Promise<void> = Promise.resolve();
let hydrationInProgress = false;
let hydrationReadFailed = false;
const failSoftEndlessStorage: StateStorage = {
  getItem: async (name) => {
    let serialized: string | null;
    try {
      serialized = await AsyncStorage.getItem(name);
    } catch {
      // A failed read does not establish that the durable best is zero.
      hydrationReadFailed = true;
      return null;
    }
    hydrationReadFailed = false;
    try {
      if (serialized !== null) JSON.parse(serialized);
      return serialized;
    } catch {
      // A successfully read but corrupt value is safe to replace with sanitized state.
      return null;
    }
  },
  setItem: async (name, value) => {
    // Hydration will persist its merged maximum after it learns the durable score.
    // Until then, retain new scores in memory rather than overwrite an unknown best.
    if (hydrationInProgress || hydrationReadFailed) return;
    pendingWrite = pendingWrite.then(async () => {
      try {
        await AsyncStorage.setItem(name, value);
      } catch {
        // Keep the best in memory when device storage is unavailable.
      }
    });
    await pendingWrite;
  },
  removeItem: async (name) => {
    await pendingWrite;
    try {
      await AsyncStorage.removeItem(name);
    } catch {
      // Clearing durable data is best-effort outside test cleanup.
    }
  },
};

export const useEndlessProgressStore = create<EndlessProgressStore>()(
  persist<EndlessProgressStore, [], [], PersistedEndlessProgress>(
    (set, get) => ({
      bestPockets: 0,
      recordScore: (pockets) => {
        if (!validScore(pockets) || pockets <= get().bestPockets) return;
        set({ bestPockets: pockets });
        if (hydrationReadFailed) void hydrateEndlessProgress();
      },
    }),
    {
      name: ENDLESS_PROGRESS_STORAGE_KEY,
      version: ENDLESS_PROGRESS_STORAGE_VERSION,
      storage: createJSONStorage(() => failSoftEndlessStorage),
      partialize: (state) => ({ bestPockets: state.bestPockets }),
      migrate: (value) => sanitizeEndlessProgress(value),
      merge: (persisted, current) => ({
        ...current,
        bestPockets: Math.max(current.bestPockets, sanitizeEndlessProgress(persisted).bestPockets),
      }),
      // Reconcile a score recorded while a slower hydration read was in flight.
      onRehydrateStorage: () => {
        hydrationInProgress = true;
        return (state) => {
          hydrationInProgress = false;
          if (state && !hydrationReadFailed) {
            useEndlessProgressStore.setState({ bestPockets: state.bestPockets });
          }
        };
      },
      skipHydration: true,
    },
  ),
);

let hydrationPromise: Promise<void> | null = null;

/** App startup shares one fail-soft read and finishes before showing the durable best. */
export function hydrateEndlessProgress(): Promise<void> {
  if (useEndlessProgressStore.persist.hasHydrated() && !hydrationReadFailed) return Promise.resolve();
  if (!hydrationPromise) {
    hydrationPromise = Promise.resolve(useEndlessProgressStore.persist.rehydrate())
      .then(async () => { await pendingWrite; })
      .catch(() => undefined)
      .finally(() => { hydrationPromise = null; });
  }
  return hydrationPromise;
}

/** Test-only cleanup. Classic campaign saves, preferences and entitlements are separate. */
export async function resetEndlessProgressStoreForTests(): Promise<void> {
  await pendingWrite;
  hydrationInProgress = false;
  hydrationReadFailed = false;
  useEndlessProgressStore.setState({ bestPockets: 0 });
  await pendingWrite;
  await AsyncStorage.removeItem(ENDLESS_PROGRESS_STORAGE_KEY);
}
