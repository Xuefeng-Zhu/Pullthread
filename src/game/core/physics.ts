import {
  circleInsideRect,
  distancePointToSegmentSquared,
} from './geometry';
import {
  sampleSurfaceInto,
  type HeightField,
  type SurfaceSample,
} from './heightField';
import type {
  CircularHazard,
  GoalDefinition,
  Rect,
  TravelerState,
} from './types';

export interface PhysicsConfig {
  readonly fixedDt: number;
  readonly gravityScale: number;
  /** Speed removed per simulated second on the current fabric. */
  readonly rollingFriction: number;
  readonly maxSpeed: number;
  readonly stuckSpeed: number;
  readonly stuckTicks: number;
  readonly maxRunTicks: number;
  readonly maxSubsteps: number;
  readonly maxFrameDelta: number;
}

export interface PhysicsWorld {
  readonly surface: HeightField;
  readonly bounds: Rect;
  readonly goal: GoalDefinition;
  readonly hazards: readonly CircularHazard[];
}

export const DEFAULT_PHYSICS_CONFIG: PhysicsConfig = Object.freeze({
  fixedDt: 1 / 120,
  gravityScale: 2.2,
  rollingFriction: 0.18,
  maxSpeed: 1.2,
  stuckSpeed: 0.012,
  stuckTicks: 150,
  maxRunTicks: 2400,
  maxSubsteps: 8,
  maxFrameDelta: 0.1,
});

export function travelerSpeedSquared(traveler: TravelerState): number {
  return (
    traveler.velocity.x * traveler.velocity.x +
    traveler.velocity.y * traveler.velocity.y
  );
}

export function integrateTraveler(
  traveler: TravelerState,
  surface: HeightField,
  config: PhysicsConfig,
  scratch: SurfaceSample,
): void {
  traveler.previousPosition.x = traveler.position.x;
  traveler.previousPosition.y = traveler.position.y;

  sampleSurfaceInto(
    surface,
    traveler.position.x,
    traveler.position.y,
    scratch,
  );

  const gradientLengthFactor = Math.sqrt(
    1 +
      scratch.gradientX * scratch.gradientX +
      scratch.gradientY * scratch.gradientY,
  );
  const accelerationX =
    (-config.gravityScale * scratch.gradientX) / gradientLengthFactor;
  const accelerationY =
    (-config.gravityScale * scratch.gradientY) / gradientLengthFactor;
  let velocityX =
    traveler.velocity.x + accelerationX * config.fixedDt;
  let velocityY =
    traveler.velocity.y + accelerationY * config.fixedDt;
  let speed = Math.sqrt(velocityX * velocityX + velocityY * velocityY);
  const speedDrop = config.rollingFriction * config.fixedDt;

  if (speed <= speedDrop) {
    velocityX = 0;
    velocityY = 0;
    speed = 0;
  } else if (speedDrop > 0) {
    const frictionScale = (speed - speedDrop) / speed;
    velocityX *= frictionScale;
    velocityY *= frictionScale;
    speed -= speedDrop;
  }

  if (speed > config.maxSpeed) {
    const maximumSpeedScale = config.maxSpeed / speed;
    velocityX *= maximumSpeedScale;
    velocityY *= maximumSpeedScale;
  }

  traveler.velocity.x = Math.fround(velocityX);
  traveler.velocity.y = Math.fround(velocityY);
  traveler.position.x = Math.fround(
    traveler.position.x + traveler.velocity.x * config.fixedDt,
  );
  traveler.position.y = Math.fround(
    traveler.position.y + traveler.velocity.y * config.fixedDt,
  );
}

export function detectGoal(
  traveler: TravelerState,
  goal: GoalDefinition,
): boolean {
  const crossedGoal =
    distancePointToSegmentSquared(
      goal.center.x,
      goal.center.y,
      traveler.previousPosition.x,
      traveler.previousPosition.y,
      traveler.position.x,
      traveler.position.y,
    ) <=
    goal.radius * goal.radius;
  const acceptableSpeed =
    travelerSpeedSquared(traveler) <= goal.maxEntrySpeed * goal.maxEntrySpeed;

  return crossedGoal && acceptableSpeed;
}

export function detectHazard(
  traveler: TravelerState,
  hazards: readonly CircularHazard[],
): CircularHazard | null {
  for (const hazard of hazards) {
    const collisionRadius = traveler.radius + hazard.radius;
    const collisionDistanceSquared = distancePointToSegmentSquared(
      hazard.center.x,
      hazard.center.y,
      traveler.previousPosition.x,
      traveler.previousPosition.y,
      traveler.position.x,
      traveler.position.y,
    );

    if (collisionDistanceSquared <= collisionRadius * collisionRadius) {
      return hazard;
    }
  }

  return null;
}

export function travelerInsideBounds(
  traveler: TravelerState,
  bounds: Rect,
): boolean {
  return circleInsideRect(
    traveler.position.x,
    traveler.position.y,
    traveler.radius,
    bounds,
  );
}
