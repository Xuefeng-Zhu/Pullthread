import { describe, expect, test } from '@jest/globals';

import {
  releaseSimulation,
  stepSimulation,
} from '../../core/simulation';
import type { Stitch } from '../../core/types';
import { createStitch } from '../../input/stitchGesture';
import {
  createSpikeSimulation,
  createSpikeWorld,
  REFERENCE_PINCH_STITCH,
  SPIKE_LEVEL,
  SPIKE_PHYSICS_CONFIG,
} from '../../levels/spikeLevel';
import {
  createSpikeReplay,
  deserializeSpikeReplay,
  parseSpikeReplay,
  serializeSpikeReplay,
  simulateSpikeReplay,
  SPIKE_REPLAY_SCHEMA_VERSION,
} from '../spikeReplay';

function directRun(stitches: readonly Stitch[], sampleEveryTicks = 8) {
  const simulation = createSpikeSimulation();
  const world = createSpikeWorld(stitches);
  const points = [{ ...simulation.traveler.position }];

  releaseSimulation(simulation);
  while (simulation.phase === 'running') {
    stepSimulation(simulation, world, SPIKE_PHYSICS_CONFIG);
    if (
      simulation.tick % sampleEveryTicks === 0 ||
      simulation.phase !== 'running'
    ) {
      points.push({ ...simulation.traveler.position });
    }
  }

  return {
    points,
    outcome: simulation.outcome,
    finalPosition: { ...simulation.traveler.position },
  };
}

function replayObject(stitches: readonly unknown[] = [REFERENCE_PINCH_STITCH]) {
  return {
    schemaVersion: SPIKE_REPLAY_SCHEMA_VERSION,
    levelId: SPIKE_LEVEL.id,
    levelVersion: SPIKE_LEVEL.version,
    stitches,
  };
}

describe('spike replay records', () => {
  test('round-trips through JSON without changing the deterministic run', () => {
    const replay = createSpikeReplay([REFERENCE_PINCH_STITCH]);
    const restored = deserializeSpikeReplay(serializeSpikeReplay(replay));

    expect(restored).toEqual(replay);
    expect(simulateSpikeReplay(restored)).toEqual(simulateSpikeReplay(replay));
    expect(JSON.parse(JSON.stringify(replay))).toEqual(replay);
  });

  test('deep-copies and freezes authored inputs', () => {
    const authored = createStitch(
      'mutable-stitch',
      'pinch',
      { x: 0.23, y: 0.1 },
      { x: 0.23, y: 1 },
    );
    const mutableStitch = {
      ...authored,
      start: { ...authored.start },
      end: { ...authored.end },
    };
    const source = [mutableStitch];
    const replay = createSpikeReplay(source);

    mutableStitch.start.x = 0.8;
    source.length = 0;

    expect(replay.stitches[0].start.x).toBe(authored.start.x);
    expect(replay.stitches).toHaveLength(1);
    expect(Object.isFrozen(replay)).toBe(true);
    expect(Object.isFrozen(replay.stitches)).toBe(true);
    expect(Object.isFrozen(replay.stitches[0])).toBe(true);
    expect(Object.isFrozen(replay.stitches[0].start)).toBe(true);
  });

  test.each([
    ['non-object replay', null],
    ['unknown schema', { ...replayObject(), schemaVersion: 2 }],
    ['unknown level', { ...replayObject(), levelId: 'other-level' }],
    ['unknown level version', { ...replayObject(), levelVersion: 2 }],
    ['non-array stitches', { ...replayObject(), stitches: null }],
    [
      'unsupported stitch type',
      replayObject([{ ...REFERENCE_PINCH_STITCH, type: 'pocket' }]),
    ],
    [
      'non-finite coordinate',
      replayObject([
        {
          ...REFERENCE_PINCH_STITCH,
          start: { ...REFERENCE_PINCH_STITCH.start, x: Number.NaN },
        },
      ]),
    ],
    [
      'out-of-bounds coordinate',
      replayObject([
        {
          ...REFERENCE_PINCH_STITCH,
          start: { ...REFERENCE_PINCH_STITCH.start, x: -0.1 },
        },
      ]),
    ],
    [
      'forged thread cost',
      replayObject([{ ...REFERENCE_PINCH_STITCH, threadCost: 1 }]),
    ],
    [
      'non-authored tension',
      replayObject([{ ...REFERENCE_PINCH_STITCH, tension: 0.5 }]),
    ],
    [
      'non-authored radius',
      replayObject([{ ...REFERENCE_PINCH_STITCH, radius: 0.2 }]),
    ],
    [
      'too-short stitch',
      replayObject([
        {
          ...REFERENCE_PINCH_STITCH,
          start: { x: 0.23, y: 0.1 },
          end: { x: 0.23, y: 0.11 },
          threadCost: 1,
        },
      ]),
    ],
    [
      'duplicate ids',
      replayObject([REFERENCE_PINCH_STITCH, REFERENCE_PINCH_STITCH]),
    ],
  ])('rejects %s', (_label, malformed) => {
    expect(() => parseSpikeReplay(malformed)).toThrow();
  });

  test('rejects invalid playback sample intervals', () => {
    const replay = createSpikeReplay([REFERENCE_PINCH_STITCH]);

    expect(() => simulateSpikeReplay(replay, 0)).toThrow(RangeError);
    expect(() => simulateSpikeReplay(replay, 1.5)).toThrow(RangeError);
  });

  test('matches the live fixed-step run and remains exact across 30 replays', () => {
    const referenceReplay = createSpikeReplay([REFERENCE_PINCH_STITCH]);
    const baselineReplay = createSpikeReplay([]);
    const referenceAnchor = simulateSpikeReplay(referenceReplay);
    const baselineAnchor = simulateSpikeReplay(baselineReplay);

    expect(referenceAnchor).toEqual(directRun([REFERENCE_PINCH_STITCH]));
    expect(baselineAnchor).toEqual(directRun([]));
    expect(referenceAnchor.outcome.status).toBe('success');
    expect(baselineAnchor.outcome).toMatchObject({
      status: 'failure',
      reason: 'out_of_bounds',
    });

    for (let run = 0; run < 30; run += 1) {
      expect(simulateSpikeReplay(referenceReplay)).toEqual(referenceAnchor);
      expect(simulateSpikeReplay(baselineReplay)).toEqual(baselineAnchor);
    }
  });
});
