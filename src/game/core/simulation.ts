import type { SurfaceSample } from './heightField';
import { distancePointToSegmentSquared } from './geometry';
import {
  DEFAULT_PHYSICS_CONFIG,
  detectCollectible,
  detectGoal,
  detectHazard,
  fabricRegionAtPoint,
  integrateTraveler,
  resolveBumperCollisions,
  travelerInsideBounds,
  travelerSpeedSquared,
  type PhysicsConfig,
  type PhysicsWorld,
} from './physics';
import { calculateThreadUsed } from './scoring';
import type {
  FabricType,
  SimulationOutcome,
  SimulationPhase,
  TravelerDefinition,
  TravelerState,
} from './types';

export interface SimulationState {
  phase: SimulationPhase;
  readonly traveler: TravelerState;
  tick: number;
  lowSpeedTicks: number;
  collectedPatchId: string | null;
  readonly visitedFabricTypes: Set<FabricType>;
  readonly hitBumperIds: Set<string>;
  readonly visitedStitchIds: Set<string>;
  outcome: SimulationOutcome | null;
  readonly scratchSurfaceSample: SurfaceSample;
}

export interface FixedStepClock {
  accumulatorSeconds: number;
  interpolationAlpha: number;
}

function assertTravelerDefinition(traveler: TravelerDefinition): void {
  if (
    !Number.isFinite(traveler.start.x) ||
    !Number.isFinite(traveler.start.y) ||
    !Number.isFinite(traveler.radius) ||
    traveler.radius <= 0
  ) {
    throw new RangeError('Traveler position and radius must be finite and valid.');
  }
}

export function createSimulation(
  definition: TravelerDefinition,
): SimulationState {
  assertTravelerDefinition(definition);

  return {
    phase: 'planning',
    traveler: {
      radius: definition.radius,
      position: { x: definition.start.x, y: definition.start.y },
      previousPosition: { x: definition.start.x, y: definition.start.y },
      velocity: { x: 0, y: 0 },
    },
    tick: 0,
    lowSpeedTicks: 0,
    collectedPatchId: null,
    visitedFabricTypes: new Set<FabricType>(),
    hitBumperIds: new Set<string>(),
    visitedStitchIds: new Set<string>(),
    outcome: null,
    scratchSurfaceSample: { height: 0, gradientX: 0, gradientY: 0 },
  };
}

export function releaseSimulation(state: SimulationState): void {
  if (state.phase !== 'planning') {
    return;
  }

  state.tick = 0;
  state.lowSpeedTicks = 0;
  state.collectedPatchId = null;
  state.visitedFabricTypes.clear();
  state.hitBumperIds.clear();
  state.visitedStitchIds.clear();
  state.outcome = null;
  state.traveler.previousPosition.x = state.traveler.position.x;
  state.traveler.previousPosition.y = state.traveler.position.y;
  state.traveler.velocity.x = 0;
  state.traveler.velocity.y = 0;
  state.phase = 'running';
}

export function resetSimulation(
  state: SimulationState,
  definition: TravelerDefinition,
): void {
  assertTravelerDefinition(definition);

  state.phase = 'planning';
  state.tick = 0;
  state.lowSpeedTicks = 0;
  state.collectedPatchId = null;
  state.visitedFabricTypes.clear();
  state.hitBumperIds.clear();
  state.visitedStitchIds.clear();
  state.outcome = null;
  state.traveler.position.x = definition.start.x;
  state.traveler.position.y = definition.start.y;
  state.traveler.previousPosition.x = definition.start.x;
  state.traveler.previousPosition.y = definition.start.y;
  state.traveler.velocity.x = 0;
  state.traveler.velocity.y = 0;
}

function completionMilliseconds(
  tick: number,
  config: PhysicsConfig,
): number {
  return Math.round(tick * config.fixedDt * 1000);
}

function finish(
  state: SimulationState,
  outcome: SimulationOutcome,
): void {
  state.outcome = outcome;
  state.phase = outcome.status === 'success' ? 'succeeded' : 'failed';
  state.traveler.velocity.x = 0;
  state.traveler.velocity.y = 0;
}

function collectedPatchResult(
  state: SimulationState,
): { readonly collectedPatchId: string } | Record<string, never> {
  return state.collectedPatchId
    ? { collectedPatchId: state.collectedPatchId }
    : {};
}

function recordCurrentFabric(
  state: SimulationState,
  world: PhysicsWorld,
): void {
  const region = fabricRegionAtPoint(
    state.traveler.position,
    world.fabricRegions,
  );
  if (region) state.visitedFabricTypes.add(region.type);
}

function recordVisitedStitches(
  state: SimulationState,
  world: PhysicsWorld,
): void {
  for (const stitch of world.stitches ?? []) {
    if (state.visitedStitchIds.has(stitch.id)) continue;
    const visitRadius = stitch.radius + state.traveler.radius;
    const distanceSquared = distancePointToSegmentSquared(
      state.traveler.position.x,
      state.traveler.position.y,
      stitch.start.x,
      stitch.start.y,
      stitch.end.x,
      stitch.end.y,
    );
    if (distanceSquared <= visitRadius * visitRadius) {
      state.visitedStitchIds.add(stitch.id);
    }
  }
}

function completionRequirementsMet(
  state: SimulationState,
  world: PhysicsWorld,
): boolean {
  const requirements = world.completionRequirements;
  if (!requirements) return true;

  const stitches = world.stitches ?? [];
  if (
    requirements.minimumStitches !== undefined &&
    stitches.length < requirements.minimumStitches
  ) {
    return false;
  }
  if (
    requirements.minimumThreadUsed !== undefined &&
    calculateThreadUsed(stitches) < requirements.minimumThreadUsed
  ) {
    return false;
  }
  if (
    requirements.requiredStitchTypes?.some(
      (requiredType) =>
        !stitches.some((stitch) => stitch.type === requiredType),
    )
  ) {
    return false;
  }
  if (
    requirements.requiredFabricTypes?.some(
      (requiredType) => !state.visitedFabricTypes.has(requiredType),
    )
  ) {
    return false;
  }
  if (
    requirements.requiredBumperIds?.some(
      (requiredId) => !state.hitBumperIds.has(requiredId),
    )
  ) {
    return false;
  }
  if (
    requirements.requireEveryStitchVisited &&
    stitches.some((stitch) => !state.visitedStitchIds.has(stitch.id))
  ) {
    return false;
  }

  return true;
}

export function stepSimulation(
  state: SimulationState,
  world: PhysicsWorld,
  config: PhysicsConfig = DEFAULT_PHYSICS_CONFIG,
): void {
  if (state.phase !== 'running') {
    return;
  }

  recordCurrentFabric(state, world);
  recordVisitedStitches(state, world);
  integrateTraveler(
    state.traveler,
    world.surface,
    config,
    state.scratchSurfaceSample,
    world.fabricRegions,
  );
  resolveBumperCollisions(
    state.traveler,
    world.bumpers,
    world.fabricRegions,
    (bumper) => state.hitBumperIds.add(bumper.id),
  );
  recordCurrentFabric(state, world);
  recordVisitedStitches(state, world);
  state.tick += 1;

  if (!state.collectedPatchId) {
    const collected = detectCollectible(state.traveler, world.collectible);
    if (collected) {
      state.collectedPatchId = collected.id;
    }
  }

  const stuckSpeedSquared = config.stuckSpeed * config.stuckSpeed;
  if (travelerSpeedSquared(state.traveler) <= stuckSpeedSquared) {
    state.lowSpeedTicks += 1;
  } else {
    state.lowSpeedTicks = 0;
  }

  const completionMs = completionMilliseconds(state.tick, config);
  const hazard = detectHazard(state.traveler, world.hazards);
  if (hazard) {
    finish(state, {
      status: 'failure',
      reason: 'hazard',
      hazardId: hazard.id,
      tick: state.tick,
      completionMs,
      ...collectedPatchResult(state),
    });
    return;
  }

  if (!travelerInsideBounds(state.traveler, world.bounds)) {
    finish(state, {
      status: 'failure',
      reason: 'out_of_bounds',
      tick: state.tick,
      completionMs,
      ...collectedPatchResult(state),
    });
    return;
  }

  if (
    detectGoal(state.traveler, world.goal) &&
    completionRequirementsMet(state, world)
  ) {
    finish(state, {
      status: 'success',
      tick: state.tick,
      completionMs,
      ...collectedPatchResult(state),
    });
    return;
  }

  if (state.lowSpeedTicks >= config.stuckTicks) {
    finish(state, {
      status: 'failure',
      reason: 'stuck',
      tick: state.tick,
      completionMs,
      ...collectedPatchResult(state),
    });
    return;
  }

  if (state.tick >= config.maxRunTicks) {
    finish(state, {
      status: 'failure',
      reason: 'timeout',
      tick: state.tick,
      completionMs,
      ...collectedPatchResult(state),
    });
  }
}

export function createFixedStepClock(): FixedStepClock {
  return { accumulatorSeconds: 0, interpolationAlpha: 0 };
}

export function advanceSimulation(
  clock: FixedStepClock,
  frameDeltaSeconds: number,
  state: SimulationState,
  world: PhysicsWorld,
  config: PhysicsConfig = DEFAULT_PHYSICS_CONFIG,
): number {
  if (!Number.isFinite(frameDeltaSeconds) || frameDeltaSeconds <= 0) {
    return 0;
  }

  clock.accumulatorSeconds += Math.min(
    frameDeltaSeconds,
    config.maxFrameDelta,
  );

  let steps = 0;
  const comparisonEpsilon = 1e-12;
  while (
    clock.accumulatorSeconds + comparisonEpsilon >= config.fixedDt &&
    steps < config.maxSubsteps &&
    state.phase === 'running'
  ) {
    stepSimulation(state, world, config);
    clock.accumulatorSeconds -= config.fixedDt;
    steps += 1;
  }

  if (
    steps === config.maxSubsteps &&
    clock.accumulatorSeconds >= config.fixedDt
  ) {
    clock.accumulatorSeconds %= config.fixedDt;
  }

  if (state.phase !== 'running') {
    clock.accumulatorSeconds = 0;
  }

  clock.interpolationAlpha = Math.max(
    0,
    Math.min(1, clock.accumulatorSeconds / config.fixedDt),
  );
  return steps;
}
