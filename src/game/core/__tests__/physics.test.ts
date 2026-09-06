import { describe, expect, test } from '@jest/globals';

import { createHeightField } from '../heightField';
import {
  DEFAULT_PHYSICS_CONFIG,
  detectCollectible,
  detectGoal,
  detectHazard,
  fabricRegionAtPoint,
  integrateTraveler,
  resolveBumperCollisions,
  type PhysicsConfig,
  type PhysicsWorld,
} from '../physics';
import {
  advanceSimulation,
  createFixedStepClock,
  createSimulation,
  releaseSimulation,
  resetSimulation,
  stepSimulation,
} from '../simulation';
import type { FabricRegion, Stitch, TravelerState } from '../types';

const bounds = { x: 0, y: 0, width: 10, height: 10 } as const;

function traveler(
  previousX = 5,
  currentX = 5,
  velocityX = 0,
): TravelerState {
  return {
    radius: 0.05,
    previousPosition: { x: previousX, y: 5 },
    position: { x: currentX, y: 5 },
    velocity: { x: velocityX, y: 0 },
  };
}

function config(overrides: Partial<PhysicsConfig> = {}): PhysicsConfig {
  return { ...DEFAULT_PHYSICS_CONFIG, ...overrides };
}

function worldForSurface(
  surface: ReturnType<typeof createHeightField>,
): PhysicsWorld {
  return {
    surface,
    bounds,
    goal: { center: { x: 9, y: 9 }, radius: 0.01, maxEntrySpeed: 1 },
    hazards: [],
  };
}

describe('traveler physics', () => {
  test('accelerates downhill from the analytic surface gradient', () => {
    const surface = createHeightField(2, 2, bounds, (x) => x * 0.1);
    const state = traveler();

    integrateTraveler(
      state,
      surface,
      config({ rollingFriction: 0 }),
      { height: 0, gradientX: 0, gradientY: 0 },
    );

    expect(state.velocity.x).toBeLessThan(0);
    expect(state.velocity.y).toBe(0);
    expect(state.position.x).toBeLessThan(5);
  });

  test('rolling friction removes speed and can bring a traveler to rest', () => {
    const surface = createHeightField(2, 2, bounds);
    const moving = traveler(5, 5, 0.5);
    integrateTraveler(
      moving,
      surface,
      config({ fixedDt: 0.5, rollingFriction: 0.2, maxSpeed: 2 }),
      { height: 0, gradientX: 0, gradientY: 0 },
    );
    expect(moving.velocity.x).toBeCloseTo(0.4, 6);

    const stopping = traveler(5, 5, 0.05);
    integrateTraveler(
      stopping,
      surface,
      config({ fixedDt: 0.5, rollingFriction: 0.2, maxSpeed: 2 }),
      { height: 0, gradientX: 0, gradientY: 0 },
    );
    expect(stopping.velocity).toEqual({ x: 0, y: 0 });
  });

  test('uses rectangular material regions for location-aware friction', () => {
    const surface = createHeightField(2, 2, bounds);
    const regions: FabricRegion[] = [
      {
        id: 'felt',
        type: 'felt',
        bounds: { x: 0, y: 0, width: 3, height: 10 },
      },
      {
        id: 'silk',
        type: 'silk',
        bounds: { x: 3, y: 0, width: 4, height: 10 },
      },
      {
        id: 'elastic',
        type: 'elastic',
        bounds: { x: 7, y: 0, width: 3, height: 10 },
      },
    ];
    const integrateAt = (x: number) => {
      const state = traveler(x, x, 1);
      integrateTraveler(
        state,
        surface,
        config({ fixedDt: 0.5, rollingFriction: 0.2, maxSpeed: 2 }),
        { height: 0, gradientX: 0, gradientY: 0 },
        regions,
      );
      return state.velocity.x;
    };

    expect(fabricRegionAtPoint({ x: 1, y: 5 }, regions)?.type).toBe('felt');
    expect(integrateAt(1)).toBeCloseTo(0.775, 6);
    expect(integrateAt(5)).toBeCloseTo(0.965, 6);
    expect(integrateAt(8)).toBeCloseTo(0.9, 6);
  });

  test('reflects swept bumper hits deterministically with extra elastic bounce', () => {
    const bumper = { id: 'button', center: { x: 5, y: 5 }, radius: 0.1 };
    const bounce = (regions: FabricRegion[] = []) => {
      const state = traveler(4.8, 5.2, 1);
      const hit = resolveBumperCollisions(state, [bumper], regions);
      return { hit, state };
    };
    const regular = bounce();
    const elastic = bounce([
      {
        id: 'elastic',
        type: 'elastic',
        bounds: { x: 4, y: 4, width: 2, height: 2 },
      },
    ]);

    expect(regular.hit).toBe(bumper);
    expect(regular.state.velocity.x).toBeCloseTo(-0.65, 6);
    expect(elastic.state.velocity.x).toBeCloseTo(-0.9, 6);
    expect(bounce()).toEqual(regular);
  });

  test('uses swept goal detection and enforces entry speed', () => {
    const state = traveler(4, 6, 0.2);
    const goal = { center: { x: 5, y: 5 }, radius: 0.1, maxEntrySpeed: 0.2 };
    expect(detectGoal(state, goal)).toBe(true);

    state.velocity.x = 0.2001;
    expect(detectGoal(state, goal)).toBe(false);
  });

  test('uses the traveler radius in swept hazard collisions', () => {
    const state = traveler(4, 6, 0.2);
    const hazard = {
      id: 'hole',
      type: 'hole' as const,
      center: { x: 5, y: 5.12 },
      radius: 0.08,
    };
    expect(detectHazard(state, [hazard])).toBe(hazard);
  });

  test('uses the traveler radius in swept collectible detection', () => {
    const state = traveler(4, 6, 0.2);
    const collectible = {
      id: 'patch',
      center: { x: 5, y: 5.12 },
      radius: 0.08,
    };
    expect(detectCollectible(state, collectible)).toBe(collectible);
  });

  test('retains a collected patch in successful and failed outcomes', () => {
    const run = (hazard: boolean) => {
      const surface = createHeightField(2, 2, bounds);
      const state = createSimulation({ start: { x: 4, y: 5 }, radius: 0.05 });
      const world: PhysicsWorld = {
        surface,
        bounds,
        goal: {
          center: { x: hazard ? 9 : 5, y: 5 },
          radius: 0.1,
          maxEntrySpeed: 2,
        },
        hazards: hazard
          ? [
              {
                id: 'thorn',
                type: 'thorn',
                center: { x: 5, y: 5 },
                radius: 0.1,
              },
            ]
          : [],
        collectible: {
          id: 'hidden-patch',
          center: { x: 4.5, y: 5 },
          radius: 0.05,
        },
      };
      releaseSimulation(state);
      state.traveler.velocity.x = 1;
      stepSimulation(
        state,
        world,
        config({ fixedDt: 1, gravityScale: 0, rollingFriction: 0, maxSpeed: 2 }),
      );
      return state;
    };

    const success = run(false);
    const failure = run(true);
    expect(success.collectedPatchId).toBe('hidden-patch');
    expect(success.outcome).toMatchObject({
      status: 'success',
      collectedPatchId: 'hidden-patch',
    });
    expect(failure.outcome).toMatchObject({
      status: 'failure',
      reason: 'hazard',
      collectedPatchId: 'hidden-patch',
    });
  });

  test('gates goal completion on committed stitch requirements without changing legacy worlds', () => {
    const surface = createHeightField(2, 2, bounds);
    const pinch: Stitch = {
      id: 'pinch',
      type: 'pinch',
      start: { x: 1, y: 1 },
      end: { x: 1.5, y: 1 },
      tension: 1,
      radius: 0.19,
      threadCost: 50,
    };
    const pocket: Stitch = {
      ...pinch,
      id: 'pocket',
      type: 'pocket',
      radius: 0.24,
      threadCost: 20,
    };
    const run = (
      stitches: readonly Stitch[],
      withRequirements: boolean,
    ) => {
      const state = createSimulation({ start: { x: 4, y: 5 }, radius: 0.05 });
      const world: PhysicsWorld = {
        surface,
        bounds,
        goal: { center: { x: 5, y: 5 }, radius: 0.05, maxEntrySpeed: 2 },
        hazards: [],
        stitches,
        ...(withRequirements
          ? {
              completionRequirements: {
                minimumStitches: 2,
                minimumThreadUsed: 70,
                requiredStitchTypes: ['pinch', 'pocket'] as const,
              },
            }
          : {}),
      };
      releaseSimulation(state);
      state.traveler.velocity.x = 1;
      stepSimulation(
        state,
        world,
        config({ fixedDt: 1, gravityScale: 0, rollingFriction: 0, maxSpeed: 2 }),
      );
      return state;
    };

    expect(run([pinch], true).phase).toBe('running');
    expect(run([pinch, pocket], true).outcome?.status).toBe('success');
    expect(run([], false).outcome?.status).toBe('success');
  });

  test('tracks visited fabrics and bumper hits for route requirements', () => {
    const surface = createHeightField(2, 2, bounds);
    const definition = { start: { x: 4, y: 5 }, radius: 0.05 } as const;
    const run = (includeBumper: boolean) => {
      const state = createSimulation(definition);
      const world: PhysicsWorld = {
        surface,
        bounds,
        goal: { center: { x: 4.5, y: 5 }, radius: 0.02, maxEntrySpeed: 1 },
        hazards: [],
        fabricRegions: [
          {
            id: 'elastic-lane',
            type: 'elastic',
            bounds: { x: 4, y: 4, width: 1, height: 2 },
          },
        ],
        bumpers: includeBumper
          ? [{ id: 'button', center: { x: 4.6, y: 5 }, radius: 0.05 }]
          : [],
        completionRequirements: {
          requiredFabricTypes: ['elastic'],
          requiredBumperIds: ['button'],
        },
      };
      releaseSimulation(state);
      state.traveler.velocity.x = 1;
      stepSimulation(
        state,
        world,
        config({ fixedDt: 0.5, gravityScale: 0, rollingFriction: 0, maxSpeed: 2 }),
      );
      return state;
    };

    const incomplete = run(false);
    expect(incomplete.phase).toBe('running');
    expect(incomplete.visitedFabricTypes).toEqual(new Set(['elastic']));
    expect(incomplete.hitBumperIds).toEqual(new Set());

    const complete = run(true);
    expect(complete.outcome?.status).toBe('success');
    expect(complete.visitedFabricTypes).toEqual(new Set(['elastic']));
    expect(complete.hitBumperIds).toEqual(new Set(['button']));

    resetSimulation(complete, definition);
    expect(complete.visitedFabricTypes).toEqual(new Set());
    expect(complete.hitBumperIds).toEqual(new Set());
    expect(complete.visitedStitchIds).toEqual(new Set());
  });

  test('does not count an off-course dummy as a visited stitch', () => {
    const surface = createHeightField(2, 2, bounds);
    const routeStitch: Stitch = {
      id: 'route-stitch',
      type: 'pinch',
      start: { x: 4.1, y: 5 },
      end: { x: 4.4, y: 5 },
      tension: 1,
      radius: 0.2,
      threadCost: 30,
    };
    const dummyStitch: Stitch = {
      ...routeStitch,
      id: 'off-course-dummy',
      start: { x: 1, y: 1 },
      end: { x: 1.4, y: 1 },
      threadCost: 40,
    };
    const state = createSimulation({ start: { x: 4, y: 5 }, radius: 0.05 });
    const world: PhysicsWorld = {
      surface,
      bounds,
      goal: { center: { x: 5, y: 5 }, radius: 0.05, maxEntrySpeed: 2 },
      hazards: [],
      stitches: [routeStitch, dummyStitch],
      completionRequirements: {
        minimumStitches: 2,
        minimumThreadUsed: 70,
        requireEveryStitchVisited: true,
      },
    };

    releaseSimulation(state);
    state.traveler.velocity.x = 1;
    stepSimulation(
      state,
      world,
      config({ fixedDt: 1, gravityScale: 0, rollingFriction: 0, maxSpeed: 2 }),
    );

    expect(state.phase).toBe('running');
    expect(state.visitedStitchIds).toEqual(new Set(['route-stitch']));
  });

  test('produces exactly equal state across repeated fixed-step runs', () => {
    const makeRun = () => {
      const surface = createHeightField(2, 2, bounds, (x) => x * 0.01);
      const state = createSimulation({ start: { x: 5, y: 5 }, radius: 0.05 });
      const world = worldForSurface(surface);
      const runConfig = config({ rollingFriction: 0, maxRunTicks: 1000 });
      releaseSimulation(state);
      for (let tick = 0; tick < 500; tick += 1) {
        stepSimulation(state, world, runConfig);
      }
      return state;
    };

    expect(makeRun()).toEqual(makeRun());
  });

  test('fails as stuck on the exact configured tick', () => {
    const surface = createHeightField(2, 2, bounds);
    const state = createSimulation({ start: { x: 5, y: 5 }, radius: 0.05 });
    const world = worldForSurface(surface);
    const runConfig = config({ stuckTicks: 3, maxRunTicks: 20 });
    releaseSimulation(state);

    stepSimulation(state, world, runConfig);
    stepSimulation(state, world, runConfig);
    expect(state.phase).toBe('running');
    stepSimulation(state, world, runConfig);

    expect(state.outcome).toEqual({
      status: 'failure',
      reason: 'stuck',
      tick: 3,
      completionMs: 25,
    });
  });

  test('uses an exact deterministic timeout when a run cannot settle', () => {
    const surface = createHeightField(2, 2, bounds);
    const state = createSimulation({ start: { x: 5, y: 5 }, radius: 0.05 });
    const world = worldForSurface(surface);
    const runConfig = config({ stuckTicks: 10, maxRunTicks: 2 });
    releaseSimulation(state);

    stepSimulation(state, world, runConfig);
    expect(state.phase).toBe('running');
    stepSimulation(state, world, runConfig);

    expect(state.outcome).toEqual({
      status: 'failure',
      reason: 'timeout',
      tick: 2,
      completionMs: 17,
    });
  });

  test('advances render frames using only fixed physics steps', () => {
    const surfaceA = createHeightField(2, 2, bounds, (x) => x * 0.01);
    const surfaceB = createHeightField(2, 2, bounds, (x) => x * 0.01);
    const stateA = createSimulation({ start: { x: 5, y: 5 }, radius: 0.05 });
    const stateB = createSimulation({ start: { x: 5, y: 5 }, radius: 0.05 });
    const worldA = worldForSurface(surfaceA);
    const worldB = worldForSurface(surfaceB);
    const runConfig = config({
      rollingFriction: 0,
      maxSubsteps: 20,
      maxFrameDelta: 1,
    });
    const clockA = createFixedStepClock();
    const clockB = createFixedStepClock();
    releaseSimulation(stateA);
    releaseSimulation(stateB);

    advanceSimulation(clockA, runConfig.fixedDt * 6, stateA, worldA, runConfig);
    advanceSimulation(clockB, runConfig.fixedDt * 2, stateB, worldB, runConfig);
    advanceSimulation(clockB, runConfig.fixedDt * 4, stateB, worldB, runConfig);

    expect(stateA.traveler).toEqual(stateB.traveler);
    expect(stateA.tick).toBe(6);
    expect(stateB.tick).toBe(6);
  });
});
