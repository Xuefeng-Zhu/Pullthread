/** @jest-environment node */
import { describe, expect, test } from '@jest/globals';

import { createWorldEndlessRun, launchEndless, nextEndlessTargets, stepEndless, type EndlessRun, type OwnedSection } from '../endless';
import { clampEndlessPull } from '../launchInput';
import { predictEndlessLaunch } from '../prediction';
import type { IntroducedMechanic } from '../progression';
import { pocketPosition, windAccelerationAt } from '../simulation';
import { cloneEndlessRun, serializeEndlessRun } from '../snapshots';
import { solveSectionEdge } from '../testing/sectionSolver';
import type { LaunchPoint } from '../types';

/** Quickly reach a generated lesson through real scored arrivals, then settle its camera. */
function catchPocket(run: EndlessRun, pocketId: string): void {
  const pocket = run.room.pockets.find((candidate) => candidate.id === pocketId)!;
  const position = pocketPosition(pocket, run.state.tick + 1);
  Object.assign(run.state, { phase: 'flying', position: { x: position.x, y: position.y - 2 },
    velocity: { x: 0, y: 480 }, sourcePocketImmune: false });
  expect(stepEndless(run)).toContainEqual({ type: 'catch', id: pocket.id, tick: run.state.tick });
  for (let tick = 0; tick < 120; tick += 1) stepEndless(run);
}

function lesson(mechanic: IntroducedMechanic): { run: EndlessRun; section: OwnedSection } {
  const run = createWorldEndlessRun(0);
  for (let catchIndex = 0; catchIndex < 120; catchIndex += 1) {
    const section = run.sectionProgress!.sections.find((candidate) => candidate.introduction === mechanic
      && candidate.entryPocketId === run.state.pocketId);
    if (section) return { run, section };
    const targets = nextEndlessTargets(run);
    const next = run.room.pockets.find((pocket) => targets.includes(pocket.id) && pocket.route !== 'reward')
      ?? run.room.pockets.find((pocket) => targets.includes(pocket.id))!;
    catchPocket(run, next.id);
  }
  throw new Error(`No generated ${mechanic} lesson encountered`);
}

function assertPredictionMatches(run: EndlessRun, pull: LaunchPoint) {
  const before = serializeEndlessRun(run);
  const predicted = predictEndlessLaunch(run, pull);
  const actual = cloneEndlessRun(run);
  const clamped = clampEndlessPull(pull, actual.state.position, actual.cameraY, actual.room.bounds);
  expect(launchEndless(actual, clamped)).toBe(true);
  const points = [{ ...actual.state.position }];
  const bounces: { x: number; y: number; tick: number; id: string }[] = [];
  let windyTicks = 0;
  for (let tick = 1; tick <= predicted.ticks; tick += 1) {
    if (windAccelerationAt(actual.room.windZones, actual.state.position)) windyTicks += 1;
    const events = stepEndless(actual);
    const bounced = events.filter((event) => event.type === 'bounce');
    bounced.forEach((event) => bounces.push({ ...actual.state.position, tick: event.tick, id: event.id }));
    if (tick % 4 === 0 || bounced.length || events.some((event) => event.type === 'catch' || event.type === 'fail')) {
      points.push({ ...actual.state.position });
    }
  }
  expect(predicted.points).toEqual(points);
  expect(predicted.bounces).toEqual(bounces);
  expect(predicted.outcome).toBe(actual.state.phase === 'held' ? 'catch' : actual.state.phase === 'failed' ? 'fail' : 'horizon');
  expect(predicted.pocketId).toBe(actual.state.phase === 'held' ? actual.state.pocketId : undefined);
  expect(predicted.failure).toBe(actual.state.failure);
  expect(serializeEndlessRun(run)).toBe(before);
  return { predicted, actual, windyTicks };
}

describe('world mechanics in full flight Preview', () => {
  test('the real generated wind lesson bends Preview and flight identically without spending tools or changing its checkpoint', () => {
    const { run, section } = lesson('wind');
    run.previewActive = true;
    run.inventory.preview = 3;
    const rewardEdges = section.connections.filter((edge) => run.room.pockets.find((pocket) => pocket.id === edge.to)?.route === 'reward');
    let exposed = 0;
    for (const edge of rewardEdges) {
      const attempt = cloneEndlessRun(run);
      if (edge.from !== attempt.state.pocketId) catchPocket(attempt, edge.from);
      const input = solveSectionEdge(attempt.room, attempt.state, edge.to, { perturbation: 0 });
      for (let tick = 0; tick < input.waitTicks; tick += 1) stepEndless(attempt);
      const { predicted, windyTicks } = assertPredictionMatches(attempt, input.pull);
      expect(predicted.pocketId).toBe(edge.to);
      exposed += windyTicks;
    }
    expect(exposed).toBeGreaterThan(0);
  });

  test('Preview includes the actual stronger spring bank in the generated workshop lesson', () => {
    const { run, section } = lesson('spring');
    const target = run.room.pockets.find((pocket) => section.pocketIds.includes(pocket.id) && pocket.route === 'reward')!;
    // Removing wall rebounds from the search requires a spool contact; the
    // predicted and actual runs retain the real walls and all section geometry.
    const input = solveSectionEdge({ ...run.room, sideWallRestitution: undefined }, run.state, target.id,
      { perturbation: 0, requireBounce: true });
    for (let tick = 0; tick < input.waitTicks; tick += 1) stepEndless(run);
    const { predicted } = assertPredictionMatches(run, input.pull);
    expect(predicted.pocketId).toBe(target.id);
    expect(predicted.bounces.some((bounce) => section.bumperIds.includes(bounce.id))).toBe(true);
  });

  test('scissors collision outcomes and Preview stay aligned through the full sweep', () => {
    const { run, section } = lesson('scissors');
    const rewards = run.room.pockets.filter((pocket) => section.pocketIds.includes(pocket.id) && pocket.route === 'reward')
      .sort((a, b) => b.center.y - a.center.y);
    catchPocket(run, rewards[0].id);
    const input = solveSectionEdge(run.room, run.state, rewards[1].id, { perturbation: 0 });
    const outcomes = new Set<string>();
    for (let phase = 0; phase < 600; phase += 30) {
      const delayed = cloneEndlessRun(run);
      for (let tick = 0; tick < phase; tick += 1) stepEndless(delayed);
      const { predicted } = assertPredictionMatches(delayed, input.pull);
      outcomes.add(predicted.failure ?? predicted.outcome);
    }
    expect(outcomes).toContain('catch');
    expect(outcomes).toContain('hazard');
  });
});
