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
  BumperDefinition,
  CircularHazard,
  CollectibleDefinition,
  CompletionRequirements,
  FabricRegion,
  FabricType,
  GoalDefinition,
  Point,
  Rect,
  Stitch,
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
  readonly fabricRegions?: readonly FabricRegion[];
  readonly bumpers?: readonly BumperDefinition[];
  readonly collectible?: CollectibleDefinition;
  readonly stitches?: readonly Stitch[];
  readonly completionRequirements?: CompletionRequirements;
}

export const FABRIC_FRICTION_MULTIPLIERS: Readonly<
  Record<FabricType, number>
> = Object.freeze({
  felt: 2.25,
  silk: 0.35,
  elastic: 1,
});

export const DEFAULT_BUMPER_RESTITUTION = 0.65;
export const ELASTIC_BUMPER_RESTITUTION = 0.9;
const COLLISION_EPSILON = 1e-6;

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

function pointInsideRect(point: Point, bounds: Rect): boolean {
  return (
    point.x >= bounds.x &&
    point.x <= bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y <= bounds.y + bounds.height
  );
}

/** Returns the first authored rectangular material containing the point. */
export function fabricRegionAtPoint(
  point: Point,
  regions: readonly FabricRegion[] = [],
): FabricRegion | null {
  for (const region of regions) {
    if (pointInsideRect(point, region.bounds)) {
      return region;
    }
  }
  return null;
}

export function integrateTraveler(
  traveler: TravelerState,
  surface: HeightField,
  config: PhysicsConfig,
  scratch: SurfaceSample,
  fabricRegions: readonly FabricRegion[] = [],
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
  const material = fabricRegionAtPoint(traveler.position, fabricRegions)?.type;
  const frictionMultiplier = material
    ? FABRIC_FRICTION_MULTIPLIERS[material]
    : 1;
  const speedDrop =
    config.rollingFriction * frictionMultiplier * config.fixedDt;

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

function segmentCircleIntersection(
  start: Point,
  end: Point,
  center: Point,
  radius: number,
): number | null {
  const startX = start.x - center.x;
  const startY = start.y - center.y;
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const radiusSquared = radius * radius;
  const startDistanceSquared = startX * startX + startY * startY;
  if (startDistanceSquared <= radiusSquared) {
    return 0;
  }

  const a = deltaX * deltaX + deltaY * deltaY;
  if (a <= Number.EPSILON) {
    return null;
  }
  const b = 2 * (startX * deltaX + startY * deltaY);
  const c = startDistanceSquared - radiusSquared;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) {
    return null;
  }

  const root = Math.sqrt(discriminant);
  const near = (-b - root) / (2 * a);
  const far = (-b + root) / (2 * a);
  if (near >= 0 && near <= 1) return near;
  if (far >= 0 && far <= 1) return far;
  return null;
}

function bumperRestitution(
  bumper: BumperDefinition,
  material: FabricType | undefined,
): number {
  const authored = bumper.restitution ?? DEFAULT_BUMPER_RESTITUTION;
  const bounded = Math.max(0, Math.min(1, authored));
  return material === 'elastic'
    ? Math.max(bounded, ELASTIC_BUMPER_RESTITUTION)
    : bounded;
}

/** Resolves the first swept hit for each authored bumper in stable order. */
export function resolveBumperCollisions(
  traveler: TravelerState,
  bumpers: readonly BumperDefinition[] = [],
  fabricRegions: readonly FabricRegion[] = [],
  onHit?: (bumper: BumperDefinition) => void,
): BumperDefinition | null {
  let firstHit: BumperDefinition | null = null;

  for (const bumper of bumpers) {
    if (!Number.isFinite(bumper.radius) || bumper.radius <= 0) {
      continue;
    }
    const collisionRadius = traveler.radius + bumper.radius;
    const intersection = segmentCircleIntersection(
      traveler.previousPosition,
      traveler.position,
      bumper.center,
      collisionRadius,
    );
    if (intersection === null) {
      continue;
    }

    firstHit ??= bumper;
    onHit?.(bumper);
    const impactX =
      traveler.previousPosition.x +
      (traveler.position.x - traveler.previousPosition.x) * intersection;
    const impactY =
      traveler.previousPosition.y +
      (traveler.position.y - traveler.previousPosition.y) * intersection;
    let normalX = impactX - bumper.center.x;
    let normalY = impactY - bumper.center.y;
    let normalLength = Math.hypot(normalX, normalY);
    if (normalLength <= Number.EPSILON) {
      normalLength = Math.hypot(traveler.velocity.x, traveler.velocity.y);
      if (normalLength <= Number.EPSILON) {
        normalX = 1;
        normalY = 0;
        normalLength = 1;
      } else {
        normalX = -traveler.velocity.x;
        normalY = -traveler.velocity.y;
      }
    }
    normalX /= normalLength;
    normalY /= normalLength;

    const normalVelocity =
      traveler.velocity.x * normalX + traveler.velocity.y * normalY;
    if (normalVelocity < 0) {
      const material = fabricRegionAtPoint(
        { x: impactX, y: impactY },
        fabricRegions,
      )?.type;
      const restitution = bumperRestitution(bumper, material);
      const reflection = (1 + restitution) * normalVelocity;
      traveler.velocity.x = Math.fround(
        traveler.velocity.x - reflection * normalX,
      );
      traveler.velocity.y = Math.fround(
        traveler.velocity.y - reflection * normalY,
      );
    }

    traveler.position.x = Math.fround(
      bumper.center.x + normalX * (collisionRadius + COLLISION_EPSILON),
    );
    traveler.position.y = Math.fround(
      bumper.center.y + normalY * (collisionRadius + COLLISION_EPSILON),
    );
  }

  return firstHit;
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

export function detectCollectible(
  traveler: TravelerState,
  collectible: CollectibleDefinition | undefined,
): CollectibleDefinition | null {
  if (!collectible) return null;
  const collisionRadius = traveler.radius + collectible.radius;
  return distancePointToSegmentSquared(
    collectible.center.x,
    collectible.center.y,
    traveler.previousPosition.x,
    traveler.previousPosition.y,
    traveler.position.x,
    traveler.position.y,
  ) <= collisionRadius * collisionRadius
    ? collectible
    : null;
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
