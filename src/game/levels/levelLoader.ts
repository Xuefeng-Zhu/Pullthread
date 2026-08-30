import {
  createHeightField,
  DEFAULT_PINCH_PARAMETERS,
  DEFAULT_POCKET_PARAMETERS,
  rebuildHeightField,
} from '../core/heightField';
import type { PhysicsConfig, PhysicsWorld } from '../core/physics';
import { createSimulation, type SimulationState } from '../core/simulation';
import type { Stitch } from '../core/types';
import {
  CAMPAIGN_LEVELS,
  CAMPAIGN_QUILTS,
  LEGACY_DAILY_LEVELS_V1,
} from './campaignLevels';
import type { LevelDefinition, QuiltDefinition } from './schema';

const levelsById = new Map(
  CAMPAIGN_LEVELS.map((level) => [level.id, level] as const),
);
const quiltsById = new Map(
  CAMPAIGN_QUILTS.map((quilt) => [quilt.id, quilt] as const),
);
const levelsByVersion = new Map<string, LevelDefinition>();
for (const level of [...CAMPAIGN_LEVELS, ...LEGACY_DAILY_LEVELS_V1]) {
  const key = `${level.id}@${level.version}`;
  if (levelsByVersion.has(key)) {
    throw new Error(`Duplicate level version "${key}".`);
  }
  levelsByVersion.set(key, level);
}

export function getCampaignLevel(levelId: string): LevelDefinition {
  const level = levelsById.get(levelId);
  if (!level) throw new Error(`Unknown campaign level "${levelId}".`);
  return level;
}

/** Resolves current campaign content or an immutable historical Daily version. */
export function getLevelVersion(
  levelId: string,
  version: number,
): LevelDefinition {
  const level = levelsByVersion.get(`${levelId}@${version}`);
  if (!level) {
    throw new Error(`Unknown level version "${levelId}@${version}".`);
  }
  return level;
}

export function getCampaignQuilt(quiltId: string): QuiltDefinition {
  const quilt = quiltsById.get(quiltId);
  if (!quilt) throw new Error(`Unknown campaign quilt "${quiltId}".`);
  return quilt;
}

export function getCampaignLevelsForQuilt(
  quiltId: string,
): readonly LevelDefinition[] {
  getCampaignQuilt(quiltId);
  return CAMPAIGN_LEVELS.filter((level) => level.quiltId === quiltId);
}

export function getNextCampaignLevel(
  levelId: string,
): LevelDefinition | null {
  const level = getCampaignLevel(levelId);
  return CAMPAIGN_LEVELS.find((candidate) => candidate.order === level.order + 1) ?? null;
}

export function createLevelPhysicsConfig(
  level: LevelDefinition,
): PhysicsConfig {
  return level.physicsConfig;
}

export function createLevelWorld(
  level: LevelDefinition,
  stitches: readonly Stitch[] = [],
  preview?: Stitch,
): PhysicsWorld {
  const { fabricBounds, baseSlope } = level;
  const surface = createHeightField(
    level.gridColumns,
    level.gridRows,
    fabricBounds,
    (x, y) =>
      baseSlope.originHeight +
      baseSlope.x * (x - fabricBounds.x) +
      baseSlope.y * (y - fabricBounds.y),
  );
  rebuildHeightField(
    surface,
    stitches,
    DEFAULT_PINCH_PARAMETERS,
    preview,
    DEFAULT_POCKET_PARAMETERS,
  );

  return {
    surface,
    bounds: fabricBounds,
    goal: level.goal,
    hazards: level.hazards,
    fabricRegions: level.fabricRegions,
    bumpers: level.bumpers,
    collectible: level.collectible,
  };
}

export function createLevelSimulation(
  level: LevelDefinition,
): SimulationState {
  return createSimulation(level.traveler);
}
