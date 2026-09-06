import { describe, expect, test } from '@jest/globals';

import { calculateThreadCost } from '../../core/scoring';
import { releaseSimulation, stepSimulation } from '../../core/simulation';
import type { Stitch } from '../../core/types';
import { createStitch } from '../../input/stitchGesture';
import {
  createLevelSimulation,
  createLevelWorld,
  getCampaignLevel,
  getLevelVersion,
} from '../../levels/levelLoader';
import {
  createLevelReplay,
  deserializeLevelReplay,
  LEVEL_REPLAY_SCHEMA_VERSION,
  parseLevelReplay,
  serializeLevelReplay,
  simulateLevelReplay,
} from '../levelReplay';

const firstLevel = getCampaignLevel('bedroom-01-first-pull');
const pocketLevel = getCampaignLevel('attic-07-pocket-catch');
const mixedLevel = getCampaignLevel('festival-13-pinch-pocket');
const legacyEdgeLevel = getLevelVersion('bedroom-02-edge-redirect', 1);
const firstNarrowingCrosscutLevel = getLevelVersion(
  'attic-08-felt-and-silk',
  3,
);

function canonicalReferenceStitches(
  level: typeof firstLevel,
): readonly Stitch[] {
  return level.referenceSolution.map((stitch) =>
    createStitch(stitch.id, stitch.type, stitch.start, stitch.end),
  );
}

function replayObject(
  level = pocketLevel,
  stitches: readonly unknown[] = canonicalReferenceStitches(level),
) {
  return {
    schemaVersion: LEVEL_REPLAY_SCHEMA_VERSION,
    levelId: level.id,
    levelVersion: level.version,
    stitches,
  };
}

function directRun(level: typeof firstLevel, stitches: readonly Stitch[]) {
  const simulation = createLevelSimulation(level);
  const world = createLevelWorld(level, stitches);
  const points = [{ ...simulation.traveler.position }];

  releaseSimulation(simulation);
  while (simulation.phase === 'running') {
    stepSimulation(simulation, world, level.physicsConfig);
    if (simulation.tick % 8 === 0 || simulation.phase !== 'running') {
      points.push({ ...simulation.traveler.position });
    }
  }

  return {
    points,
    outcome: simulation.outcome,
    finalPosition: { ...simulation.traveler.position },
  };
}

describe('campaign replay records', () => {
  test.each([
    firstLevel,
    legacyEdgeLevel,
    firstNarrowingCrosscutLevel,
    pocketLevel,
    mixedLevel,
  ])(
    'round-trips and deterministically reproduces $id',
    (level) => {
      const stitches = canonicalReferenceStitches(level);
      const replay = createLevelReplay(level, stitches);
      const restored = deserializeLevelReplay(serializeLevelReplay(replay));
      const anchor = simulateLevelReplay(restored);

      expect(restored).toEqual(replay);
      expect(anchor).toEqual(directRun(level, stitches));
      for (let run = 0; run < 10; run += 1) {
        expect(simulateLevelReplay(restored)).toEqual(anchor);
      }
    },
  );

  test('accepts pocket stitches and returns a detached, deeply frozen record', () => {
    const source = canonicalReferenceStitches(pocketLevel).map((stitch) => ({
      ...stitch,
      start: { ...stitch.start },
      end: { ...stitch.end },
    }));
    const replay = createLevelReplay(pocketLevel, source);

    source[0].start.x = 0;
    source.length = 0;

    expect(replay.stitches[0]).toMatchObject({ type: 'pocket', radius: 0.24 });
    expect(Object.isFrozen(replay)).toBe(true);
    expect(Object.isFrozen(replay.stitches)).toBe(true);
    expect(Object.isFrozen(replay.stitches[0])).toBe(true);
    expect(Object.isFrozen(replay.stitches[0].start)).toBe(true);
    expect(Object.isFrozen(replay.stitches[0].end)).toBe(true);
  });

  test.each([
    ['unknown level', { ...replayObject(), levelId: 'missing-level' }],
    ['stale level version', { ...replayObject(), levelVersion: 999 }],
    [
      'disallowed stitch type',
      replayObject(firstLevel, [
        createStitch('wrong-type', 'pocket', { x: 0.2, y: 0.2 }, { x: 0.4, y: 0.4 }),
      ]),
    ],
    [
      'wrong stitch radius',
      replayObject(pocketLevel, [
        { ...canonicalReferenceStitches(pocketLevel)[0], radius: 0.19 },
      ]),
    ],
    [
      'forged thread cost',
      replayObject(pocketLevel, [
        { ...canonicalReferenceStitches(pocketLevel)[0], threadCost: 1 },
      ]),
    ],
    [
      'out-of-bounds endpoint',
      replayObject(pocketLevel, [
        {
          ...canonicalReferenceStitches(pocketLevel)[0],
          end: { x: 2, y: 0.5 },
        },
      ]),
    ],
    [
      'non-canonical endpoint precision',
      replayObject(pocketLevel, [
        {
          ...canonicalReferenceStitches(pocketLevel)[0],
          start: { x: 0.230001, y: 0.100001 },
          end: { x: 0.230001, y: 1.000001 },
          threadCost: calculateThreadCost(
            { x: 0.230001, y: 0.100001 },
            { x: 0.230001, y: 1.000001 },
          ),
        },
      ]),
    ],
    [
      'empty stitch id',
      replayObject(pocketLevel, [
        { ...canonicalReferenceStitches(pocketLevel)[0], id: '' },
      ]),
    ],
    [
      'duplicate stitch ids',
      replayObject(mixedLevel, [
        createStitch('same', 'pinch', { x: 0.1, y: 0.1 }, { x: 0.1, y: 0.4 }),
        createStitch('same', 'pocket', { x: 0.5, y: 0.5 }, { x: 0.7, y: 0.5 }),
      ]),
    ],
    [
      'stitch-count overflow',
      replayObject(pocketLevel, [
        createStitch('one', 'pocket', { x: 0.2, y: 0.2 }, { x: 0.4, y: 0.2 }),
        createStitch('two', 'pocket', { x: 0.5, y: 0.5 }, { x: 0.7, y: 0.5 }),
      ]),
    ],
    [
      'thread-budget overflow',
      replayObject(pocketLevel, [
        createStitch('expensive', 'pocket', { x: 0, y: 0 }, { x: 1, y: 1.5 }),
      ]),
    ],
  ])('rejects %s', (_label, malformed) => {
    expect(() => parseLevelReplay(malformed)).toThrow();
  });

  test('reports the canonical-quantization boundary explicitly', () => {
    const reference = canonicalReferenceStitches(pocketLevel)[0];
    const unquantized = replayObject(pocketLevel, [
      {
        ...reference,
        start: { x: reference.start.x + 0.000001, y: reference.start.y },
        threadCost: calculateThreadCost(
          { x: reference.start.x + 0.000001, y: reference.start.y },
          reference.end,
        ),
      },
    ]);

    expect(() => parseLevelReplay(unquantized)).toThrow(
      'canonical quantized coordinates',
    );
  });

  test('recomputes canonical costs before enforcing the level budget', () => {
    const start = { x: 0, y: 0 };
    const end = { x: 1, y: 1.5 };
    const expensive = createStitch('expensive', 'pocket', start, end);

    expect(expensive.threadCost).toBe(calculateThreadCost(start, end));
    expect(expensive.threadCost).toBeGreaterThan(pocketLevel.threadBudget);
    expect(() => createLevelReplay(pocketLevel, [expensive])).toThrow(
      'thread budget',
    );
  });
});
