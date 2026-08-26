import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import {
  createJSONStorage,
  persist,
  type StateStorage,
} from 'zustand/middleware';

import {
  mergeBestRun,
  scoreRun,
  type RunMetrics,
  type ScoredRun,
  type ThimbleCount,
} from '../game/core/scoring';
import { CAMPAIGN_LEVELS } from '../game/levels/campaignLevels';
import type { LevelDefinition } from '../game/levels/schema';

export const CAMPAIGN_PROGRESS_STORAGE_KEY = 'pullthread.campaign-progress';
export const CAMPAIGN_PROGRESS_STORAGE_VERSION = 1;

export interface CampaignLevelProgress {
  readonly completed: true;
  readonly bestRun: ScoredRun;
}

export interface PersistedCampaignProgress {
  readonly progressByLevel: Readonly<
    Record<string, CampaignLevelProgress>
  >;
}

export interface CampaignProgressStore extends PersistedCampaignProgress {
  /** Records a successful run and returns the merged durable best score. */
  readonly recordRun: (
    levelId: string,
    metrics: RunMetrics,
    targetThreadUsage: number,
  ) => ScoredRun;
  readonly resetProgress: () => void;
}

export const defaultCampaignProgress: PersistedCampaignProgress = {
  progressByLevel: {},
};

const CAMPAIGN_LEVELS_BY_ID = new Map(
  CAMPAIGN_LEVELS.map((level) => [level.id, level] as const),
);
const CAMPAIGN_LEVEL_IDS = new Set(CAMPAIGN_LEVELS_BY_ID.keys());
const LEGACY_LEVEL_IDS = new Map<string, string>(
  CAMPAIGN_LEVELS.map((level) => {
    const [quilt, order] = level.id.split('-');
    return [`${quilt}-${order}`, level.id] as const;
  }),
);

/** Campaign play remains available even when device storage is unavailable. */
const failSoftCampaignStorage: StateStorage = {
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
      // Keep the run in memory for this session when persistence fails.
    }
  },
  removeItem: async (name) => {
    try {
      await AsyncStorage.removeItem(name);
    } catch {
      // Clearing durable state is best-effort when storage is unavailable.
    }
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isValidCampaignLevelId(levelId: string): boolean {
  return CAMPAIGN_LEVEL_IDS.has(levelId);
}

function normalizedLevelId(levelId: string): string {
  if (!isValidCampaignLevelId(levelId)) {
    throw new TypeError('Campaign level ID must exist in the current catalog.');
  }

  return levelId;
}

function persistedLevelId(levelId: string): string | null {
  if (CAMPAIGN_LEVEL_IDS.has(levelId)) return levelId;
  return LEGACY_LEVEL_IDS.get(levelId) ?? null;
}

function nonNegativeSafeInteger(value: unknown): number | null {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0
    ? value
    : null;
}

function firstSafeInteger(...values: readonly unknown[]): number | null {
  for (const value of values) {
    const integer = nonNegativeSafeInteger(value);
    if (integer !== null) return integer;
  }

  return null;
}

function sanitizeScoredRun(
  value: unknown,
  levelSource: Record<string, unknown>,
  level: LevelDefinition,
): ScoredRun | null {
  if (!isRecord(value)) return null;

  const metricsSource = isRecord(value.metrics) ? value.metrics : value;
  const threadUsed = firstSafeInteger(
    metricsSource.threadUsed,
    metricsSource.thread,
  );
  const stitchesUsed = firstSafeInteger(
    metricsSource.stitchesUsed,
    metricsSource.stitches,
  );
  const completionMs = firstSafeInteger(metricsSource.completionMs);

  if (
    threadUsed === null ||
    stitchesUsed === null ||
    completionMs === null
  ) {
    return null;
  }

  const collectedPatch = Boolean(level.collectible) &&
    (typeof metricsSource.collectedPatch === 'boolean'
      ? metricsSource.collectedPatch
      : typeof levelSource.collectedPatch === 'boolean'
        ? levelSource.collectedPatch
        : false);
  const rawThimbles = firstSafeInteger(
    value.thimbles,
    levelSource.bestThimbleCount,
    levelSource.thimbles,
  );
  const minimumThimbles = (1 + Number(collectedPatch)) as ThimbleCount;
  const maximumThimbles = level.collectible ? 3 : 2;
  const thimbles = Math.max(
    minimumThimbles,
    Math.min(maximumThimbles, rawThimbles ?? minimumThimbles),
  ) as ThimbleCount;

  return Object.freeze({
    metrics: Object.freeze({
      threadUsed,
      stitchesUsed,
      completionMs,
      collectedPatch,
    }),
    thimbles,
  });
}

function sanitizeLevelProgress(
  value: unknown,
  level: LevelDefinition,
): CampaignLevelProgress | null {
  if (!isRecord(value) || value.completed === false) return null;

  const runSource = isRecord(value.bestRun) ? value.bestRun : value;
  const bestRun = sanitizeScoredRun(runSource, value, level);
  if (!bestRun) return null;

  return Object.freeze({ completed: true, bestRun });
}

function progressSource(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  if (isRecord(value.progressByLevel)) return value.progressByLevel;
  if (isRecord(value.levelProgress)) return value.levelProgress;
  if (isRecord(value.levels)) return value.levels;

  // Version 0 prototypes stored the level map directly.
  return value;
}

/** Treats the entire save as untrusted and drops only malformed level entries. */
export function sanitizeCampaignProgress(
  value: unknown,
): PersistedCampaignProgress {
  const sanitized: Record<string, CampaignLevelProgress> = {};

  for (const [levelId, progress] of Object.entries(progressSource(value))) {
    const catalogLevelId = persistedLevelId(levelId);
    if (!catalogLevelId) continue;
    const level = CAMPAIGN_LEVELS_BY_ID.get(catalogLevelId);
    if (!level) continue;
    const levelProgress = sanitizeLevelProgress(progress, level);
    if (levelProgress) sanitized[catalogLevelId] = levelProgress;
  }

  return { progressByLevel: sanitized };
}

/**
 * All prior save shapes pass through the same field-level sanitizer. Missing
 * fields receive safe defaults while valid level records survive upgrades.
 */
export function migrateCampaignProgress(
  value: unknown,
  _storedVersion: number,
): PersistedCampaignProgress {
  return sanitizeCampaignProgress(value);
}

function persistedCampaignProgress(
  state: CampaignProgressStore,
): PersistedCampaignProgress {
  return { progressByLevel: state.progressByLevel };
}

export const useCampaignProgressStore = create<CampaignProgressStore>()(
  persist<CampaignProgressStore, [], [], PersistedCampaignProgress>(
    (set, get) => ({
      ...defaultCampaignProgress,
      recordRun: (levelId, metrics, targetThreadUsage) => {
        const key = normalizedLevelId(levelId);
        const level = CAMPAIGN_LEVELS_BY_ID.get(key);
        if (!level) throw new Error(`Missing campaign level "${key}".`);
        const candidate = scoreRun(
          {
            ...metrics,
            collectedPatch: Boolean(level.collectible) && metrics.collectedPatch,
          },
          targetThreadUsage,
        );
        const bestRun = mergeBestRun(
          candidate,
          get().progressByLevel[key]?.bestRun ?? null,
        );

        set((state) => ({
          progressByLevel: {
            ...state.progressByLevel,
            [key]: Object.freeze({ completed: true, bestRun }),
          },
        }));

        return bestRun;
      },
      resetProgress: () => set({ progressByLevel: {} }),
    }),
    {
      name: CAMPAIGN_PROGRESS_STORAGE_KEY,
      version: CAMPAIGN_PROGRESS_STORAGE_VERSION,
      storage: createJSONStorage(() => failSoftCampaignStorage),
      partialize: persistedCampaignProgress,
      migrate: migrateCampaignProgress,
      merge: (persisted, current) => ({
        ...current,
        ...sanitizeCampaignProgress(persisted),
      }),
      // Navigation hydrates before showing the map, avoiding lock-state flash.
      skipHydration: true,
    },
  ),
);

let hydrationPromise: Promise<void> | null = null;

/** Hydrates once per app process; concurrent callers share one storage read. */
export function hydrateCampaignProgress(): Promise<void> {
  if (useCampaignProgressStore.persist.hasHydrated()) {
    return Promise.resolve();
  }

  if (!hydrationPromise) {
    hydrationPromise = Promise.resolve(
      useCampaignProgressStore.persist.rehydrate(),
    )
      .then(() => undefined)
      .finally(() => {
        hydrationPromise = null;
      });
  }

  return hydrationPromise;
}

/** Test-only reset that also removes the durable campaign save. */
export async function resetCampaignProgressStoreForTests(): Promise<void> {
  await Promise.resolve(
    useCampaignProgressStore.setState({ progressByLevel: {} }),
  );
  await AsyncStorage.removeItem(CAMPAIGN_PROGRESS_STORAGE_KEY);
}
