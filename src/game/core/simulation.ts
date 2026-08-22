import type { SurfaceSample } from './heightField';
import {
  DEFAULT_PHYSICS_CONFIG,
  detectGoal,
  detectHazard,
  integrateTraveler,
  travelerInsideBounds,
  travelerSpeedSquared,
  type PhysicsConfig,
  type PhysicsWorld,
} from './physics';
import type {
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

export function stepSimulation(
  state: SimulationState,
  world: PhysicsWorld,
  config: PhysicsConfig = DEFAULT_PHYSICS_CONFIG,
): void {
  if (state.phase !== 'running') {
    return;
  }

  integrateTraveler(
    state.traveler,
    world.surface,
    config,
    state.scratchSurfaceSample,
  );
  state.tick += 1;

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
    });
    return;
  }

  if (!travelerInsideBounds(state.traveler, world.bounds)) {
    finish(state, {
      status: 'failure',
      reason: 'out_of_bounds',
      tick: state.tick,
      completionMs,
    });
    return;
  }

  if (detectGoal(state.traveler, world.goal)) {
    finish(state, {
      status: 'success',
      tick: state.tick,
      completionMs,
    });
    return;
  }

  if (state.lowSpeedTicks >= config.stuckTicks) {
    finish(state, {
      status: 'failure',
      reason: 'stuck',
      tick: state.tick,
      completionMs,
    });
    return;
  }

  if (state.tick >= config.maxRunTicks) {
    finish(state, {
      status: 'failure',
      reason: 'timeout',
      tick: state.tick,
      completionMs,
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
