import {
  createHeightField,
  rebuildHeightField,
  type PinchParameters,
} from '../core/heightField';
import {
  type PhysicsConfig,
  type PhysicsWorld,
} from '../core/physics';
import { calculateThreadCost } from '../core/scoring';
import { createSimulation, type SimulationState } from '../core/simulation';
import type {
  CircularHazard,
  GoalDefinition,
  Rect,
  Stitch,
  TravelerDefinition,
} from '../core/types';

export interface SpikeLevelDefinition {
  readonly id: string;
  readonly name: string;
  readonly fabricBounds: Rect;
  readonly gridColumns: number;
  readonly gridRows: number;
  readonly traveler: TravelerDefinition;
  readonly goal: GoalDefinition;
  readonly hazards: readonly CircularHazard[];
  readonly maxStitches: number;
  readonly threadBudget: number;
}

export const SPIKE_LEVEL: SpikeLevelDefinition = Object.freeze({
  id: 'technical-spike',
  name: 'First Pull',
  fabricBounds: Object.freeze({ x: 0, y: 0, width: 1, height: 1.5 }),
  gridColumns: 24,
  gridRows: 36,
  traveler: Object.freeze({
    start: Object.freeze({ x: 0.3, y: 0.14 }),
    radius: 0.035,
  }),
  goal: Object.freeze({
    center: Object.freeze({ x: 0.78, y: 0.51 }),
    radius: 0.075,
    maxEntrySpeed: 0.7,
  }),
  hazards: Object.freeze([]),
  maxStitches: 2,
  threadBudget: 120,
});

export const SPIKE_PINCH_PARAMETERS: PinchParameters = Object.freeze({
  ridgeHeight: 0.065,
  horizontalPull: 0.08,
  minHeight: -0.2,
  maxHeight: 0.2,
  maxHorizontalDisplacement: 0.025,
});

export const SPIKE_PHYSICS_CONFIG: PhysicsConfig = Object.freeze({
  fixedDt: 1 / 120,
  gravityScale: 2.2,
  rollingFriction: 0.08,
  maxSpeed: 1.2,
  stuckSpeed: 0.012,
  stuckTicks: 180,
  maxRunTicks: 2400,
  maxSubsteps: 8,
  maxFrameDelta: 0.1,
});

const referenceStart = Object.freeze({ x: 0.23, y: 0.1 });
const referenceEnd = Object.freeze({ x: 0.23, y: 1 });

export const REFERENCE_PINCH_STITCH: Stitch = Object.freeze({
  id: 'reference-pinch',
  type: 'pinch',
  start: referenceStart,
  end: referenceEnd,
  tension: 1,
  radius: 0.19,
  threadCost: calculateThreadCost(referenceStart, referenceEnd),
});

/**
 * Builds a fresh deterministic world. The subtle downward base drape makes the
 * no-stitch route miss the goal; the reference ridge redirects that same start.
 */
export function createSpikeWorld(
  stitches: readonly Stitch[] = [],
): PhysicsWorld {
  const surface = createHeightField(
    SPIKE_LEVEL.gridColumns,
    SPIKE_LEVEL.gridRows,
    SPIKE_LEVEL.fabricBounds,
    (_x, y) => -0.11 * y,
  );
  rebuildHeightField(surface, stitches, SPIKE_PINCH_PARAMETERS);

  return {
    surface,
    bounds: SPIKE_LEVEL.fabricBounds,
    goal: SPIKE_LEVEL.goal,
    hazards: SPIKE_LEVEL.hazards,
  };
}

export function createSpikeSimulation(): SimulationState {
  return createSimulation(SPIKE_LEVEL.traveler);
}
