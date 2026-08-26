import type { PinchParameters } from '../core/heightField';
import type { PhysicsConfig, PhysicsWorld } from '../core/physics';
import type { Stitch } from '../core/types';
import { createStitch } from '../input/stitchGesture';
import { CAMPAIGN_LEVELS } from './campaignLevels';
import { createLevelSimulation, createLevelWorld } from './levelLoader';
import type { LevelDefinition } from './schema';

/**
 * Backward-compatible name for callers built against the original technical
 * spike. New campaign code should consume LevelDefinition directly.
 */
export type SpikeLevelDefinition = LevelDefinition;

/** Level 1 remains the exact entry point used by the Milestone 2 UI. */
export const SPIKE_LEVEL: LevelDefinition = CAMPAIGN_LEVELS[0];

export const SPIKE_PINCH_PARAMETERS: PinchParameters = Object.freeze({
  ridgeHeight: 0.065,
  horizontalPull: 0.08,
  minHeight: -0.2,
  maxHeight: 0.2,
  maxHorizontalDisplacement: 0.025,
});

export const SPIKE_PHYSICS_CONFIG: PhysicsConfig = SPIKE_LEVEL.physicsConfig;

export const REFERENCE_PINCH_STITCH: Stitch =
  SPIKE_LEVEL.referenceSolution[0];

const tutorialGuideStart = Object.freeze({ x: 0.23, y: 1 });
const tutorialGuideEnd = Object.freeze({ x: 0.23, y: 0 });

/**
 * The element-relative tutorial gesture starts at this authored guide and
 * travels upward beyond the field. Input clamping produces the deterministic
 * endpoint below on every portrait screen size.
 */
const tutorialGuidedStitch = createStitch(
  'tutorial-guided-pinch',
  'pinch',
  tutorialGuideStart,
  tutorialGuideEnd,
);
export const TUTORIAL_GUIDED_PINCH_STITCH: Stitch = Object.freeze({
  ...tutorialGuidedStitch,
  start: Object.freeze(tutorialGuidedStitch.start),
  end: Object.freeze(tutorialGuidedStitch.end),
});

export function createSpikeWorld(
  stitches: readonly Stitch[] = [],
): PhysicsWorld {
  return createLevelWorld(SPIKE_LEVEL, stitches);
}

export function createSpikeSimulation() {
  return createLevelSimulation(SPIKE_LEVEL);
}
