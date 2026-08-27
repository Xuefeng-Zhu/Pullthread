import { CAMPAIGN_LEVELS } from './campaignLevels';
import type { LevelDefinition } from './schema';

export const FREE_CAMPAIGN_LEVEL_COUNT = 6;

export type CampaignLevelAccessState =
  | 'completed'
  | 'current'
  | 'sequence-locked'
  | 'premium-locked';

export interface CampaignLevelAccess {
  readonly state: CampaignLevelAccessState;
  readonly canPlay: boolean;
  readonly openPaywall: boolean;
  readonly requiresFullGame: boolean;
}

export interface CampaignLevelCompletion {
  readonly completed: true;
}

export type CampaignCompletionByLevel = Readonly<
  Partial<Record<string, CampaignLevelCompletion>>
>;

const LEVEL_INDEX_BY_ID = new Map(
  CAMPAIGN_LEVELS.map((level, index) => [level.id, index] as const),
);

/** Levels after the first six require the one-time Full Atelier entitlement. */
export function requiresFullGameEntitlement(
  level: Pick<LevelDefinition, 'order'>,
): boolean {
  return level.order > FREE_CAMPAIGN_LEVEL_COUNT;
}

function isCompleted(
  progressByLevel: CampaignCompletionByLevel,
  levelId: string,
): boolean {
  return progressByLevel[levelId]?.completed === true;
}

/**
 * Derives campaign access from durable completion and the effective
 * entitlement. No mutable unlock list is stored, so purchase state cannot
 * accidentally bypass campaign order.
 */
export function getCampaignLevelAccess(
  levelId: string,
  progressByLevel: CampaignCompletionByLevel,
  hasFullGame: boolean,
): CampaignLevelAccess {
  const index = LEVEL_INDEX_BY_ID.get(levelId);
  if (index === undefined) {
    throw new RangeError(`Unknown campaign level "${levelId}".`);
  }

  const level = CAMPAIGN_LEVELS[index];
  const requiresFullGame = requiresFullGameEntitlement(level);

  // Entitlement is required even for a previously completed premium level.
  // Keeping this state paywall-routable lets every premium node explain the
  // one-time unlock without making it playable out of sequence after purchase.
  if (requiresFullGame && !hasFullGame) {
    return Object.freeze({
      state: 'premium-locked',
      canPlay: false,
      openPaywall: true,
      requiresFullGame,
    });
  }

  if (isCompleted(progressByLevel, level.id)) {
    return Object.freeze({
      state: 'completed',
      canPlay: true,
      openPaywall: false,
      requiresFullGame,
    });
  }

  const previousLevel = index > 0 ? CAMPAIGN_LEVELS[index - 1] : null;
  if (!previousLevel || isCompleted(progressByLevel, previousLevel.id)) {
    return Object.freeze({
      state: 'current',
      canPlay: true,
      openPaywall: false,
      requiresFullGame,
    });
  }

  return Object.freeze({
    state: 'sequence-locked',
    canPlay: false,
    openPaywall: false,
    requiresFullGame,
  });
}
