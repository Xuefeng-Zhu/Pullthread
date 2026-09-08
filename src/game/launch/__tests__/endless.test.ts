/** @jest-environment node */
import { describe, expect, test } from '@jest/globals';

import {
  ENDLESS_HEIGHT,
  createLegacyEndlessRun as createEndlessRun,
  advanceEndless,
  launchEndless,
  nextEndlessChallenge,
  stepEndless,
} from '../endless';
import type { EndlessRun } from '../endless';
import type { ChallengeFamily } from '../challengeTypes';
import { clampEndlessPull } from '../launchInput';
import { createLaunchClock, LAUNCH_HZ, pocketPosition } from '../simulation';
import { ballisticPull, cloneRun, findNextInput, replayNext } from '../testing/routeSolver';
import type { LaunchEvent, LaunchInput } from '../types';

function finishFlight(run: EndlessRun) {
  const events: LaunchEvent[] = [];
  for (let tick = 0; tick < 1200 && run.state.phase === 'flying'; tick += 1) {
    events.push(...stepEndless(run));
  }
  return events;
}

function catchNext(run: EndlessRun) {
  const expected = run.nextPocketId;
  const challenge = nextEndlessChallenge(run);
  const events = replayNext(run, findNextInput(run));
  expect(run.state.phase).toBe('held');
  expect(run.state.pocketId).toBe(expected);
  if (challenge?.family === 'bank') expect(events.some((event) => event.type === 'bounce')).toBe(true);
}

describe('endless fabric climb', () => {
  test('starts with a generous familiar jump and never authors a completion pocket', () => {
    const run = createEndlessRun(7);
    expect(run.state.position).toEqual({ x: 80, y: 490 });
    expect(run.room.pockets.find((pocket) => pocket.id === run.nextPocketId)?.center).toEqual({ x: 240, y: 390 });
    expect(run.room.pockets.some((pocket) => pocket.kind === 'goal')).toBe(false);
    expect(launchEndless(run, { x: -24, y: 72 })).toBe(true);
    expect(finishFlight(run).map((event) => event.type)).toEqual(['catch']);
    expect(run.highestPocket).toBe(1);
    expect(run.pocketsCaught).toBe(1);
  });

  test('a seed reproduces its fabric and another seed changes the later routes', () => {
    expect(createEndlessRun(42).room).toEqual(createEndlessRun(42).room);
    expect(createEndlessRun(42).room.pockets).not.toEqual(createEndlessRun(43).room.pockets);
  });

  test.each(Array.from({ length: 32 }, (_, seed) => seed))('seed %i keeps both opening pulls forgiving with future geometry present', (seed) => {
    const run = createEndlessRun(seed);
    for (let opening = 1; opening <= 2; opening += 1) {
      // The near-vertical second pull aims into the right half of the generous
      // opening, keeping its incoming arc clear of the next lesson's thorns.
      const pull = opening === 1 ? ballisticPull(run, 72) : { x: -5, y: 77 };
      if (!pull) throw new Error(`Opening ${run.nextPocketId} has no centered input`);
      const expected = run.nextPocketId;
      // Preserve the entire generated room: cushions belonging to later flights
      // must not intercept an otherwise forgiving introduction.
      expect(run.room.bumpers.length).toBeGreaterThan(0);
      for (let x = -5; x <= 5; x += 1) {
        for (let y = -5; y <= 5; y += 1) {
          const attempt = cloneRun(run);
          const varied = { x: pull.x + x, y: pull.y + y };
          const events = replayNext(attempt, { waitTicks: 0, pull: varied });
          expect({ seed, target: expected, pull: varied, phase: attempt.state.phase, pocket: attempt.state.pocketId })
            .toEqual({ seed, target: expected, pull: varied, phase: 'held', pocket: expected });
          expect(events.filter((event) => event.type !== 'pickup').map((event) => event.type)).toEqual(['catch']);
        }
      }
      replayNext(run, { waitTicks: 0, pull });
      expect(run.state.pocketId).toBe(expected);
    }
  });

  test.each(Array.from({ length: 16 }, (_, seed) => seed))('seed %i supplies 128 reachable pockets with bounded memory and capped difficulty', (seed) => {
    const run = createEndlessRun(seed);
    let previousCamera = run.cameraY;
    let previousFamily: ChallengeFamily | undefined;
    const introductions = new Set<ChallengeFamily>();
    for (let index = 1; index <= 128; index += 1) {
      const anchor = run.state.position;
      const challenge = nextEndlessChallenge(run);
      expect(challenge).toBeDefined();
      if (challenge?.family !== 'opening') expect(challenge?.family).not.toBe(previousFamily);
      previousFamily = challenge?.family;
      if (index >= 3 && index <= 5 && challenge) introductions.add(challenge.family);
      if ([6, 10, 14, 19].includes(index)) expect(challenge?.family).toBe('recovery');
      expect(challenge?.band).toBe(index < 7 ? 'intro' : index < 15 ? 'mixed' : 'expert');
      // Both immediate relaunches and pauses leave a full-strength pull inside the visible floor.
      expect(anchor.y + 100).toBeLessThan(run.cameraY + ENDLESS_HEIGHT);
      catchNext(run);
      expect(run.highestPocket).toBe(index);
      expect(run.pocketsCaught).toBe(index);
      expect(run.cameraY).toBeLessThanOrEqual(previousCamera);
      previousCamera = run.cameraY;
      expect(run.room.pockets.length).toBeLessThanOrEqual(8);
      expect(run.challenges.length).toBeLessThanOrEqual(8);
      expect(run.room.bumpers.length).toBeLessThanOrEqual(8);
      expect(run.room.hazards.length).toBeLessThanOrEqual(16);
      expect(run.room.pickups!.length).toBeLessThanOrEqual(4);
      expect(run.collectedPickupIds.length).toBeLessThanOrEqual(4);
      expect(run.lastCatchSnapshot).not.toHaveProperty('lastCatchSnapshot');
      expect(run.room.pockets.some((pocket) => pocket.id === run.state.pocketId)).toBe(true);
      expect(run.room.pockets.some((pocket) => pocket.id === run.nextPocketId)).toBe(true);
      for (const pocket of run.room.pockets) {
        expect(pocket.kind).not.toBe('goal');
        if (pocket.kind !== 'start') expect(pocket.width).toBeGreaterThanOrEqual(76);
        expect(pocket.width).toBeLessThanOrEqual(144);
        if (pocket.motion) {
          expect(pocket.motion.amplitude).toBeLessThanOrEqual(72);
          expect(pocket.motion.periodTicks).toBeGreaterThanOrEqual(360);
          expect(pocketPosition(pocket, run.state.tick).x - pocket.width / 2).toBeGreaterThanOrEqual(0);
          expect(pocketPosition(pocket, run.state.tick).x + pocket.width / 2).toBeLessThanOrEqual(360);
        }
      }
      for (let wait = 0; wait < (seed * 29 + index * 13) % 120; wait += 1) stepEndless(run);
    }
    expect([...introductions].sort()).toEqual(['arc', 'bank', 'timing']);
    expect(run.height).toBeGreaterThan(15_000);
    expect(run.nextPocketIndex).toBe(134);
  });

  test('the first challenge set introduces moving receivers, bank cushions and interior thorns', () => {
    const run = createEndlessRun(12);
    expect(run.room.pockets.some((pocket) => pocket.motion)).toBe(true);
    expect(run.room.bumpers.length).toBeGreaterThan(0);
    expect(run.room.hazards.length).toBeGreaterThan(0);
    expect(run.room.hazards.some((hazard) => hazard.center.x > 12 && hazard.center.x < 348)).toBe(true);
    expect(run.challenges.filter((challenge) => challenge.index >= 3).map((challenge) => challenge.family).sort())
      .toEqual(['arc', 'bank', 'timing']);
  });

  test('a moving pocket freezes at its caught location and becomes a stable launch anchor', () => {
    const run = createEndlessRun(9);
    for (let index = 0; index < 5 && nextEndlessChallenge(run)?.family !== 'timing'; index += 1) catchNext(run);
    const receiver = run.room.pockets.find((pocket) => pocket.id === run.nextPocketId);
    expect(receiver?.motion).toBeDefined();
    catchNext(run);
    const caught = run.room.pockets.find((pocket) => pocket.id === run.state.pocketId);
    expect(caught?.motion).toBeUndefined();
    const position = { ...run.state.position };
    for (let tick = 0; tick < 600; tick += 1) stepEndless(run);
    expect(run.state.position).toEqual(position);
    expect(caught?.center).toEqual(position);
  });

  test('aiming can freeze the camera while the receiver clock continues normally', () => {
    const run = createEndlessRun(8);
    catchNext(run);
    const camera = run.cameraY;
    const receiver = run.room.pockets.find((pocket) => pocket.motion)!;
    const before = pocketPosition(receiver, run.state.tick);
    for (let tick = 0; tick < 120; tick += 1) stepEndless(run, true);
    expect(run.cameraY).toBe(camera);
    expect(pocketPosition(receiver, run.state.tick)).not.toEqual(before);
    catchNext(run);
  });

  test('returning to a pocket does not farm score or repeat the same height reward', () => {
    const run = createEndlessRun(2);
    for (let repeat = 0; repeat < 2; repeat += 1) {
      expect(launchEndless(run, { x: 0, y: 60 })).toBe(true);
      finishFlight(run);
      expect(run.state.phase).toBe('held');
      expect(run.highestPocket).toBe(0);
      expect(run.pocketsCaught).toBe(0);
    }
    const height = run.height;
    expect(launchEndless(run, { x: 0, y: 60 })).toBe(true);
    finishFlight(run);
    expect(run.height).toBe(height);
    expect(run.nextPocketId).toBe('endless-1');
  });

  test('skipping a pocket counts the actual advancing catch once, and revisits add nothing', () => {
    const run = createEndlessRun(0);
    // This taller diagonal skips the first opening and lands in the second.
    expect(launchEndless(run, { x: -20, y: 95 })).toBe(true);
    finishFlight(run);
    expect(run.state.phase).toBe('held');
    expect(run.highestPocket).toBe(2);
    expect(run.pocketsCaught).toBe(1);
    expect(run.nextPocketId).toBe('endless-3');
    expect(launchEndless(run, { x: 0, y: 40 })).toBe(true);
    finishFlight(run);
    expect(run.state.phase).toBe('held');
    expect(run.highestPocket).toBe(2);
    expect(run.pocketsCaught).toBe(1);
  });

  test('falling below the camera floor ends the run permanently', () => {
    const run = createEndlessRun(4);
    catchNext(run);
    for (let tick = 0; tick < 120; tick += 1) stepEndless(run);
    run.state.phase = 'flying';
    run.state.position = { x: 180, y: run.cameraY + ENDLESS_HEIGHT + 1 };
    run.state.velocity = { x: 0, y: 20 };
    expect(stepEndless(run)).toContainEqual({ type: 'fail', tick: run.state.tick, reason: 'out_of_bounds' });
    expect(run.state.phase).toBe('failed');
    const tick = run.state.tick;
    const position = { ...run.state.position };
    for (let wait = 0; wait < 1000; wait += 1) stepEndless(run);
    expect(run.state.tick).toBe(tick);
    expect(run.state.position).toEqual(position);
    expect(launchEndless(run, { x: -24, y: 72 })).toBe(false);
  });

  test('the horizontal sides stay fatal while negative world heights are open', () => {
    const offside = createEndlessRun(0);
    expect(launchEndless(offside, { x: -100, y: 0 })).toBe(true);
    finishFlight(offside);
    expect(offside.state.phase).toBe('failed');
    expect(offside.state.failure).toBe('out_of_bounds');

    const above = createEndlessRun(0);
    above.state.phase = 'flying';
    above.state.position = { x: 180, y: -200 };
    above.state.velocity = { x: 0, y: -100 };
    stepEndless(above);
    expect(above.state.phase).toBe('flying');
    expect(above.state.position.y).toBeLessThan(-200);
  });

  test('endless flights have no eight-second timeout', () => {
    const run = createEndlessRun(0);
    run.room = { ...run.room, gravity: 0, pockets: [run.room.pockets[0]], bumpers: [], hazards: [] };
    run.state.phase = 'flying';
    run.state.position = { x: 180, y: 250 };
    run.state.velocity = { x: 0, y: 0 };
    for (let tick = 0; tick < 1500; tick += 1) stepEndless(run, true);
    expect(run.state.phase).toBe('flying');
    expect(run.state.flightTicks).toBe(1500);
  });

  test('a fixed seed and catches reproduce the same result at 30, 60 and 120 rendering FPS', () => {
    const authored = createEndlessRun(1234);
    const inputs: LaunchInput[] = [];
    for (let pocket = 0; pocket < 20; pocket += 1) {
      const input = findNextInput(authored);
      inputs.push({ tick: authored.state.tick + input.waitTicks, pocketId: authored.state.pocketId, pull: input.pull });
      replayNext(authored, input);
      expect(authored.highestPocket).toBe(pocket + 1);
    }
    const finalTick = Math.ceil((authored.state.tick + 600) / 4) * 4;
    const outcomes = [30, 60, 120].map((fps) => {
      const run = createEndlessRun(1234);
      const clock = createLaunchClock();
      let inputIndex = 0;
      for (let frameTick = LAUNCH_HZ / fps; frameTick <= finalTick; frameTick += LAUNCH_HZ / fps) {
        // Split only at recorded input ticks. A render frame may contain a catch,
        // wait, and relaunch; every FPS receives the exact same actions and clock.
        while (inputIndex < inputs.length && inputs[inputIndex].tick <= frameTick) {
          const input = inputs[inputIndex++];
          advanceEndless(run, clock, (input.tick - run.state.tick) / LAUNCH_HZ);
          expect(run.state.pocketId).toBe(input.pocketId);
          expect(launchEndless(run, clampEndlessPull(input.pull, run.state.position, run.cameraY, run.room.bounds))).toBe(true);
        }
        advanceEndless(run, clock, (frameTick - run.state.tick) / LAUNCH_HZ);
      }
      expect(run.highestPocket).toBe(20);
      return { state: run.state, camera: run.cameraY, height: run.height, room: run.room };
    });
    expect(outcomes[0]).toEqual(outcomes[1]);
    expect(outcomes[1]).toEqual(outcomes[2]);
  });
});
