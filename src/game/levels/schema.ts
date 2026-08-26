import { quantizePoint } from '../core/geometry';
import { calculateThreadCost, calculateThreadUsed } from '../core/scoring';
import type { PhysicsConfig } from '../core/physics';
import type {
  BumperDefinition,
  CircularHazard,
  CollectibleDefinition,
  FabricRegion,
  GoalDefinition,
  Rect,
  Stitch,
  StitchType,
  TravelerDefinition,
} from '../core/types';
import {
  isValidStitchDrag,
  POCKET_STITCH_RADIUS,
  SPIKE_STITCH_RADIUS,
} from '../input/stitchGesture';

export interface BaseSlopeDefinition {
  /** Height gained per canonical fabric unit along the x axis. */
  readonly x: number;
  /** Height gained per canonical fabric unit along the y axis. */
  readonly y: number;
  readonly originHeight: number;
}

export interface QuiltDefinition {
  readonly id: string;
  readonly version: number;
  readonly order: number;
  readonly name: string;
  readonly description: string;
}

export interface LevelDefinition {
  readonly id: string;
  /** Increment whenever authored geometry or simulation rules change. */
  readonly version: number;
  readonly order: number;
  readonly quiltId: string;
  readonly name: string;
  readonly mechanic: string;
  readonly fabricBounds: Rect;
  readonly gridColumns: number;
  readonly gridRows: number;
  readonly baseSlope: BaseSlopeDefinition;
  readonly traveler: TravelerDefinition;
  readonly goal: GoalDefinition;
  readonly fabricRegions: readonly FabricRegion[];
  readonly hazards: readonly CircularHazard[];
  readonly bumpers: readonly BumperDefinition[];
  readonly collectible?: CollectibleDefinition;
  readonly allowedStitchTypes: readonly StitchType[];
  readonly maxStitches: number;
  readonly threadBudget: number;
  readonly targetThreadUsage: number;
  readonly physicsConfig: PhysicsConfig;
  readonly referenceSolution: readonly Stitch[];
}

const STABLE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const STITCH_TYPES: readonly StitchType[] = ['pinch', 'pocket'];
const FABRIC_TYPES = ['felt', 'silk', 'elastic'] as const;

function fail(context: string, message: string): never {
  throw new Error(`${context}: ${message}`);
}

function assertStableId(value: unknown, context: string): asserts value is string {
  if (typeof value !== 'string' || !STABLE_ID.test(value)) {
    fail(context, 'id must be a non-empty lowercase kebab-case string');
  }
}

function assertNonEmptyString(
  value: unknown,
  context: string,
): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(context, 'must be a non-empty string');
  }
}

function assertFinite(value: unknown, context: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(context, 'must be finite');
  }
}

function assertPositive(value: unknown, context: string): asserts value is number {
  assertFinite(value, context);
  if (value <= 0) fail(context, 'must be greater than zero');
}

function assertPositiveInteger(
  value: unknown,
  context: string,
): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    fail(context, 'must be a positive integer');
  }
}

function assertRect(rect: Rect, context: string): void {
  assertFinite(rect.x, `${context}.x`);
  assertFinite(rect.y, `${context}.y`);
  assertPositive(rect.width, `${context}.width`);
  assertPositive(rect.height, `${context}.height`);
}

function rectContainsRect(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

function circleInsideRect(
  bounds: Rect,
  center: { readonly x: number; readonly y: number },
  radius: number,
): boolean {
  return (
    center.x - radius >= bounds.x &&
    center.x + radius <= bounds.x + bounds.width &&
    center.y - radius >= bounds.y &&
    center.y + radius <= bounds.y + bounds.height
  );
}

function pointInsideRect(
  bounds: Rect,
  point: { readonly x: number; readonly y: number },
): boolean {
  return (
    point.x >= bounds.x &&
    point.x <= bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y <= bounds.y + bounds.height
  );
}

function assertCircle(
  bounds: Rect,
  circle: {
    readonly center: { readonly x: number; readonly y: number };
    readonly radius: number;
  },
  context: string,
): void {
  assertFinite(circle.center.x, `${context}.center.x`);
  assertFinite(circle.center.y, `${context}.center.y`);
  assertPositive(circle.radius, `${context}.radius`);
  if (!circleInsideRect(bounds, circle.center, circle.radius)) {
    fail(context, 'must fit completely inside fabric bounds');
  }
}

function assertPhysicsConfig(config: PhysicsConfig, context: string): void {
  assertPositive(config.fixedDt, `${context}.fixedDt`);
  assertPositive(config.gravityScale, `${context}.gravityScale`);
  assertFinite(config.rollingFriction, `${context}.rollingFriction`);
  if (config.rollingFriction < 0) {
    fail(`${context}.rollingFriction`, 'must not be negative');
  }
  assertPositive(config.maxSpeed, `${context}.maxSpeed`);
  assertPositive(config.stuckSpeed, `${context}.stuckSpeed`);
  assertPositiveInteger(config.stuckTicks, `${context}.stuckTicks`);
  assertPositiveInteger(config.maxRunTicks, `${context}.maxRunTicks`);
  assertPositiveInteger(config.maxSubsteps, `${context}.maxSubsteps`);
  assertPositive(config.maxFrameDelta, `${context}.maxFrameDelta`);
}

function assertUniqueObjectIds(
  level: LevelDefinition,
  context: string,
): void {
  const seen = new Set<string>();
  const entries: readonly { readonly id: string; readonly kind: string }[] = [
    ...level.fabricRegions.map(({ id }) => ({ id, kind: 'fabric region' })),
    ...level.hazards.map(({ id }) => ({ id, kind: 'hazard' })),
    ...level.bumpers.map(({ id }) => ({ id, kind: 'bumper' })),
    ...(level.collectible
      ? [{ id: level.collectible.id, kind: 'collectible' }]
      : []),
  ];

  for (const entry of entries) {
    assertStableId(entry.id, `${context}.${entry.kind}`);
    if (seen.has(entry.id)) {
      fail(context, `object id "${entry.id}" is duplicated`);
    }
    seen.add(entry.id);
  }
}

function assertReferenceSolution(level: LevelDefinition, context: string): void {
  const ids = new Set<string>();
  let expectedThreadUsed = 0;

  if (level.referenceSolution.length === 0) {
    fail(`${context}.referenceSolution`, 'must contain at least one stitch');
  }
  if (level.referenceSolution.length > level.maxStitches) {
    fail(`${context}.referenceSolution`, 'exceeds maxStitches');
  }

  for (const [index, stitch] of level.referenceSolution.entries()) {
    const stitchContext = `${context}.referenceSolution[${index}]`;
    assertStableId(stitch.id, `${stitchContext}.id`);
    if (ids.has(stitch.id)) fail(stitchContext, `duplicate stitch id "${stitch.id}"`);
    ids.add(stitch.id);

    if (!STITCH_TYPES.includes(stitch.type)) {
      fail(`${stitchContext}.type`, `unsupported stitch type "${String(stitch.type)}"`);
    }
    if (!level.allowedStitchTypes.includes(stitch.type)) {
      fail(`${stitchContext}.type`, `is not allowed by level "${level.id}"`);
    }
    if (!pointInsideRect(level.fabricBounds, stitch.start)) {
      fail(`${stitchContext}.start`, 'must be inside fabric bounds');
    }
    if (!pointInsideRect(level.fabricBounds, stitch.end)) {
      fail(`${stitchContext}.end`, 'must be inside fabric bounds');
    }
    if (stitch.tension !== 1) {
      fail(`${stitchContext}.tension`, 'must match the player-authored tension');
    }
    const authoredRadius =
      stitch.type === 'pocket' ? POCKET_STITCH_RADIUS : SPIKE_STITCH_RADIUS;
    if (stitch.radius !== authoredRadius) {
      fail(
        `${stitchContext}.radius`,
        `must match the player-authored radius ${authoredRadius}`,
      );
    }
    const quantizedStart = quantizePoint(stitch.start);
    const quantizedEnd = quantizePoint(stitch.end);
    if (
      quantizedStart.x !== stitch.start.x ||
      quantizedStart.y !== stitch.start.y ||
      quantizedEnd.x !== stitch.end.x ||
      quantizedEnd.y !== stitch.end.y
    ) {
      fail(stitchContext, 'endpoints must use player-authored quantization');
    }
    if (!isValidStitchDrag(stitch.start, stitch.end)) {
      fail(stitchContext, 'must meet the player-authored minimum length');
    }
    if (!Number.isInteger(stitch.threadCost) || stitch.threadCost < 0) {
      fail(`${stitchContext}.threadCost`, 'must be a non-negative integer');
    }

    const canonicalCost = calculateThreadCost(stitch.start, stitch.end);
    if (stitch.threadCost !== canonicalCost) {
      fail(
        `${stitchContext}.threadCost`,
        `must equal canonical cost ${canonicalCost}`,
      );
    }
    expectedThreadUsed += canonicalCost;
  }

  if (calculateThreadUsed(level.referenceSolution) !== expectedThreadUsed) {
    fail(`${context}.referenceSolution`, 'thread total is internally inconsistent');
  }
  if (expectedThreadUsed > level.threadBudget) {
    fail(`${context}.referenceSolution`, 'exceeds threadBudget');
  }
  if (expectedThreadUsed > level.targetThreadUsage) {
    fail(`${context}.referenceSolution`, 'exceeds targetThreadUsage');
  }
}

export function validateQuiltDefinition(
  quilt: QuiltDefinition,
): QuiltDefinition {
  const context = `Quilt "${String(quilt.id)}"`;
  assertStableId(quilt.id, `${context}.id`);
  assertPositiveInteger(quilt.version, `${context}.version`);
  assertPositiveInteger(quilt.order, `${context}.order`);
  assertNonEmptyString(quilt.name, `${context}.name`);
  assertNonEmptyString(quilt.description, `${context}.description`);
  return quilt;
}

export function validateLevelDefinition(level: LevelDefinition): LevelDefinition {
  const context = `Level "${String(level.id)}"`;
  assertStableId(level.id, `${context}.id`);
  assertPositiveInteger(level.version, `${context}.version`);
  assertPositiveInteger(level.order, `${context}.order`);
  assertStableId(level.quiltId, `${context}.quiltId`);
  assertNonEmptyString(level.name, `${context}.name`);
  assertNonEmptyString(level.mechanic, `${context}.mechanic`);
  assertRect(level.fabricBounds, `${context}.fabricBounds`);
  assertPositiveInteger(level.gridColumns, `${context}.gridColumns`);
  assertPositiveInteger(level.gridRows, `${context}.gridRows`);
  if (level.gridColumns < 2 || level.gridRows < 2) {
    fail(context, 'height-field dimensions must be at least 2 by 2');
  }
  assertFinite(level.baseSlope.x, `${context}.baseSlope.x`);
  assertFinite(level.baseSlope.y, `${context}.baseSlope.y`);
  assertFinite(level.baseSlope.originHeight, `${context}.baseSlope.originHeight`);

  assertFinite(level.traveler.start.x, `${context}.traveler.start.x`);
  assertFinite(level.traveler.start.y, `${context}.traveler.start.y`);
  assertPositive(level.traveler.radius, `${context}.traveler.radius`);
  if (!circleInsideRect(level.fabricBounds, level.traveler.start, level.traveler.radius)) {
    fail(`${context}.traveler`, 'must fit completely inside fabric bounds');
  }

  assertCircle(level.fabricBounds, level.goal, `${context}.goal`);
  assertPositive(level.goal.maxEntrySpeed, `${context}.goal.maxEntrySpeed`);
  assertUniqueObjectIds(level, context);

  for (const [index, region] of level.fabricRegions.entries()) {
    const regionContext = `${context}.fabricRegions[${index}]`;
    if (!FABRIC_TYPES.includes(region.type)) {
      fail(`${regionContext}.type`, `unsupported fabric type "${String(region.type)}"`);
    }
    assertRect(region.bounds, `${regionContext}.bounds`);
    if (!rectContainsRect(level.fabricBounds, region.bounds)) {
      fail(regionContext, 'must fit inside fabric bounds');
    }
  }

  for (const [index, hazard] of level.hazards.entries()) {
    const hazardContext = `${context}.hazards[${index}]`;
    if (hazard.type !== 'hole' && hazard.type !== 'thorn') {
      fail(`${hazardContext}.type`, `unsupported hazard type "${String(hazard.type)}"`);
    }
    assertCircle(level.fabricBounds, hazard, hazardContext);
  }

  for (const [index, bumper] of level.bumpers.entries()) {
    const bumperContext = `${context}.bumpers[${index}]`;
    assertCircle(level.fabricBounds, bumper, bumperContext);
    if (bumper.restitution !== undefined) {
      assertFinite(bumper.restitution, `${bumperContext}.restitution`);
      if (bumper.restitution < 0 || bumper.restitution > 1) {
        fail(`${bumperContext}.restitution`, 'must be between 0 and 1');
      }
    }
  }

  if (level.collectible) {
    assertCircle(level.fabricBounds, level.collectible, `${context}.collectible`);
  }

  if (level.allowedStitchTypes.length === 0) {
    fail(`${context}.allowedStitchTypes`, 'must not be empty');
  }
  const allowed = new Set<StitchType>();
  for (const type of level.allowedStitchTypes) {
    if (!STITCH_TYPES.includes(type)) {
      fail(`${context}.allowedStitchTypes`, `unsupported stitch type "${String(type)}"`);
    }
    if (allowed.has(type)) {
      fail(`${context}.allowedStitchTypes`, `duplicate stitch type "${type}"`);
    }
    allowed.add(type);
  }

  assertPositiveInteger(level.maxStitches, `${context}.maxStitches`);
  assertPositiveInteger(level.threadBudget, `${context}.threadBudget`);
  assertPositiveInteger(level.targetThreadUsage, `${context}.targetThreadUsage`);
  if (level.targetThreadUsage > level.threadBudget) {
    fail(`${context}.targetThreadUsage`, 'must not exceed threadBudget');
  }
  assertPhysicsConfig(level.physicsConfig, `${context}.physicsConfig`);
  assertReferenceSolution(level, context);
  return level;
}

export function validateCampaignCatalog(
  quilts: readonly QuiltDefinition[],
  levels: readonly LevelDefinition[],
): void {
  if (quilts.length === 0) fail('Campaign', 'must contain at least one quilt');
  if (levels.length === 0) fail('Campaign', 'must contain at least one level');

  const quiltIds = new Set<string>();
  const quiltOrders = new Set<number>();
  for (const quilt of quilts) {
    validateQuiltDefinition(quilt);
    if (quiltIds.has(quilt.id)) fail('Campaign', `duplicate quilt id "${quilt.id}"`);
    if (quiltOrders.has(quilt.order)) {
      fail('Campaign', `duplicate quilt order ${quilt.order}`);
    }
    quiltIds.add(quilt.id);
    quiltOrders.add(quilt.order);
  }

  const levelIds = new Set<string>();
  const levelOrders = new Set<number>();
  for (const level of levels) {
    validateLevelDefinition(level);
    if (levelIds.has(level.id)) fail('Campaign', `duplicate level id "${level.id}"`);
    if (levelOrders.has(level.order)) {
      fail('Campaign', `duplicate level order ${level.order}`);
    }
    if (!quiltIds.has(level.quiltId)) {
      fail(`Level "${level.id}"`, `references unknown quilt "${level.quiltId}"`);
    }
    levelIds.add(level.id);
    levelOrders.add(level.order);
  }

  quilts.forEach(({ order }, index) => {
    if (order !== index + 1) {
      fail(
        'Campaign',
        'quilt orders must be in canonical ascending order and contiguous from one',
      );
    }
  });
  levels.forEach(({ order }, index) => {
    if (order !== index + 1) {
      fail(
        'Campaign',
        'level orders must be in canonical ascending order and contiguous from one',
      );
    }
  });
}
