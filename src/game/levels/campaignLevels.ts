import type { PhysicsConfig } from '../core/physics';
import type {
  BumperDefinition,
  CircularHazard,
  CollectibleDefinition,
  FabricRegion,
  GoalDefinition,
  Point,
  Rect,
  Stitch,
  StitchType,
  TravelerDefinition,
} from '../core/types';
import { createStitch } from '../input/stitchGesture';
import {
  validateCampaignCatalog,
  validateLevelDefinition,
  type BaseSlopeDefinition,
  type LevelDefinition,
  type QuiltDefinition,
} from './schema';

const FABRIC_BOUNDS: Rect = Object.freeze({
  x: 0,
  y: 0,
  width: 1,
  height: 1.5,
});

const DEFAULT_BASE_SLOPE: BaseSlopeDefinition = Object.freeze({
  x: 0,
  y: -0.11,
  originHeight: 0,
});

const DEFAULT_TRAVELER: TravelerDefinition = Object.freeze({
  start: Object.freeze({ x: 0.3, y: 0.14 }),
  radius: 0.035,
});

const DEFAULT_GOAL: GoalDefinition = Object.freeze({
  center: Object.freeze({ x: 0.78, y: 0.51 }),
  radius: 0.075,
  maxEntrySpeed: 0.7,
});

export const CAMPAIGN_PHYSICS_CONFIG: PhysicsConfig = Object.freeze({
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

function point(x: number, y: number): Point {
  return Object.freeze({ x, y });
}

function stitch(
  id: string,
  type: StitchType,
  start: Point,
  end: Point,
): Stitch {
  const authored = createStitch(id, type, start, end);
  return Object.freeze({
    ...authored,
    start: Object.freeze(authored.start),
    end: Object.freeze(authored.end),
  });
}

function pinch(
  id: string,
  x = 0.23,
  startY = 0.1,
  endY = 1,
): Stitch {
  return stitch(id, 'pinch', point(x, startY), point(x, endY));
}

function crossStitch(
  id: string,
  y: number,
  startX: number,
  endX: number,
): Stitch {
  return stitch(id, 'pinch', point(startX, y), point(endX, y));
}

function pocket(
  id: string,
  start: Point,
  end: Point,
): Stitch {
  return stitch(id, 'pocket', start, end);
}

function region(
  id: string,
  type: FabricRegion['type'],
  bounds: Rect,
): FabricRegion {
  return Object.freeze({ id, type, bounds: Object.freeze(bounds) });
}

function hazard(
  id: string,
  type: CircularHazard['type'],
  center: Point,
  radius: number,
): CircularHazard {
  return Object.freeze({ id, type, center, radius });
}

function bumper(
  id: string,
  center: Point,
  radius: number,
  restitution = 0.85,
): BumperDefinition {
  return Object.freeze({ id, center, radius, restitution });
}

function collectible(
  id: string,
  center: Point,
  radius = 0.045,
): CollectibleDefinition {
  return Object.freeze({ id, center, radius });
}

interface LevelOptions {
  readonly id: string;
  readonly order: number;
  readonly quiltId: string;
  readonly name: string;
  readonly mechanic: string;
  readonly referenceSolution: readonly Stitch[];
  readonly version?: number;
  readonly baseSlope?: BaseSlopeDefinition;
  readonly traveler?: TravelerDefinition;
  readonly goal?: GoalDefinition;
  readonly fabricRegions?: readonly FabricRegion[];
  readonly hazards?: readonly CircularHazard[];
  readonly bumpers?: readonly BumperDefinition[];
  readonly collectible?: CollectibleDefinition;
  readonly allowedStitchTypes?: readonly StitchType[];
  readonly maxStitches?: number;
  readonly threadBudget?: number;
  readonly targetThreadUsage?: number;
  readonly physicsConfig?: PhysicsConfig;
}

function level(options: LevelOptions): LevelDefinition {
  const referenceThread = options.referenceSolution.reduce(
    (total, authoredStitch) => total + authoredStitch.threadCost,
    0,
  );
  const definition: LevelDefinition = {
    id: options.id,
    version: options.version ?? 1,
    order: options.order,
    quiltId: options.quiltId,
    name: options.name,
    mechanic: options.mechanic,
    fabricBounds: FABRIC_BOUNDS,
    gridColumns: 24,
    gridRows: 36,
    baseSlope: options.baseSlope ?? DEFAULT_BASE_SLOPE,
    traveler: options.traveler ?? DEFAULT_TRAVELER,
    goal: options.goal ?? DEFAULT_GOAL,
    fabricRegions: Object.freeze([...(options.fabricRegions ?? [])]),
    hazards: Object.freeze([...(options.hazards ?? [])]),
    bumpers: Object.freeze([...(options.bumpers ?? [])]),
    ...(options.collectible ? { collectible: options.collectible } : {}),
    allowedStitchTypes: Object.freeze([
      ...(options.allowedStitchTypes ?? ['pinch']),
    ]),
    maxStitches: options.maxStitches ?? options.referenceSolution.length,
    threadBudget: options.threadBudget ?? Math.max(120, referenceThread),
    targetThreadUsage:
      options.targetThreadUsage ?? Math.max(90, referenceThread),
    physicsConfig: options.physicsConfig ?? CAMPAIGN_PHYSICS_CONFIG,
    referenceSolution: Object.freeze([...options.referenceSolution]),
  };
  return Object.freeze(definition);
}

export const BEDROOM_QUILT: QuiltDefinition = Object.freeze({
  id: 'bedroom-quilt',
  version: 1,
  order: 1,
  name: 'Bedroom Quilt',
  description: 'Learn to redirect the button with one careful pull.',
});

export const ATTIC_QUILT: QuiltDefinition = Object.freeze({
  id: 'attic-quilt',
  version: 1,
  order: 2,
  name: 'Attic Quilt',
  description: 'Mix fabric textures, pockets, and hidden embroidery.',
});

export const FESTIVAL_QUILT: QuiltDefinition = Object.freeze({
  id: 'festival-quilt',
  version: 1,
  order: 3,
  name: 'Festival Quilt',
  description: 'Combine every stitch and surface in the final pattern.',
});

export const CAMPAIGN_QUILTS: readonly QuiltDefinition[] = Object.freeze([
  BEDROOM_QUILT,
  ATTIC_QUILT,
  FESTIVAL_QUILT,
]);

const firstPull = pinch('reference-pinch');
const edgeRedirect = crossStitch(
  'edge-redirect-reference',
  0.24,
  0.08,
  0.98,
);
const feltLanding = pinch('felt-landing-reference', 0.77, 0.1, 1);
const holeCrossing = crossStitch(
  'hole-crossing-reference',
  1.28,
  0.08,
  1,
);
const budgetPull = pinch('budget-pull-reference', 0.77, 1.38, 0.52);
const silkPull = crossStitch(
  'silk-pull-reference',
  0.22,
  0.92,
  0,
);
const pocketCatch = pocket(
  'pocket-catch-reference',
  point(0.63, 0.3),
  point(0.47, 0.3),
);
const mixedPull = crossStitch(
  'mixed-pull-reference',
  0.23,
  0.08,
  1,
);
const combinationTop = pinch(
  'combination-top-reference',
  0.23,
  1.4,
  0.85,
);
const combinationBottom = pinch(
  'combination-bottom-reference',
  0.65,
  1.25,
  0.6,
);
const patchPull = pinch('patch-pull-reference', 0.77, 1.42, 0.48);
const thornPull = crossStitch(
  'thorn-pull-reference',
  1.29,
  0.08,
  1,
);
const elasticPull = crossStitch(
  'elastic-pull-reference',
  0.23,
  0.92,
  0,
);
const pinchPocketRidge = pinch(
  'pinch-pocket-ridge-reference',
  0.23,
  1.42,
  0.62,
);
const pinchPocketCatch = pocket(
  'pinch-pocket-catch-reference',
  point(0.64, 1.07),
  point(0.76, 0.95),
);
const tightPull = crossStitch(
  'tight-pull-reference',
  1.27,
  0.9,
  0,
);
const finaleTop = pinch('finale-top-reference', 0.78, 0.08, 0.56);
const finaleBottom = pinch('finale-bottom-reference', 0.55, 0.35, 0.8);
const finalePocket = pocket(
  'finale-pocket-reference',
  point(0.34, 0.44),
  point(0.24, 0.54),
);

export const CAMPAIGN_LEVELS: readonly LevelDefinition[] = Object.freeze([
  level({
    id: 'bedroom-01-first-pull',
    order: 1,
    quiltId: BEDROOM_QUILT.id,
    name: 'First Pull',
    mechanic: 'One obvious ridge',
    referenceSolution: [firstPull],
    maxStitches: 2,
    threadBudget: 120,
    targetThreadUsage: 100,
  }),
  level({
    id: 'bedroom-02-edge-redirect',
    version: 2,
    order: 2,
    quiltId: BEDROOM_QUILT.id,
    name: 'Edge Redirect',
    mechanic: 'Turn a sideways route before the edge',
    referenceSolution: [edgeRedirect],
    baseSlope: Object.freeze({ x: -0.11, y: 0, originHeight: 0 }),
    traveler: Object.freeze({
      start: point(0.14, 0.3),
      radius: DEFAULT_TRAVELER.radius,
    }),
    goal: Object.freeze({
      center: point(0.51, 0.78),
      radius: DEFAULT_GOAL.radius,
      maxEntrySpeed: DEFAULT_GOAL.maxEntrySpeed,
    }),
    maxStitches: 2,
    threadBudget: 125,
    targetThreadUsage: edgeRedirect.threadCost,
  }),
  level({
    id: 'bedroom-03-felt-landing',
    version: 2,
    order: 3,
    quiltId: BEDROOM_QUILT.id,
    name: 'Felt Landing',
    mechanic: 'Curve left and settle on felt',
    referenceSolution: [feltLanding],
    traveler: Object.freeze({
      start: point(0.7, 0.14),
      radius: DEFAULT_TRAVELER.radius,
    }),
    goal: Object.freeze({
      center: point(0.22, 0.51),
      radius: DEFAULT_GOAL.radius,
      maxEntrySpeed: 0.38,
    }),
    fabricRegions: [
      region('felt-landing', 'felt', {
        x: 0.06,
        y: 0.32,
        width: 0.42,
        height: 0.4,
      }),
    ],
    maxStitches: 2,
    threadBudget: 120,
    targetThreadUsage: feltLanding.threadCost,
  }),
  level({
    id: 'bedroom-04-hole-crossing',
    version: 2,
    order: 4,
    quiltId: BEDROOM_QUILT.id,
    name: 'Hole Crossing',
    mechanic: 'Sweep uphill around a small hole',
    referenceSolution: [holeCrossing],
    baseSlope: Object.freeze({ x: -0.11, y: 0, originHeight: 0 }),
    traveler: Object.freeze({
      start: point(0.14, 1.2),
      radius: DEFAULT_TRAVELER.radius,
    }),
    goal: Object.freeze({
      center: point(0.51, 0.72),
      radius: DEFAULT_GOAL.radius,
      maxEntrySpeed: DEFAULT_GOAL.maxEntrySpeed,
    }),
    hazards: [hazard('bedroom-hole', 'hole', point(0.55, 1.19), 0.055)],
    maxStitches: 2,
    threadBudget: 120,
    targetThreadUsage: holeCrossing.threadCost,
  }),
  level({
    id: 'bedroom-05-thread-budget',
    version: 2,
    order: 5,
    quiltId: BEDROOM_QUILT.id,
    name: 'Measured Thread',
    mechanic: 'Climb left with one measured seam',
    referenceSolution: [budgetPull],
    baseSlope: Object.freeze({ x: 0, y: 0.11, originHeight: 0 }),
    traveler: Object.freeze({
      start: point(0.7, 1.36),
      radius: DEFAULT_TRAVELER.radius,
    }),
    goal: Object.freeze({
      center: point(0.22, 0.99),
      radius: DEFAULT_GOAL.radius,
      maxEntrySpeed: DEFAULT_GOAL.maxEntrySpeed,
    }),
    maxStitches: 1,
    threadBudget: budgetPull.threadCost,
    targetThreadUsage: budgetPull.threadCost,
  }),
  level({
    id: 'attic-06-silk-slide',
    version: 2,
    order: 6,
    quiltId: ATTIC_QUILT.id,
    name: 'Silk Slide',
    mechanic: 'Ride a fast silk lane from right to left',
    referenceSolution: [silkPull],
    baseSlope: Object.freeze({ x: 0.11, y: 0, originHeight: 0 }),
    traveler: Object.freeze({
      start: point(0.86, 0.3),
      radius: DEFAULT_TRAVELER.radius,
    }),
    goal: Object.freeze({
      center: point(0.49, 0.78),
      radius: DEFAULT_GOAL.radius,
      maxEntrySpeed: DEFAULT_GOAL.maxEntrySpeed,
    }),
    fabricRegions: [
      region('silk-runway', 'silk', {
        x: 0.2,
        y: 0,
        width: 0.8,
        height: 0.96,
      }),
    ],
    physicsConfig: Object.freeze({
      ...CAMPAIGN_PHYSICS_CONFIG,
      rollingFriction: 0.2,
    }),
    maxStitches: 2,
    threadBudget: 125,
    targetThreadUsage: silkPull.threadCost,
  }),
  level({
    id: 'attic-07-pocket-catch',
    version: 2,
    order: 7,
    quiltId: ATTIC_QUILT.id,
    name: 'Pocket Catch',
    mechanic: 'Catch a leftward curve with one pocket',
    referenceSolution: [pocketCatch],
    traveler: Object.freeze({
      start: point(0.7, 0.14),
      radius: DEFAULT_TRAVELER.radius,
    }),
    goal: Object.freeze({
      center: point(0.37, 0.49),
      radius: 0.08,
      maxEntrySpeed: 0.7,
    }),
    allowedStitchTypes: ['pocket'],
    maxStitches: 1,
    threadBudget: 60,
    targetThreadUsage: pocketCatch.threadCost,
  }),
  level({
    id: 'attic-08-felt-and-silk',
    version: 2,
    order: 8,
    quiltId: ATTIC_QUILT.id,
    name: 'Crosscut Glide',
    mechanic: 'Sweep sideways from silk into felt',
    referenceSolution: [mixedPull],
    baseSlope: Object.freeze({ x: -0.11, y: 0, originHeight: 0 }),
    traveler: Object.freeze({
      start: point(0.14, 0.3),
      radius: DEFAULT_TRAVELER.radius,
    }),
    goal: Object.freeze({
      center: point(0.51, 0.78),
      radius: 0.06,
      maxEntrySpeed: 0.35,
    }),
    fabricRegions: [
      region('mixed-silk', 'silk', {
        x: 0.2,
        y: 0.42,
        width: 0.25,
        height: 0.52,
      }),
      region('mixed-felt', 'felt', {
        x: 0.45,
        y: 0.52,
        width: 0.3,
        height: 0.42,
      }),
    ],
    physicsConfig: Object.freeze({
      ...CAMPAIGN_PHYSICS_CONFIG,
      rollingFriction: 0.16,
    }),
    maxStitches: 2,
    threadBudget: 125,
    targetThreadUsage: mixedPull.threadCost,
  }),
  level({
    id: 'attic-09-two-stitches',
    version: 2,
    order: 9,
    quiltId: ATTIC_QUILT.id,
    name: 'Uphill Switchback',
    mechanic: 'Climb with two offset ridges',
    referenceSolution: [combinationTop, combinationBottom],
    baseSlope: Object.freeze({ x: 0, y: 0.11, originHeight: 0 }),
    traveler: Object.freeze({
      start: point(0.3, 1.36),
      radius: DEFAULT_TRAVELER.radius,
    }),
    goal: Object.freeze({
      center: point(0.51, 0.81),
      radius: 0.06,
      maxEntrySpeed: 1.2,
    }),
    maxStitches: 2,
    threadBudget: 180,
    targetThreadUsage: combinationTop.threadCost + combinationBottom.threadCost,
  }),
  level({
    id: 'attic-10-hidden-patch',
    version: 2,
    order: 10,
    quiltId: ATTIC_QUILT.id,
    name: 'Patchwork Reversal',
    mechanic: 'Reverse uphill to snag the hidden patch',
    referenceSolution: [patchPull],
    baseSlope: Object.freeze({ x: 0, y: 0.11, originHeight: 0 }),
    traveler: Object.freeze({
      start: point(0.7, 1.36),
      radius: DEFAULT_TRAVELER.radius,
    }),
    goal: Object.freeze({
      center: point(0.22, 0.99),
      radius: DEFAULT_GOAL.radius,
      maxEntrySpeed: DEFAULT_GOAL.maxEntrySpeed,
    }),
    collectible: collectible('attic-patch', point(0.28, 1.03)),
    maxStitches: 2,
    threadBudget: 125,
    targetThreadUsage: patchPull.threadCost,
  }),
  level({
    id: 'festival-11-thorn-turn',
    version: 2,
    order: 11,
    quiltId: FESTIVAL_QUILT.id,
    name: 'Thorn Slalom',
    mechanic: 'Sweep sideways above a thorn',
    referenceSolution: [thornPull],
    baseSlope: Object.freeze({ x: -0.11, y: 0, originHeight: 0 }),
    traveler: Object.freeze({
      start: point(0.14, 1.2),
      radius: DEFAULT_TRAVELER.radius,
    }),
    goal: Object.freeze({
      center: point(0.51, 0.72),
      radius: DEFAULT_GOAL.radius,
      maxEntrySpeed: DEFAULT_GOAL.maxEntrySpeed,
    }),
    hazards: [hazard('festival-thorn', 'thorn', point(0.5, 1.19), 0.05)],
    maxStitches: 2,
    threadBudget: 125,
    targetThreadUsage: thornPull.threadCost,
  }),
  level({
    id: 'festival-12-elastic-bounce',
    version: 2,
    order: 12,
    quiltId: FESTIVAL_QUILT.id,
    name: 'Button Bank',
    mechanic: 'Bank a reverse shot off elastic',
    referenceSolution: [elasticPull],
    baseSlope: Object.freeze({ x: 0.11, y: 0, originHeight: 0 }),
    traveler: Object.freeze({
      start: point(0.86, 0.3),
      radius: DEFAULT_TRAVELER.radius,
    }),
    goal: Object.freeze({
      center: point(0.55, 0.43),
      radius: 0.07,
      maxEntrySpeed: 0.7,
    }),
    fabricRegions: [
      region('elastic-impact', 'elastic', {
        x: 0.25,
        y: 0.5,
        width: 0.55,
        height: 0.44,
      }),
    ],
    bumpers: [
      bumper('festival-button', point(0.6, 0.73), 0.055, 0.35),
    ],
    maxStitches: 2,
    threadBudget: 125,
    targetThreadUsage: elasticPull.threadCost,
  }),
  level({
    id: 'festival-13-pinch-pocket',
    version: 2,
    order: 13,
    quiltId: FESTIVAL_QUILT.id,
    name: 'Climb and Catch',
    mechanic: 'Ridge uphill, then pocket the drop',
    referenceSolution: [pinchPocketRidge, pinchPocketCatch],
    baseSlope: Object.freeze({ x: 0, y: 0.11, originHeight: 0 }),
    traveler: Object.freeze({
      start: point(0.3, 1.36),
      radius: DEFAULT_TRAVELER.radius,
    }),
    goal: Object.freeze({
      center: point(0.76, 0.23),
      radius: 0.065,
      maxEntrySpeed: 1.2,
    }),
    allowedStitchTypes: ['pinch', 'pocket'],
    maxStitches: 2,
    threadBudget: 130,
    targetThreadUsage:
      pinchPocketRidge.threadCost + pinchPocketCatch.threadCost,
  }),
  level({
    id: 'festival-14-tight-limit',
    version: 2,
    order: 14,
    quiltId: FESTIVAL_QUILT.id,
    name: 'Single Seam',
    mechanic: 'One sideways seam through a narrow gap',
    referenceSolution: [tightPull],
    baseSlope: Object.freeze({ x: 0.11, y: 0, originHeight: 0 }),
    traveler: Object.freeze({
      start: point(0.86, 1.2),
      radius: DEFAULT_TRAVELER.radius,
    }),
    goal: Object.freeze({
      center: point(0.49, 0.72),
      radius: DEFAULT_GOAL.radius,
      maxEntrySpeed: DEFAULT_GOAL.maxEntrySpeed,
    }),
    hazards: [hazard('tight-limit-hole', 'hole', point(0.42, 1.19), 0.045)],
    maxStitches: 1,
    threadBudget: 95,
    targetThreadUsage: tightPull.threadCost,
  }),
  level({
    id: 'festival-15-finale',
    version: 2,
    order: 15,
    quiltId: FESTIVAL_QUILT.id,
    name: 'Festival Finale',
    mechanic: 'Three-stage run across every material',
    referenceSolution: [finaleTop, finaleBottom, finalePocket],
    traveler: Object.freeze({
      start: point(0.7, 0.14),
      radius: DEFAULT_TRAVELER.radius,
    }),
    goal: Object.freeze({
      center: point(0.38, 0.62),
      radius: 0.04,
      maxEntrySpeed: 0.4,
    }),
    fabricRegions: [
      region('finale-silk', 'silk', {
        x: 0.06,
        y: 0.24,
        width: 0.48,
        height: 0.24,
      }),
      region('finale-felt', 'felt', {
        x: 0.06,
        y: 0.48,
        width: 0.4,
        height: 0.28,
      }),
      region('finale-elastic', 'elastic', {
        x: 0.07,
        y: 0.76,
        width: 0.38,
        height: 0.34,
      }),
    ],
    hazards: [
      hazard('finale-thorn', 'thorn', point(0.1, 0.66), 0.045),
    ],
    bumpers: [bumper('finale-button', point(0.22, 0.9), 0.055, 0.35)],
    collectible: collectible('festival-patch', point(0.28, 0.47)),
    allowedStitchTypes: ['pinch', 'pocket'],
    maxStitches: 3,
    threadBudget: 140,
    targetThreadUsage:
      finaleTop.threadCost + finaleBottom.threadCost + finalePocket.threadCost,
  }),
]);

validateCampaignCatalog(CAMPAIGN_QUILTS, CAMPAIGN_LEVELS);

const legacyEdgeRedirect = pinch(
  'edge-redirect-reference',
  0.24,
  0.08,
  0.98,
);
const legacyFeltLanding = pinch(
  'felt-landing-reference',
  0.23,
  0.1,
  1,
);
const legacyHoleCrossing = pinch(
  'hole-crossing-reference',
  0.22,
  0.08,
  1,
);
const legacyBudgetPull = pinch(
  'budget-pull-reference',
  0.23,
  0.12,
  0.98,
);
const legacySilkPull = pinch(
  'silk-pull-reference',
  0.22,
  0.08,
  1.02,
);

/**
 * Immutable Daily Scrap v1 definitions. The dated pool may resolve these
 * versions after the campaign moves forward, keeping historical challenge ids
 * and submitted replays deterministic.
 */
export const LEGACY_DAILY_LEVELS_V1: readonly LevelDefinition[] = Object.freeze([
  level({
    id: 'bedroom-02-edge-redirect',
    order: 2,
    quiltId: BEDROOM_QUILT.id,
    name: 'Edge Redirect',
    mechanic: 'Redirect around a boundary',
    referenceSolution: [legacyEdgeRedirect],
    maxStitches: 2,
    threadBudget: 125,
    targetThreadUsage: legacyEdgeRedirect.threadCost,
  }),
  level({
    id: 'bedroom-03-felt-landing',
    order: 3,
    quiltId: BEDROOM_QUILT.id,
    name: 'Felt Landing',
    mechanic: 'Stop on felt',
    referenceSolution: [legacyFeltLanding],
    goal: Object.freeze({
      ...DEFAULT_GOAL,
      maxEntrySpeed: 0.38,
    }),
    fabricRegions: [
      region('felt-landing', 'felt', {
        x: 0.52,
        y: 0.32,
        width: 0.42,
        height: 0.4,
      }),
    ],
    maxStitches: 2,
    threadBudget: 120,
    targetThreadUsage: legacyFeltLanding.threadCost,
  }),
  level({
    id: 'bedroom-04-hole-crossing',
    order: 4,
    quiltId: BEDROOM_QUILT.id,
    name: 'Hole Crossing',
    mechanic: 'Cross a small hole',
    referenceSolution: [legacyHoleCrossing],
    hazards: [hazard('bedroom-hole', 'hole', point(0.31, 0.55), 0.055)],
    maxStitches: 2,
    threadBudget: 120,
    targetThreadUsage: legacyHoleCrossing.threadCost,
  }),
  level({
    id: 'bedroom-05-thread-budget',
    order: 5,
    quiltId: BEDROOM_QUILT.id,
    name: 'Measured Thread',
    mechanic: 'Complete under a thread budget',
    referenceSolution: [legacyBudgetPull],
    maxStitches: 1,
    threadBudget: legacyBudgetPull.threadCost,
    targetThreadUsage: legacyBudgetPull.threadCost,
  }),
  level({
    id: 'attic-06-silk-slide',
    order: 6,
    quiltId: ATTIC_QUILT.id,
    name: 'Silk Slide',
    mechanic: 'First silk region',
    referenceSolution: [legacySilkPull],
    fabricRegions: [
      region('silk-runway', 'silk', {
        x: 0,
        y: 0,
        width: 0.96,
        height: 0.8,
      }),
    ],
    physicsConfig: Object.freeze({
      ...CAMPAIGN_PHYSICS_CONFIG,
      rollingFriction: 0.2,
    }),
    maxStitches: 2,
    threadBudget: 125,
    targetThreadUsage: legacySilkPull.threadCost,
  }),
]);

for (const legacyLevel of LEGACY_DAILY_LEVELS_V1) {
  validateLevelDefinition(legacyLevel);
}
