import { calculateThreadCost, calculateThreadUsed } from '../core/scoring';
import { quantizePoint } from '../core/geometry';
import { releaseSimulation, stepSimulation } from '../core/simulation';
import type {
  Point,
  SimulationOutcome,
  Stitch,
  StitchType,
} from '../core/types';
import {
  isValidStitchDrag,
  POCKET_STITCH_RADIUS,
  SPIKE_STITCH_RADIUS,
} from '../input/stitchGesture';
import {
  createLevelSimulation,
  createLevelWorld,
  getCampaignLevel,
  getLevelVersion,
} from '../levels/levelLoader';
import type { LevelDefinition } from '../levels/schema';

export const LEVEL_REPLAY_SCHEMA_VERSION = 1 as const;

export interface LevelReplayStitchV1 {
  readonly id: string;
  readonly type: StitchType;
  readonly start: Point;
  readonly end: Point;
  readonly tension: number;
  readonly radius: number;
  readonly threadCost: number;
}

/**
 * JSON-safe record of every player-authored input needed to reproduce a run.
 * The catalog level version owns the surface and physics rules, so playback
 * rejects stale or unknown levels instead of silently changing their result.
 */
export interface LevelReplayV1 {
  readonly schemaVersion: typeof LEVEL_REPLAY_SCHEMA_VERSION;
  readonly levelId: string;
  readonly levelVersion: number;
  readonly stitches: readonly LevelReplayStitchV1[];
}

export interface LevelReplayRun {
  readonly points: readonly Point[];
  readonly outcome: SimulationOutcome;
  readonly finalPosition: Point;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function catalogLevelForReplay(
  levelId: unknown,
  levelVersion: unknown,
): LevelDefinition {
  if (typeof levelId !== 'string') {
    throw new TypeError('Replay level id must be a string.');
  }
  if (
    typeof levelVersion !== 'number' ||
    !Number.isSafeInteger(levelVersion) ||
    levelVersion <= 0
  ) {
    throw new RangeError('Replay level version is not supported.');
  }

  try {
    return getLevelVersion(levelId, levelVersion);
  } catch {
    try {
      getCampaignLevel(levelId);
    } catch {
      throw new RangeError('Replay level is not supported.');
    }
    throw new RangeError('Replay level version is not supported.');
  }
}

function assertCatalogLevel(level: LevelDefinition): LevelDefinition {
  return catalogLevelForReplay(level.id, level.version);
}

function pointInsideBounds(point: Point, level: LevelDefinition): boolean {
  const bounds = level.fabricBounds;
  return (
    point.x >= bounds.x &&
    point.x <= bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y <= bounds.y + bounds.height
  );
}

function clonePoint(
  value: unknown,
  label: string,
  level: LevelDefinition,
): Point {
  if (!isRecord(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  const { x, y } = value;
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new RangeError(`${label} coordinates must be finite numbers.`);
  }

  const point = { x: x as number, y: y as number };
  if (!pointInsideBounds(point, level)) {
    throw new RangeError(`${label} must be inside the fabric bounds.`);
  }

  const quantized = quantizePoint(point);
  if (quantized.x !== point.x || quantized.y !== point.y) {
    throw new RangeError(`${label} must use canonical quantized coordinates.`);
  }

  return Object.freeze(point);
}

function authoredRadius(type: StitchType): number {
  return type === 'pocket' ? POCKET_STITCH_RADIUS : SPIKE_STITCH_RADIUS;
}

function cloneStitch(
  value: unknown,
  index: number,
  level: LevelDefinition,
): LevelReplayStitchV1 {
  const label = `Replay stitch ${index}`;
  if (!isRecord(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  if (typeof value.id !== 'string' || value.id.length === 0) {
    throw new TypeError(`${label} must have a non-empty string id.`);
  }
  if (value.type !== 'pinch' && value.type !== 'pocket') {
    throw new RangeError(`${label} uses an unsupported stitch type.`);
  }
  if (!level.allowedStitchTypes.includes(value.type)) {
    throw new RangeError(`${label} uses a stitch type not allowed by this level.`);
  }
  if (value.tension !== 1) {
    throw new RangeError(`${label} tension is not authored by this level.`);
  }
  if (value.radius !== authoredRadius(value.type)) {
    throw new RangeError(`${label} radius is not authored for its stitch type.`);
  }
  if (!Number.isSafeInteger(value.threadCost) || (value.threadCost as number) < 0) {
    throw new RangeError(`${label} thread cost must be a non-negative integer.`);
  }

  const start = clonePoint(value.start, `${label} start`, level);
  const end = clonePoint(value.end, `${label} end`, level);
  if (!isValidStitchDrag(start, end)) {
    throw new RangeError(`${label} is shorter than the level minimum.`);
  }
  const expectedThreadCost = calculateThreadCost(start, end);
  if (value.threadCost !== expectedThreadCost) {
    throw new RangeError(`${label} thread cost does not match its endpoints.`);
  }

  return Object.freeze({
    id: value.id,
    type: value.type,
    start,
    end,
    tension: value.tension as number,
    radius: value.radius as number,
    threadCost: value.threadCost as number,
  });
}

/** Validates unknown data against the current catalog and deeply freezes it. */
export function parseLevelReplay(value: unknown): LevelReplayV1 {
  if (!isRecord(value)) {
    throw new TypeError('Replay must be an object.');
  }
  if (value.schemaVersion !== LEVEL_REPLAY_SCHEMA_VERSION) {
    throw new RangeError('Replay schema version is not supported.');
  }

  const level = catalogLevelForReplay(value.levelId, value.levelVersion);
  if (!Array.isArray(value.stitches)) {
    throw new TypeError('Replay stitches must be an array.');
  }
  if (value.stitches.length > level.maxStitches) {
    throw new RangeError('Replay exceeds the level stitch limit.');
  }

  const stitches = value.stitches.map((stitch, index) =>
    cloneStitch(stitch, index, level),
  );
  const ids = new Set(stitches.map((stitch) => stitch.id));
  if (ids.size !== stitches.length) {
    throw new RangeError('Replay stitch ids must be unique.');
  }
  if (calculateThreadUsed(stitches) > level.threadBudget) {
    throw new RangeError('Replay exceeds the level thread budget.');
  }

  return Object.freeze({
    schemaVersion: LEVEL_REPLAY_SCHEMA_VERSION,
    levelId: level.id,
    levelVersion: level.version,
    stitches: Object.freeze(stitches),
  });
}

export function createLevelReplay(
  level: LevelDefinition,
  stitches: readonly Stitch[],
): LevelReplayV1 {
  const catalogLevel = assertCatalogLevel(level);
  return parseLevelReplay({
    schemaVersion: LEVEL_REPLAY_SCHEMA_VERSION,
    levelId: catalogLevel.id,
    levelVersion: catalogLevel.version,
    stitches,
  });
}

export function serializeLevelReplay(replay: LevelReplayV1): string {
  return JSON.stringify(parseLevelReplay(replay));
}

export function deserializeLevelReplay(serialized: string): LevelReplayV1 {
  return parseLevelReplay(JSON.parse(serialized) as unknown);
}

/** Runs a replay through the same catalog-authored fixed-step world as gameplay. */
export function simulateLevelReplay(
  replay: LevelReplayV1,
  sampleEveryTicks = 8,
): LevelReplayRun {
  if (!Number.isInteger(sampleEveryTicks) || sampleEveryTicks <= 0) {
    throw new RangeError('Replay sample interval must be a positive integer.');
  }

  const validated = parseLevelReplay(replay);
  const level = getLevelVersion(validated.levelId, validated.levelVersion);
  const simulation = createLevelSimulation(level);
  const world = createLevelWorld(level, validated.stitches);
  const points: Point[] = [Object.freeze({ ...simulation.traveler.position })];

  releaseSimulation(simulation);
  while (simulation.phase === 'running') {
    stepSimulation(simulation, world, level.physicsConfig);
    if (
      simulation.tick % sampleEveryTicks === 0 ||
      simulation.phase !== 'running'
    ) {
      points.push(Object.freeze({ ...simulation.traveler.position }));
    }
  }

  if (!simulation.outcome) {
    throw new Error('The deterministic replay ended without an outcome.');
  }

  return Object.freeze({
    points: Object.freeze(points),
    outcome: Object.freeze({ ...simulation.outcome }),
    finalPosition: Object.freeze({ ...simulation.traveler.position }),
  });
}
