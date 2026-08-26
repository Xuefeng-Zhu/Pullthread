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
    physicsConfig: CAMPAIGN_PHYSICS_CONFIG,
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
const edgeRedirect = pinch('edge-redirect-reference', 0.24, 0.08, 0.98);
const feltLanding = pinch('felt-landing-reference', 0.23, 0.1, 1);
const holeCrossing = pinch('hole-crossing-reference', 0.22, 0.08, 1);
const budgetPull = pinch('budget-pull-reference', 0.23, 0.12, 0.98);
const silkPull = pinch('silk-pull-reference', 0.22, 0.08, 1.02);
const pocketCatch = pocket(
  'pocket-catch-reference',
  point(0.37, 0.3),
  point(0.53, 0.3),
);
const mixedPull = pinch('mixed-pull-reference', 0.23, 0.08, 1.02);
const combinationTop = pinch(
  'combination-top-reference',
  0.23,
  0.1,
  0.65,
);
const combinationBottom = pinch(
  'combination-bottom-reference',
  0.23,
  0.45,
  1,
);
const patchPull = pinch('patch-pull-reference', 0.23, 0.08, 1.02);
const thornPull = pinch('thorn-pull-reference', 0.21, 0.08, 1.02);
const elasticPull = pinch('elastic-pull-reference', 0.23, 0.08, 1.02);
const pinchPocketRidge = pinch(
  'pinch-pocket-ridge-reference',
  0.23,
  0.08,
  0.88,
);
const pinchPocketCatch = pocket(
  'pinch-pocket-catch-reference',
  point(0.64, 0.43),
  point(0.76, 0.55),
);
const tightPull = pinch('tight-pull-reference', 0.23, 0.1, 1);
const finaleTop = pinch('finale-top-reference', 0.22, 0.08, 0.56);
const finaleBottom = pinch('finale-bottom-reference', 0.22, 0.56, 1.02);
const finalePocket = pocket(
  'finale-pocket-reference',
  point(0.66, 0.44),
  point(0.76, 0.54),
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
    order: 2,
    quiltId: BEDROOM_QUILT.id,
    name: 'Edge Redirect',
    mechanic: 'Redirect around a boundary',
    referenceSolution: [edgeRedirect],
    bumpers: [bumper('edge-button', point(0.9, 1.08), 0.06)],
    maxStitches: 2,
    threadBudget: 125,
    targetThreadUsage: edgeRedirect.threadCost,
  }),
  level({
    id: 'bedroom-03-felt-landing',
    order: 3,
    quiltId: BEDROOM_QUILT.id,
    name: 'Felt Landing',
    mechanic: 'Stop on felt',
    referenceSolution: [feltLanding],
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
    targetThreadUsage: feltLanding.threadCost,
  }),
  level({
    id: 'bedroom-04-hole-crossing',
    order: 4,
    quiltId: BEDROOM_QUILT.id,
    name: 'Hole Crossing',
    mechanic: 'Cross a small hole',
    referenceSolution: [holeCrossing],
    hazards: [hazard('bedroom-hole', 'hole', point(0.31, 0.55), 0.055)],
    maxStitches: 2,
    threadBudget: 120,
    targetThreadUsage: holeCrossing.threadCost,
  }),
  level({
    id: 'bedroom-05-thread-budget',
    order: 5,
    quiltId: BEDROOM_QUILT.id,
    name: 'Measured Thread',
    mechanic: 'Complete under a thread budget',
    referenceSolution: [budgetPull],
    maxStitches: 1,
    threadBudget: budgetPull.threadCost,
    targetThreadUsage: budgetPull.threadCost,
  }),
  level({
    id: 'attic-06-silk-slide',
    order: 6,
    quiltId: ATTIC_QUILT.id,
    name: 'Silk Slide',
    mechanic: 'First silk region',
    referenceSolution: [silkPull],
    fabricRegions: [
      region('silk-runway', 'silk', {
        x: 0.46,
        y: 0.28,
        width: 0.5,
        height: 0.48,
      }),
    ],
    maxStitches: 2,
    threadBudget: 125,
    targetThreadUsage: silkPull.threadCost,
  }),
  level({
    id: 'attic-07-pocket-catch',
    order: 7,
    quiltId: ATTIC_QUILT.id,
    name: 'Pocket Catch',
    mechanic: 'First pocket stitch',
    referenceSolution: [pocketCatch],
    goal: Object.freeze({
      center: point(0.63, 0.49),
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
    order: 8,
    quiltId: ATTIC_QUILT.id,
    name: 'Felt and Silk',
    mechanic: 'Felt and silk in one level',
    referenceSolution: [mixedPull],
    fabricRegions: [
      region('mixed-silk', 'silk', {
        x: 0.42,
        y: 0.2,
        width: 0.52,
        height: 0.25,
      }),
      region('mixed-felt', 'felt', {
        x: 0.52,
        y: 0.45,
        width: 0.42,
        height: 0.3,
      }),
    ],
    maxStitches: 2,
    threadBudget: 125,
    targetThreadUsage: mixedPull.threadCost,
  }),
  level({
    id: 'attic-09-two-stitches',
    order: 9,
    quiltId: ATTIC_QUILT.id,
    name: 'Two-Stitch Turn',
    mechanic: 'Two-stitch combination',
    referenceSolution: [combinationTop, combinationBottom],
    maxStitches: 2,
    threadBudget: 180,
    targetThreadUsage: combinationTop.threadCost + combinationBottom.threadCost,
  }),
  level({
    id: 'attic-10-hidden-patch',
    order: 10,
    quiltId: ATTIC_QUILT.id,
    name: 'Hidden Patch',
    mechanic: 'Hidden collectible patch',
    referenceSolution: [patchPull],
    collectible: collectible('attic-patch', point(0.72, 0.47)),
    maxStitches: 2,
    threadBudget: 125,
    targetThreadUsage: patchPull.threadCost,
  }),
  level({
    id: 'festival-11-thorn-turn',
    order: 11,
    quiltId: FESTIVAL_QUILT.id,
    name: 'Thorn Turn',
    mechanic: 'Thorn hazard',
    referenceSolution: [thornPull],
    hazards: [hazard('festival-thorn', 'thorn', point(0.31, 0.5), 0.05)],
    maxStitches: 2,
    threadBudget: 125,
    targetThreadUsage: thornPull.threadCost,
  }),
  level({
    id: 'festival-12-elastic-bounce',
    order: 12,
    quiltId: FESTIVAL_QUILT.id,
    name: 'Elastic Bounce',
    mechanic: 'Elastic fabric',
    referenceSolution: [elasticPull],
    goal: Object.freeze({
      center: point(0.43, 0.45),
      radius: 0.07,
      maxEntrySpeed: 0.7,
    }),
    fabricRegions: [
      region('elastic-impact', 'elastic', {
        x: 0.5,
        y: 0.2,
        width: 0.44,
        height: 0.55,
      }),
    ],
    bumpers: [
      bumper('festival-button', point(0.73, 0.4), 0.055, 0.35),
    ],
    maxStitches: 2,
    threadBudget: 125,
    targetThreadUsage: elasticPull.threadCost,
  }),
  level({
    id: 'festival-13-pinch-pocket',
    order: 13,
    quiltId: FESTIVAL_QUILT.id,
    name: 'Pinch and Pocket',
    mechanic: 'Pinch and pocket combination',
    referenceSolution: [pinchPocketRidge, pinchPocketCatch],
    allowedStitchTypes: ['pinch', 'pocket'],
    maxStitches: 2,
    threadBudget: 130,
    targetThreadUsage:
      pinchPocketRidge.threadCost + pinchPocketCatch.threadCost,
  }),
  level({
    id: 'festival-14-tight-limit',
    order: 14,
    quiltId: FESTIVAL_QUILT.id,
    name: 'One Last Stitch',
    mechanic: 'Tight stitch-count limit',
    referenceSolution: [tightPull],
    hazards: [hazard('tight-limit-hole', 'hole', point(0.31, 0.58), 0.045)],
    maxStitches: 1,
    threadBudget: 95,
    targetThreadUsage: tightPull.threadCost,
  }),
  level({
    id: 'festival-15-finale',
    order: 15,
    quiltId: FESTIVAL_QUILT.id,
    name: 'Festival Finale',
    mechanic: 'Multi-stage finale',
    referenceSolution: [finaleTop, finaleBottom, finalePocket],
    goal: Object.freeze({
      center: point(0.69, 0.49),
      radius: 0.05,
      maxEntrySpeed: 0.7,
    }),
    fabricRegions: [
      region('finale-silk', 'silk', {
        x: 0.46,
        y: 0.24,
        width: 0.48,
        height: 0.24,
      }),
      region('finale-felt', 'felt', {
        x: 0.54,
        y: 0.48,
        width: 0.4,
        height: 0.28,
      }),
      region('finale-elastic', 'elastic', {
        x: 0.55,
        y: 0.76,
        width: 0.38,
        height: 0.34,
      }),
    ],
    hazards: [
      hazard('finale-hole', 'hole', point(0.12, 0.66), 0.05),
      hazard('finale-thorn', 'thorn', point(0.9, 0.66), 0.045),
    ],
    bumpers: [bumper('finale-button', point(0.78, 0.9), 0.055, 0.35)],
    collectible: collectible('festival-patch', point(0.72, 0.47)),
    allowedStitchTypes: ['pinch', 'pocket'],
    maxStitches: 3,
    threadBudget: 140,
    targetThreadUsage:
      finaleTop.threadCost + finaleBottom.threadCost + finalePocket.threadCost,
  }),
]);

validateCampaignCatalog(CAMPAIGN_QUILTS, CAMPAIGN_LEVELS);
