import AsyncStorage from '@react-native-async-storage/async-storage';
import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import type { RunMetrics } from '../../game/core/scoring';
import { CAMPAIGN_LEVELS } from '../../game/levels/campaignLevels';
import {
  CAMPAIGN_PROGRESS_STORAGE_KEY,
  hydrateCampaignProgress,
  migrateCampaignProgress,
  resetCampaignProgressStoreForTests,
  sanitizeCampaignProgress,
  useCampaignProgressStore,
} from '../useCampaignProgressStore';

const run = (overrides: Partial<RunMetrics> = {}): RunMetrics => ({
  threadUsed: 90,
  stitchesUsed: 2,
  completionMs: 4_000,
  collectedPatch: false,
  ...overrides,
});

const FIRST_LEVEL_ID = CAMPAIGN_LEVELS[0].id;
const SECOND_LEVEL_ID = CAMPAIGN_LEVELS[1].id;
const ATTIC_LEVEL_ID = CAMPAIGN_LEVELS[5].id;
const PATCH_LEVEL_ID = CAMPAIGN_LEVELS[9].id;
const FINALE_LEVEL_ID = CAMPAIGN_LEVELS[14].id;

describe('campaign progress persistence', () => {
  beforeEach(async () => {
    await resetCampaignProgressStoreForTests();
    jest.clearAllMocks();
  });

  test('hydrates once and shares the read across concurrent callers', async () => {
    await AsyncStorage.setItem(
      CAMPAIGN_PROGRESS_STORAGE_KEY,
      JSON.stringify({
        state: {
          progressByLevel: {
            [FIRST_LEVEL_ID]: {
              completed: true,
              bestRun: {
                metrics: run(),
                thimbles: 2,
              },
            },
          },
        },
        version: 1,
      }),
    );
    jest.clearAllMocks();

    await Promise.all([
      hydrateCampaignProgress(),
      hydrateCampaignProgress(),
    ]);

    expect(AsyncStorage.getItem).toHaveBeenCalledTimes(1);
    expect(useCampaignProgressStore.getState().progressByLevel).toMatchObject({
      [FIRST_LEVEL_ID]: { completed: true, bestRun: { thimbles: 2 } },
    });
  });

  test('records successful runs per level and persists only progress data', async () => {
    const recorded = useCampaignProgressStore
      .getState()
      .recordRun(PATCH_LEVEL_ID, run({ collectedPatch: true }), 100);

    expect(recorded).toMatchObject({
      thimbles: 3,
      metrics: run({ collectedPatch: true }),
    });
    expect(
      useCampaignProgressStore.getState().progressByLevel[PATCH_LEVEL_ID],
    ).toEqual({ completed: true, bestRun: recorded });

    const serialized = await AsyncStorage.getItem(
      CAMPAIGN_PROGRESS_STORAGE_KEY,
    );
    expect(JSON.parse(serialized ?? '{}')).toEqual({
      state: {
        progressByLevel: {
          [PATCH_LEVEL_ID]: { completed: true, bestRun: recorded },
        },
      },
      version: 1,
    });
  });

  test('keeps independent level records and merges patch progress across runs', () => {
    const state = useCampaignProgressStore.getState();
    state.recordRun(
      PATCH_LEVEL_ID,
      run({
        threadUsed: 110,
        stitchesUsed: 3,
        completionMs: 5_000,
        collectedPatch: true,
      }),
      100,
    );
    const merged = useCampaignProgressStore
      .getState()
      .recordRun(PATCH_LEVEL_ID, run({ threadUsed: 80 }), 100);
    useCampaignProgressStore
      .getState()
      .recordRun(ATTIC_LEVEL_ID, run({ threadUsed: 200 }), 100);

    expect(merged).toEqual({
      metrics: run({ threadUsed: 80, collectedPatch: true }),
      thimbles: 3,
    });
    expect(
      useCampaignProgressStore.getState().progressByLevel[ATTIC_LEVEL_ID]?.bestRun
        .thimbles,
    ).toBe(1);
  });

  test('rejects unknown level IDs without changing progress', () => {
    const state = useCampaignProgressStore.getState();

    expect(() => state.recordRun('', run(), 100)).toThrow(TypeError);
    expect(() => state.recordRun('unknown-level', run(), 100)).toThrow(
      TypeError,
    );
    expect(useCampaignProgressStore.getState().progressByLevel).toEqual({});
  });

  test('does not award an impossible patch to a level without one', () => {
    const recorded = useCampaignProgressStore
      .getState()
      .recordRun(FIRST_LEVEL_ID, run({ collectedPatch: true }), 100);

    expect(recorded).toMatchObject({
      thimbles: 2,
      metrics: { collectedPatch: false },
    });
  });

  test('sanitizes malformed entries while retaining valid legacy metrics', () => {
    expect(
      sanitizeCampaignProgress({
        progressByLevel: {
          [PATCH_LEVEL_ID]: {
            completed: true,
            bestRun: {
              metrics: {
                threadUsed: 75,
                stitchesUsed: 1,
                completionMs: 3_500,
                collectedPatch: true,
              },
              thimbles: 1,
            },
          },
          [SECOND_LEVEL_ID]: {
            thread: 88,
            stitches: 2,
            completionMs: 4_200,
            bestThimbleCount: 2,
          },
          [CAMPAIGN_LEVELS[2].id]: { completed: false, bestRun: run() },
          ' ': { bestRun: run() },
          broken: { threadUsed: -1, stitchesUsed: 2, completionMs: 4_000 },
        },
      }),
    ).toEqual({
      progressByLevel: {
        [PATCH_LEVEL_ID]: {
          completed: true,
          bestRun: {
            metrics: run({
              threadUsed: 75,
              stitchesUsed: 1,
              completionMs: 3_500,
              collectedPatch: true,
            }),
            thimbles: 2,
          },
        },
        [SECOND_LEVEL_ID]: {
          completed: true,
          bestRun: {
            metrics: run({
              threadUsed: 88,
              completionMs: 4_200,
            }),
            thimbles: 2,
          },
        },
      },
    });
  });

  test('clamps an impossible persisted patch thimble without patch progress', () => {
    expect(
      sanitizeCampaignProgress({
        progressByLevel: {
          [PATCH_LEVEL_ID]: {
            completed: true,
            bestRun: {
              metrics: run({ collectedPatch: false }),
              thimbles: 3,
            },
          },
        },
      }),
    ).toMatchObject({
      progressByLevel: {
        [PATCH_LEVEL_ID]: {
          completed: true,
          bestRun: {
            metrics: { collectedPatch: false },
            thimbles: 2,
          },
        },
      },
    });
  });

  test('migrates a version-zero direct level map without erasing progress', async () => {
    const legacy = {
      'attic-10': {
        threadUsed: 82,
        stitchesUsed: 2,
        completionMs: 3_900,
        collectedPatch: true,
        thimbles: 3,
      },
    };

    expect(migrateCampaignProgress(legacy, 0)).toMatchObject({
      progressByLevel: {
        [PATCH_LEVEL_ID]: { completed: true, bestRun: { thimbles: 3 } },
      },
    });

    useCampaignProgressStore.setState({ progressByLevel: {} });
    await AsyncStorage.setItem(
      CAMPAIGN_PROGRESS_STORAGE_KEY,
      JSON.stringify({ state: legacy, version: 0 }),
    );
    await useCampaignProgressStore.persist.rehydrate();

    expect(useCampaignProgressStore.getState().progressByLevel).toMatchObject({
      [PATCH_LEVEL_ID]: {
        completed: true,
        bestRun: {
          metrics: { threadUsed: 82, collectedPatch: true },
          thimbles: 3,
        },
      },
    });
  });

  test('keeps in-memory progress when durable writes fail', () => {
    jest
      .mocked(AsyncStorage.setItem)
      .mockRejectedValueOnce(new Error('storage unavailable'));

    expect(() =>
      useCampaignProgressStore
        .getState()
        .recordRun(FINALE_LEVEL_ID, run(), 100),
    ).not.toThrow();
    expect(
      useCampaignProgressStore.getState().progressByLevel[FINALE_LEVEL_ID],
    ).toBeDefined();
  });

  test('resets all level progress and persists the empty save', async () => {
    useCampaignProgressStore
      .getState()
      .recordRun(FIRST_LEVEL_ID, run(), 100);
    useCampaignProgressStore.getState().resetProgress();

    expect(useCampaignProgressStore.getState().progressByLevel).toEqual({});
    const serialized = await AsyncStorage.getItem(
      CAMPAIGN_PROGRESS_STORAGE_KEY,
    );
    expect(JSON.parse(serialized ?? '{}')).toEqual({
      state: { progressByLevel: {} },
      version: 1,
    });
  });
});
