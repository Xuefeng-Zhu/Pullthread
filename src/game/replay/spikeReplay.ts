import type { Stitch } from '../core/types';
import { SPIKE_LEVEL } from '../levels/spikeLevel';
import {
  createLevelReplay,
  LEVEL_REPLAY_SCHEMA_VERSION,
  parseLevelReplay,
  serializeLevelReplay,
  simulateLevelReplay,
  type LevelReplayRun,
  type LevelReplayStitchV1,
  type LevelReplayV1,
} from './levelReplay';

/** @deprecated Use LEVEL_REPLAY_SCHEMA_VERSION for campaign-aware replays. */
export const SPIKE_REPLAY_SCHEMA_VERSION = LEVEL_REPLAY_SCHEMA_VERSION;

/** Level id written by the original technical-spike replay format. */
const LEGACY_SPIKE_LEVEL_ID = 'technical-spike';

/** @deprecated Use LevelReplayStitchV1. */
export interface ReplayStitchV1 extends LevelReplayStitchV1 {
  readonly type: 'pinch';
}

/** @deprecated Use LevelReplayV1. */
export interface SpikeReplayV1 extends LevelReplayV1 {
  readonly stitches: readonly ReplayStitchV1[];
}

/** @deprecated Use LevelReplayRun. */
export type SpikeReplayRun = LevelReplayRun;

function assertSpikeLevel(replay: LevelReplayV1): SpikeReplayV1 {
  if (replay.levelId !== SPIKE_LEVEL.id) {
    throw new RangeError('Replay level is not supported by the spike wrapper.');
  }
  // Level 1's catalog definition allows only pinch stitches, and the generic
  // parser has already enforced that catalog constraint.
  return replay as SpikeReplayV1;
}

function translateLegacySpikeLevelId(value: unknown): unknown {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    !('levelId' in value) ||
    value.levelId !== LEGACY_SPIKE_LEVEL_ID
  ) {
    return value;
  }

  return { ...value, levelId: SPIKE_LEVEL.id };
}

/** Backward-compatible Level 1 parser. */
export function parseSpikeReplay(value: unknown): SpikeReplayV1 {
  return assertSpikeLevel(
    parseLevelReplay(translateLegacySpikeLevelId(value)),
  );
}

/** Backward-compatible Level 1 replay factory. */
export function createSpikeReplay(stitches: readonly Stitch[]): SpikeReplayV1 {
  return assertSpikeLevel(createLevelReplay(SPIKE_LEVEL, stitches));
}

export function serializeSpikeReplay(replay: SpikeReplayV1): string {
  return serializeLevelReplay(parseSpikeReplay(replay));
}

export function deserializeSpikeReplay(serialized: string): SpikeReplayV1 {
  return parseSpikeReplay(JSON.parse(serialized) as unknown);
}

/** Backward-compatible Level 1 fixed-step playback. */
export function simulateSpikeReplay(
  replay: SpikeReplayV1,
  sampleEveryTicks = 8,
): SpikeReplayRun {
  return simulateLevelReplay(parseSpikeReplay(replay), sampleEveryTicks);
}
