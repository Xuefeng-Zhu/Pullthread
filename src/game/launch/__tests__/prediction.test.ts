/** @jest-environment node */
import { describe, expect, test } from '@jest/globals';
import { createEndlessRun, launchEndless, nextEndlessChallenge, stepEndless } from '../endless';
import { predictEndlessLaunch } from '../prediction';
import { clampEndlessPull } from '../launchInput';
import { cloneEndlessRun, serializeEndlessRun } from '../snapshots';
import { findNextInput, replayNext } from '../testing/routeSolver';

describe('full flight Preview', () => {
  test('uses the real stretched release, catches and camera while leaving all live data untouched', () => {
    const run = createEndlessRun(42);
    run.previewActive = true;
    run.inventory.preview = 3;
    const before = serializeEndlessRun(run);
    const pull = { x: -24, y: 72 };
    const predicted = predictEndlessLaunch(run, pull);
    const actual = cloneEndlessRun(run);
    launchEndless(actual, pull);
    expect(predicted.points[0]).toEqual(actual.state.position);
    for (let tick = 0; tick < predicted.ticks; tick += 1) stepEndless(actual);
    expect(predicted.outcome).toBe('catch');
    expect(predicted.pocketId).toBe(actual.state.pocketId);
    expect(predicted.points.at(-1)).toEqual(actual.state.position);
    expect(predicted.points.length).toBeLessThan(250);
    expect(serializeEndlessRun(run)).toBe(before);
  });

  test('predicts swept banks and moving release phases using the exact production engine', () => {
    const run = createEndlessRun(0);
    let testedBank = false;
    let testedTiming = false;
    for (let index = 0; index < 6; index += 1) {
      const challenge = nextEndlessChallenge(run)!;
      const input = findNextInput(run);
      for (let wait = 0; wait < input.waitTicks; wait += 1) stepEndless(run);
      const prediction = predictEndlessLaunch(run, input.pull);
      expect(prediction.outcome).toBe('catch');
      expect(prediction.pocketId).toBe(run.nextPocketId);
      if (challenge.family === 'bank') {
        testedBank = true;
        expect(prediction.bounces.length).toBeGreaterThan(0);
      }
      if (challenge.family === 'timing') {
        testedTiming = true;
        const outcomes = new Set<string>();
        for (let phase = 0; phase < 360; phase += 12) {
          const delayed = cloneEndlessRun(run);
          delayed.state.tick += phase;
          const result = predictEndlessLaunch(delayed, input.pull);
          outcomes.add(`${result.outcome}:${result.pocketId}`);
          const actual = cloneEndlessRun(delayed);
          launchEndless(actual, clampEndlessPull(input.pull, actual.state.position, actual.cameraY, actual.room.bounds));
          for (let tick = 0; tick < result.ticks; tick += 1) stepEndless(actual);
          expect(result.points.at(-1)).toEqual(actual.state.position);
        }
        expect(outcomes.size).toBeGreaterThan(1);
      }
      replayNext(run, { ...input, waitTicks: 0 });
    }
    expect(testedBank && testedTiming).toBe(true);
  });

  test('does not award a predicted collectible, consume tools, or overwrite the revive checkpoint', () => {
    const run = createEndlessRun(0);
    run.room = { ...run.room, pickups: [{ id: 'endless-pickup-2', kind: 'preview', center: { x: 56, y: 562 }, radius: 10 }] };
    const before = cloneEndlessRun(run);
    expect(predictEndlessLaunch(run, { x: -24, y: 72 }).outcome).toBe('catch');
    expect(run).toEqual(before);
    const actual = cloneEndlessRun(run);
    replayNext(actual, { waitTicks: 0, pull: { x: -24, y: 72 } });
    expect(actual.inventory.preview).toBe(1);
    expect(run.inventory.preview).toBe(0);
  });

  test('reports lethal shots and an honest horizon without inventing an outcome', () => {
    const run = createEndlessRun(0);
    expect(predictEndlessLaunch(run, { x: -100, y: 0 })).toMatchObject({ outcome: 'fail', failure: 'out_of_bounds', horizon: false });
    expect(predictEndlessLaunch(run, { x: 0, y: 0 })).toMatchObject({ outcome: 'invalid', points: [], ticks: 0 });
    run.room = { ...run.room, gravity: 0, pockets: [run.room.pockets[0]], bumpers: [], hazards: [], pickups: [] };
    const result = predictEndlessLaunch(run, { x: 0, y: 8 });
    expect(result).toMatchObject({ outcome: 'horizon', horizon: true, ticks: 960 });
    expect(result.points).toHaveLength(241);
    expect(result.pocketId).toBeUndefined();
  });
});
