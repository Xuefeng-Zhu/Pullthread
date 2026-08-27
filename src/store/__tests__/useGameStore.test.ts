import { beforeEach, describe, expect, test } from '@jest/globals';

import type { Stitch } from '../../game/core/types';
import { createStitch } from '../../game/input/stitchGesture';
import { CAMPAIGN_LEVELS } from '../../game/levels/campaignLevels';
import { getDailyChallengeForDate } from '../../game/daily';
import { createLevelReplay, simulateLevelReplay } from '../../game/replay';
import { useCampaignProgressStore } from '../useCampaignProgressStore';
import { resetDailyChallengeStoreForTests, useDailyChallengeStore } from '../useDailyChallengeStore';
import { LocalDailyChallengeService } from '../../services/dailyChallenges';
import {
  resetGameStoreForTests,
  selectThreadUsed,
  useGameStore,
} from '../useGameStore';

const STITCH: Stitch = createStitch(
  'test-stitch',
  'pinch',
  { x: 0.2, y: 0.2 },
  { x: 0.2, y: 0.8 },
);

describe('game planning store', () => {
  beforeEach(resetGameStoreForTests);

  test('commits and undoes a stitch without retaining thread cost', () => {
    const limits = { maxStitches: 2, threadBudget: 120 };

    expect(useGameStore.getState().commitStitch(STITCH, limits)).toBe(true);
    expect(selectThreadUsed(useGameStore.getState())).toBe(STITCH.threadCost);

    useGameStore.getState().undo();
    expect(useGameStore.getState().stitches).toHaveLength(0);
    expect(selectThreadUsed(useGameStore.getState())).toBe(0);
  });

  test('rejects a stitch beyond the thread budget', () => {
    const accepted = useGameStore.getState().commitStitch(STITCH, {
      maxStitches: 2,
      threadBudget: 50,
    });

    expect(accepted).toBe(false);
    expect(useGameStore.getState().stitches).toHaveLength(0);
  });

  test('locks edits while running and retries with stitches intact', () => {
    const limits = { maxStitches: 2, threadBudget: 120 };
    useGameStore.getState().commitStitch(STITCH, limits);
    useGameStore.getState().release();
    useGameStore.getState().undo();

    expect(useGameStore.getState().phase).toBe('running');
    expect(useGameStore.getState().stitches).toHaveLength(1);

    useGameStore.getState().resolve({
      status: 'failure',
      reason: 'stuck',
      tick: 180,
      completionMs: 1500,
    });
    useGameStore.getState().retry();

    expect(useGameStore.getState()).toMatchObject({
      phase: 'planning',
      stitches: [STITCH],
      outcome: null,
    });
  });

  test('captures a versioned successful replay until an explicit reset', () => {
    const limits = { maxStitches: 2, threadBudget: 120 };
    useGameStore.getState().commitStitch(STITCH, limits);
    useGameStore.getState().release();
    useGameStore.getState().resolve({
      status: 'success',
      tick: 276,
      completionMs: 2300,
    });

    const completedRun = useGameStore.getState().completedRun;
    expect(completedRun).toMatchObject({
      replay: { stitches: [STITCH] },
      outcome: { status: 'success', completionMs: 2300 },
      isNewBest: true,
      bestMetrics: {
        threadUsed: STITCH.threadCost,
        stitchesUsed: 1,
        completionMs: 2300,
      },
    });

    useGameStore.getState().resetSession();
    expect(useGameStore.getState().completedRun).toBeNull();
    expect(useGameStore.getState().bestRun).toEqual({
      threadUsed: STITCH.threadCost,
      stitchesUsed: 1,
      completionMs: 2300,
      collectedPatch: false,
    });
  });

  test('compares successful attempts by thread, stitches, then time', () => {
    const limits = { maxStitches: 2, threadBudget: 120 };
    useGameStore.getState().commitStitch(STITCH, limits);
    useGameStore.getState().release();
    useGameStore.getState().resolve({
      status: 'success',
      tick: 276,
      completionMs: 2300,
    });
    useGameStore.getState().resetSession();
    useGameStore.getState().commitStitch(STITCH, limits);
    useGameStore.getState().release();
    useGameStore.getState().resolve({
      status: 'success',
      tick: 300,
      completionMs: 2500,
    });

    expect(useGameStore.getState().completedRun).toMatchObject({
      isNewBest: false,
      bestMetrics: { completionMs: 2300 },
    });
  });

  test('ignores late outcomes once the run is no longer active', () => {
    useGameStore.getState().resolve({
      status: 'success',
      tick: 1,
      completionMs: 8,
    });

    expect(useGameStore.getState()).toMatchObject({
      phase: 'planning',
      outcome: null,
      completedRun: null,
    });
  });

  test('records a level-specific replay, thimbles, and collectible progress', () => {
    const level = CAMPAIGN_LEVELS.find(
      (candidate) => candidate.id === 'attic-10-hidden-patch',
    );
    if (!level?.collectible) throw new Error('Expected the hidden-patch level.');

    const game = useGameStore.getState();
    game.startLevel(level.id);
    for (const stitch of level.referenceSolution) {
      expect(
        useGameStore.getState().commitStitch(stitch, {
          maxStitches: level.maxStitches,
          threadBudget: level.threadBudget,
        }),
      ).toBe(true);
    }
    const replayOutcome = simulateLevelReplay(
      createLevelReplay(level, level.referenceSolution),
    ).outcome;
    if (replayOutcome.status !== 'success') {
      throw new Error('Expected the hidden-patch reference run to succeed.');
    }

    useGameStore.getState().release();
    useGameStore.getState().resolve(replayOutcome);

    expect(useGameStore.getState().completedRun).toMatchObject({
      levelId: level.id,
      replay: { levelId: level.id },
      scoredRun: {
        thimbles: 3,
        metrics: { collectedPatch: true },
      },
    });
    expect(
      useCampaignProgressStore.getState().progressByLevel[level.id],
    ).toMatchObject({
      completed: true,
      bestRun: { thimbles: 3, metrics: { collectedPatch: true } },
    });
  });

  test('keeps the current run score separate from merged patch progress', () => {
    const level = CAMPAIGN_LEVELS.find(
      (candidate) => candidate.id === 'attic-10-hidden-patch',
    );
    if (!level?.collectible) throw new Error('Expected the hidden-patch level.');

    const limits = {
      maxStitches: level.maxStitches,
      threadBudget: level.threadBudget,
    };
    useGameStore.getState().startLevel(level.id);
    for (const stitch of level.referenceSolution) {
      expect(useGameStore.getState().commitStitch(stitch, limits)).toBe(true);
    }
    useGameStore.getState().release();
    useGameStore.getState().resolve({
      status: 'success',
      tick: 250,
      completionMs: 2_083,
      collectedPatchId: level.collectible.id,
    });

    useGameStore.getState().resetSession();
    for (const stitch of level.referenceSolution) {
      expect(useGameStore.getState().commitStitch(stitch, limits)).toBe(true);
    }
    useGameStore.getState().release();
    useGameStore.getState().resolve({
      status: 'success',
      tick: 240,
      completionMs: 2_000,
    });

    expect(useGameStore.getState().completedRun).toMatchObject({
      outcome: { status: 'success' },
      isNewBest: false,
      scoredRun: {
        thimbles: 2,
        metrics: { collectedPatch: false },
      },
      bestMetrics: { collectedPatch: true },
    });
    expect(
      useCampaignProgressStore.getState().progressByLevel[level.id]?.bestRun,
    ).toMatchObject({
      thimbles: 3,
      metrics: { collectedPatch: true },
    });
  });

  test('records a Daily Scrap best without mutating campaign progress', async () => {
    const challenge = getDailyChallengeForDate('2026-08-27');
    const level = CAMPAIGN_LEVELS.find(
      (candidate) => candidate.id === challenge.levelId,
    );
    if (!level) throw new Error('Expected the Daily Scrap template level.');
    const storage = {
      values: new Map<string, string>(),
      async getItem(key: string) {
        return this.values.get(key) ?? null;
      },
      async setItem(key: string, value: string) {
        this.values.set(key, value);
      },
    };
    resetDailyChallengeStoreForTests(
      new LocalDailyChallengeService(
        storage,
        () => new Date('2026-08-27T12:00:00.000Z'),
      ),
    );
    await useDailyChallengeStore.getState().loadToday();
    const campaignBefore = useCampaignProgressStore.getState().progressByLevel;

    useGameStore.getState().startLevel(level.id, { kind: 'daily', challenge });
    for (const stitch of level.referenceSolution) {
      expect(
        useGameStore.getState().commitStitch(stitch, {
          maxStitches: level.maxStitches,
          threadBudget: level.threadBudget,
        }),
      ).toBe(true);
    }
    const outcome = simulateLevelReplay(
      createLevelReplay(level, level.referenceSolution),
    ).outcome;
    if (outcome.status !== 'success') throw new Error('Expected a successful pull.');
    useGameStore.getState().release();
    useGameStore.getState().resolve(outcome);

    expect(useGameStore.getState().completedRun).toMatchObject({
      session: { kind: 'daily', challenge: { id: challenge.id } },
      isNewBest: true,
    });
    expect(useCampaignProgressStore.getState().progressByLevel).toBe(campaignBefore);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(useDailyChallengeStore.getState().personalBest).toEqual(
      expect.objectContaining({ challengeId: challenge.id }),
    );
  });
});
