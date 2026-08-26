import { test } from '@jest/globals';

import { releaseSimulation, stepSimulation } from '../../core/simulation';
import type { Point, Stitch } from '../../core/types';
import { createLevelSimulation, createLevelWorld, getCampaignLevel } from '../levelLoader';
import type { LevelDefinition } from '../schema';

function run(level: LevelDefinition, stitches: readonly Stitch[]) {
  const state = createLevelSimulation(level);
  const world = createLevelWorld(level, stitches);
  const points: Point[] = [];
  releaseSimulation(state);
  while (state.phase === 'running') {
    stepSimulation(state, world, level.physicsConfig);
    points.push({ ...state.traveler.position });
  }
  return { outcome: state.outcome, points };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

test.each([
  'attic-09-two-stitches',
  'festival-13-pinch-pocket',
  'festival-15-finale',
])('find unique full-route point for %s', (levelId) => {
  const source = getCampaignLevel(levelId);
  const level: LevelDefinition = {
    ...source,
    goal: {
      center: { x: 0.06, y: 1.4 },
      radius: 0.015,
      maxEntrySpeed: 1.2,
    },
  };
  const full = run(level, level.referenceSolution);
  const alternatives = [
    run(level, []),
    ...level.referenceSolution.map((_, removedIndex) =>
      run(
        level,
        level.referenceSolution.filter((__, index) => index !== removedIndex),
      ),
    ),
  ];

  let best = { index: -1, point: { x: 0, y: 0 }, separation: -1 };
  for (const [index, point] of full.points.entries()) {
    if (point.x < 0.08 || point.x > 0.92 || point.y < 0.08 || point.y > 1.42) {
      continue;
    }
    const separation = Math.min(
      ...alternatives.map((alternative) =>
        Math.min(...alternative.points.map((other) => distance(point, other))),
      ),
    );
    if (separation > best.separation) best = { index, point, separation };
  }

  // eslint-disable-next-line no-console
  console.log(levelId, best, full.outcome, alternatives.map(({ outcome }) => outcome));
});
