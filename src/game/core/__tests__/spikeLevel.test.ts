import { describe, expect, test } from '@jest/globals';

import {
  createSpikeSimulation,
  createSpikeWorld,
  REFERENCE_PINCH_STITCH,
  SPIKE_LEVEL,
  SPIKE_PHYSICS_CONFIG,
} from '../../levels/spikeLevel';
import { releaseSimulation, stepSimulation } from '../simulation';
import type { Stitch } from '../types';

function runSpike(stitches: readonly Stitch[]) {
  const state = createSpikeSimulation();
  const world = createSpikeWorld(stitches);
  releaseSimulation(state);

  while (state.phase === 'running') {
    stepSimulation(state, world, SPIKE_PHYSICS_CONFIG);
  }

  return state;
}

describe('First Pull technical spike', () => {
  test('a reference pinch changes failure into success from the same start', () => {
    const baselineStart = createSpikeSimulation().traveler.position;
    const stitchedStart = createSpikeSimulation().traveler.position;
    const baseline = runSpike([]);
    const stitched = runSpike([REFERENCE_PINCH_STITCH]);

    expect(baselineStart).toEqual(stitchedStart);
    expect(baseline.outcome).toMatchObject({
      status: 'failure',
      reason: 'out_of_bounds',
    });
    expect(stitched.outcome?.status).toBe('success');
    expect(REFERENCE_PINCH_STITCH.threadCost).toBeLessThanOrEqual(
      SPIKE_LEVEL.threadBudget,
    );
  });

  test('replays baseline and reference inputs exactly across 30 runs', () => {
    const baselineAnchor = runSpike([]);
    const referenceAnchor = runSpike([REFERENCE_PINCH_STITCH]);

    expect(referenceAnchor.traveler.position.x).not.toBe(
      baselineAnchor.traveler.position.x,
    );

    for (let run = 0; run < 30; run += 1) {
      expect(runSpike([])).toEqual(baselineAnchor);
      expect(runSpike([REFERENCE_PINCH_STITCH])).toEqual(referenceAnchor);
    }
  });

  test('exposes the accepted visible level limits', () => {
    expect(SPIKE_LEVEL).toMatchObject({
      name: 'First Pull',
      maxStitches: 2,
      threadBudget: 120,
    });
  });
});
