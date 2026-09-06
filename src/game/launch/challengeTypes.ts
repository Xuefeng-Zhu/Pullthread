import type { LaunchBumper, LaunchHazard, LaunchPocket } from './types';

export type ChallengeFamily = 'opening' | 'recovery' | 'arc' | 'bank' | 'reverse' | 'timing';
export type ChallengeBand = 'intro' | 'mixed' | 'expert';
export interface AnchorRange { readonly min: number; readonly max: number }

/** Authored in the 360-wide world, with the entry pocket at y=0. */
export interface ChallengePattern {
  readonly id: string;
  readonly family: ChallengeFamily;
  readonly band: ChallengeBand;
  readonly entryX: AnchorRange;
  readonly exitX: AnchorRange;
  readonly receiver: Omit<LaunchPocket, 'id' | 'kind'>;
  readonly bumpers: readonly Omit<LaunchBumper, 'id'>[];
  readonly hazards: readonly Omit<LaunchHazard, 'id'>[];
  readonly cue?: string;
}

export interface ActiveChallenge {
  readonly pocketId: string;
  readonly patternId: string;
  readonly family: ChallengeFamily;
  readonly band: ChallengeBand;
  readonly cue?: string;
}
