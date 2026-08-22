import { calculateThreadCost, calculateThreadUsed } from '../core/scoring';
import {
  releaseSimulation,
  stepSimulation,
} from '../core/simulation';
import type {
  Point,
  SimulationOutcome,
  Stitch,
} from '../core/types';
import {
  isValidStitchDrag,
  SPIKE_STITCH_RADIUS,
} from '../input/stitchGesture';
import {
  createSpikeSimulation,
  createSpikeWorld,
  SPIKE_LEVEL,
  SPIKE_PHYSICS_CONFIG,
} from '../levels/spikeLevel';

export const SPIKE_REPLAY_SCHEMA_VERSION = 1 as const;

export interface ReplayStitchV1 {
  readonly id: string;
  readonly type: 'pinch';
  readonly start: Point;
  readonly end: Point;
  readonly tension: number;
  readonly radius: number;
  readonly threadCost: number;
}

/**
 * JSON-safe record of every player-authored input needed to reproduce a run.
 * The level version owns the authored surface and physics constants, so a
 * replay is rejected instead of silently changing when those rules change.
 */
export interface SpikeReplayV1 {
  readonly schemaVersion: typeof SPIKE_REPLAY_SCHEMA_VERSION;
  readonly levelId: string;
  readonly levelVersion: number;
  readonly stitches: readonly ReplayStitchV1[];
}

export interface SpikeReplayRun {
  readonly points: readonly Point[];
  readonly outcome: SimulationOutcome;
  readonly finalPosition: Point;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clonePoint(value: unknown, label: string): Point {
  if (!isRecord(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  const { x, y } = value;
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new RangeError(`${label} coordinates must be finite numbers.`);
  }

  const bounds = SPIKE_LEVEL.fabricBounds;
  if (
    (x as number) < bounds.x ||
    (x as number) > bounds.x + bounds.width ||
    (y as number) < bounds.y ||
    (y as number) > bounds.y + bounds.height
  ) {
    throw new RangeError(`${label} must be inside the fabric bounds.`);
  }

  return Object.freeze({ x: x as number, y: y as number });
}

function cloneStitch(value: unknown, index: number): ReplayStitchV1 {
  const label = `Replay stitch ${index}`;
  if (!isRecord(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  if (typeof value.id !== 'string' || value.id.length === 0) {
    throw new TypeError(`${label} must have a non-empty string id.`);
  }
  if (value.type !== 'pinch') {
    throw new RangeError(`${label} uses an unsupported stitch type.`);
  }
  if (value.tension !== 1) {
    throw new RangeError(`${label} tension is not authored by this level.`);
  }
  if (value.radius !== SPIKE_STITCH_RADIUS) {
    throw new RangeError(`${label} radius is not authored by this level.`);
  }
  if (
    !Number.isInteger(value.threadCost) ||
    (value.threadCost as number) < 0
  ) {
    throw new RangeError(`${label} thread cost must be a non-negative integer.`);
  }

  const start = clonePoint(value.start, `${label} start`);
  const end = clonePoint(value.end, `${label} end`);
  if (!isValidStitchDrag(start, end)) {
    throw new RangeError(`${label} is shorter than the level minimum.`);
  }
  const expectedThreadCost = calculateThreadCost(start, end);
  if (value.threadCost !== expectedThreadCost) {
    throw new RangeError(`${label} thread cost does not match its endpoints.`);
  }

  return Object.freeze({
    id: value.id,
    type: 'pinch',
    start,
    end,
    tension: value.tension as number,
    radius: value.radius as number,
    threadCost: value.threadCost as number,
  });
}

/** Validates unknown data and returns a detached, deeply frozen replay. */
export function parseSpikeReplay(value: unknown): SpikeReplayV1 {
  if (!isRecord(value)) {
    throw new TypeError('Replay must be an object.');
  }
  if (value.schemaVersion !== SPIKE_REPLAY_SCHEMA_VERSION) {
    throw new RangeError('Replay schema version is not supported.');
  }
  if (value.levelId !== SPIKE_LEVEL.id) {
    throw new RangeError('Replay level is not supported.');
  }
  if (value.levelVersion !== SPIKE_LEVEL.version) {
    throw new RangeError('Replay level version is not supported.');
  }
  if (!Array.isArray(value.stitches)) {
    throw new TypeError('Replay stitches must be an array.');
  }
  if (value.stitches.length > SPIKE_LEVEL.maxStitches) {
    throw new RangeError('Replay exceeds the level stitch limit.');
  }

  const stitches = value.stitches.map(cloneStitch);
  const ids = new Set(stitches.map((stitch) => stitch.id));
  if (ids.size !== stitches.length) {
    throw new RangeError('Replay stitch ids must be unique.');
  }
  if (calculateThreadUsed(stitches) > SPIKE_LEVEL.threadBudget) {
    throw new RangeError('Replay exceeds the level thread budget.');
  }

  return Object.freeze({
    schemaVersion: SPIKE_REPLAY_SCHEMA_VERSION,
    levelId: SPIKE_LEVEL.id,
    levelVersion: SPIKE_LEVEL.version,
    stitches: Object.freeze(stitches),
  });
}

export function createSpikeReplay(
  stitches: readonly Stitch[],
): SpikeReplayV1 {
  return parseSpikeReplay({
    schemaVersion: SPIKE_REPLAY_SCHEMA_VERSION,
    levelId: SPIKE_LEVEL.id,
    levelVersion: SPIKE_LEVEL.version,
    stitches,
  });
}

export function serializeSpikeReplay(replay: SpikeReplayV1): string {
  return JSON.stringify(parseSpikeReplay(replay));
}

export function deserializeSpikeReplay(serialized: string): SpikeReplayV1 {
  return parseSpikeReplay(JSON.parse(serialized) as unknown);
}

/** Runs a replay through the same fixed-step world used by live gameplay. */
export function simulateSpikeReplay(
  replay: SpikeReplayV1,
  sampleEveryTicks = 8,
): SpikeReplayRun {
  if (!Number.isInteger(sampleEveryTicks) || sampleEveryTicks <= 0) {
    throw new RangeError('Replay sample interval must be a positive integer.');
  }

  const validated = parseSpikeReplay(replay);
  const simulation = createSpikeSimulation();
  const world = createSpikeWorld(validated.stitches);
  const points: Point[] = [
    Object.freeze({ ...simulation.traveler.position }),
  ];

  releaseSimulation(simulation);
  while (simulation.phase === 'running') {
    stepSimulation(simulation, world, SPIKE_PHYSICS_CONFIG);
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
