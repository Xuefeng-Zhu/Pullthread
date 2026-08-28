import { describe, expect, test } from '@jest/globals';

import type { RunMetrics } from '../../core/scoring';
import { getCampaignLevel } from '../../levels/levelLoader';
import { createLevelReplay, simulateLevelReplay } from '../../replay';
import {
  DAILY_CHALLENGE_TEMPLATES,
  DAILY_POOL_EFFECTIVE_THROUGH,
  DailyCatalogUpdateRequiredError,
  assertDailyChallengePoolRegistry,
  compareDailyMetrics,
  createDailyReplay,
  createDailyRun,
  dailySeedForDate,
  getDailyChallengeForDate,
  parseDailyChallenge,
  parseDailyReplay,
  type DailyChallengePool,
  utcChallengeDate,
} from '../dailyChallenge';

describe('Daily Scrap deterministic domain', () => {
  test('maps golden UTC dates to stable seeds, templates, and ids', () => {
    expect(dailySeedForDate('2026-01-01')).toBe(4_138_307_689);
    expect(getDailyChallengeForDate('2026-01-01')).toMatchObject({
      id: 'daily-2026-01-01-p1-edge-offcut-v1-l1',
      seed: 4_138_307_689,
      templateId: 'edge-offcut',
      levelId: 'bedroom-02-edge-redirect',
    });
    expect(getDailyChallengeForDate('2026-08-26')).toMatchObject({
      seed: 1_231_201_223,
      templateId: 'silk-ribbon',
      levelId: 'attic-06-silk-slide',
    });
    expect(getDailyChallengeForDate('2026-08-27')).toMatchObject({
      seed: 1_214_423_604,
      templateId: 'first-pull-sampler',
      levelId: 'bedroom-01-first-pull',
    });
  });

  test('uses UTC boundaries rather than the device timezone', () => {
    expect(utcChallengeDate(new Date('2026-08-27T00:00:00.000Z'))).toBe(
      '2026-08-27',
    );
    expect(utcChallengeDate(new Date('2026-08-26T23:59:59.999Z'))).toBe(
      '2026-08-26',
    );
  });

  test('keeps the pool explicit, free-only, and deterministically solvable', () => {
    expect(DAILY_CHALLENGE_TEMPLATES.map((template) => template.levelId)).toEqual([
      'bedroom-01-first-pull',
      'bedroom-02-edge-redirect',
      'bedroom-03-felt-landing',
      'bedroom-04-hole-crossing',
      'bedroom-05-thread-budget',
      'attic-06-silk-slide',
    ]);

    for (const template of DAILY_CHALLENGE_TEMPLATES) {
      const level = getCampaignLevel(template.levelId);
      expect(level.order).toBeLessThanOrEqual(6);
      expect(
        simulateLevelReplay(createLevelReplay(level, level.referenceSolution)).outcome
          .status,
      ).toBe('success');
    }
  });

  test('fails closed when this build reaches the end of its shipped pool', () => {
    expect(getDailyChallengeForDate(DAILY_POOL_EFFECTIVE_THROUGH)).toMatchObject({
      challengeDate: DAILY_POOL_EFFECTIVE_THROUGH,
      poolVersion: 1,
    });
    const nextDate = new Date(`${DAILY_POOL_EFFECTIVE_THROUGH}T00:00:00.000Z`);
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);

    expect(() =>
      getDailyChallengeForDate(nextDate.toISOString().slice(0, 10)),
    ).toThrow(DailyCatalogUpdateRequiredError);
  });

  test('requires finite, contiguous, append-only pool ranges', () => {
    const first: DailyChallengePool = {
      version: 1,
      effectiveFrom: '2026-01-01',
      effectiveThrough: '2026-12-31',
      templates: DAILY_CHALLENGE_TEMPLATES,
    };
    const second: DailyChallengePool = {
      ...first,
      version: 2,
      effectiveFrom: '2027-01-01',
      effectiveThrough: '2027-12-31',
    };

    expect(() => assertDailyChallengePoolRegistry([first, second])).not.toThrow();
    expect(() =>
      assertDailyChallengePoolRegistry([first, { ...second, version: 3 }]),
    ).toThrow(/versions must be contiguous/);
    expect(() =>
      assertDailyChallengePoolRegistry([
        first,
        { ...second, effectiveFrom: '2027-01-02' },
      ]),
    ).toThrow(/date ranges must be contiguous/);
    expect(() =>
      assertDailyChallengePoolRegistry([
        { ...first, effectiveThrough: '2025-12-31' },
      ]),
    ).toThrow(/must not be empty/);
  });

  test('rejects remote descriptors and replay envelopes that drift from the day', () => {
    const challenge = getDailyChallengeForDate('2026-08-27');
    const level = getCampaignLevel(challenge.levelId);
    const dailyReplay = createDailyReplay(
      challenge,
      createLevelReplay(level, level.referenceSolution),
    );

    expect(() => parseDailyChallenge({ ...challenge, seed: challenge.seed + 1 })).toThrow(
      'does not match the canonical day',
    );
    expect(() =>
      parseDailyReplay({ ...dailyReplay, simulationSeed: challenge.seed + 1 }),
    ).toThrow('does not match its challenge seed');
    expect(() =>
      parseDailyReplay(
        { ...dailyReplay, challengeDate: '2026-08-26' },
        challenge,
      ),
    ).toThrow('does not match its challenge seed');
  });

  test('derives submitted metrics from the compact deterministic replay', () => {
    const challenge = getDailyChallengeForDate('2026-08-27');
    const level = getCampaignLevel(challenge.levelId);
    const run = createDailyRun(
      challenge,
      createLevelReplay(level, level.referenceSolution),
      {
        clientRunId: 'daily-run-0001',
        createdAt: '2026-08-27T12:00:00.000Z',
      },
    );

    expect(run.replay).toMatchObject({
      challengeId: challenge.id,
      simulationSeed: challenge.seed,
      levelReplay: { levelId: challenge.levelId },
    });
    expect(run.metrics).toMatchObject({
      threadUsed: level.referenceSolution[0].threadCost,
      stitchesUsed: level.referenceSolution.length,
      collectedPatch: false,
    });
    expect(run.metrics.completionMs).toBeGreaterThan(0);
  });

  test('ranks by thread, then stitches, then completion time without patch priority', () => {
    const metrics = (
      threadUsed: number,
      stitchesUsed: number,
      completionMs: number,
      collectedPatch = false,
    ): RunMetrics => ({ threadUsed, stitchesUsed, completionMs, collectedPatch });

    expect(compareDailyMetrics(metrics(70, 2, 1000), metrics(71, 1, 100))).toBeLessThan(0);
    expect(compareDailyMetrics(metrics(70, 1, 1200), metrics(70, 2, 100))).toBeLessThan(0);
    expect(compareDailyMetrics(metrics(70, 1, 900), metrics(70, 1, 1000))).toBeLessThan(0);
    expect(compareDailyMetrics(metrics(70, 1, 900), metrics(70, 1, 900, true))).toBe(0);
  });
});
