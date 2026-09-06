import { describe, expect, test } from '@jest/globals';

import {
  advanceSimulation,
  createFixedStepClock,
  releaseSimulation,
} from '../../core/simulation';
import { CAMPAIGN_LEVELS } from '../../levels/campaignLevels';
import {
  createLevelSimulation,
  createLevelWorld,
} from '../../levels/levelLoader';
import {
  GAMEPLAY_PLAYBACK_RATE,
  scaleGameplayElapsed,
} from '../gameplayTiming';

function advanceRealFrame(realElapsedSeconds: number) {
  const level = CAMPAIGN_LEVELS[0];
  const state = createLevelSimulation(level);
  const world = createLevelWorld(level, level.referenceSolution);
  const clock = createFixedStepClock();
  releaseSimulation(state);

  const steps = advanceSimulation(
    clock,
    scaleGameplayElapsed(realElapsedSeconds),
    state,
    world,
    level.physicsConfig,
  );

  return { clock, steps };
}

describe('gameplay timing', () => {
  test('advances the traveler at the faster wall-clock playback rate', () => {
    expect(GAMEPLAY_PLAYBACK_RATE).toBe(2);
    expect(scaleGameplayElapsed(0.8)).toBeCloseTo(1.6, 10);
  });

  test.each([
    { label: '60 Hz', realElapsedSeconds: 1 / 60, expectedSteps: 4 },
    { label: '30 Hz', realElapsedSeconds: 1 / 30, expectedSteps: 8 },
    { label: '50 ms', realElapsedSeconds: 0.05, expectedSteps: 12 },
  ])(
    'keeps 2x playback exact through a $label real frame',
    ({ realElapsedSeconds, expectedSteps }) => {
      const { clock, steps } = advanceRealFrame(realElapsedSeconds);

      expect(steps).toBe(expectedSteps);
      expect(clock.accumulatorSeconds).toBeCloseTo(0, 12);
    },
  );
});
