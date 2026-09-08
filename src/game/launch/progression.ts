export const WORLD_STAGES = [
  { name: 'Sewing Table', base: '#EDDFC4', ink: '#8C7154', cue: 'Pull back. Let go. Keep climbing.' },
  { name: 'Felt Garden', base: '#DFE9CC', ink: '#61794F', cue: 'Swaying pockets settle when you land.' },
  { name: 'Patchwork Sky', base: '#DDECF2', ink: '#5A7D99', cue: 'Wind ribbons bend your flight.' },
  { name: 'Bobbin Workshop', base: '#F0DDCB', ink: '#A27754', cue: 'Spring spools give you a stronger bounce.' },
  { name: 'Moonlit Quilt', base: '#E5DFF1', ink: '#807097', cue: 'Watch the scissors sweep before you leap.' },
] as const;

export type IntroducedMechanic = 'sway' | 'wind' | 'spring' | 'scissors';
export type WorldMechanic = IntroducedMechanic | 'gate' | 'fray';
export type IntroductionProgress = [number, number, number, number];
export const INTRODUCED_MECHANICS: readonly IntroducedMechanic[] = ['sway', 'wind', 'spring', 'scissors'];
export const WORLD_POCKET_INTERVAL = 20;
export const WORLD_TRANSITION_TICKS = 96;
export const WORLD_ANNOUNCEMENT_TICKS = 360;

/** Scored arrivals, not altitude or skipped ranks, own the world's progression. */
export function worldStageForScore(pocketsCaught: number): number {
  return Math.floor(Math.max(0, pocketsCaught) / WORLD_POCKET_INTERVAL);
}

export function worldForStage(stage: number) {
  return WORLD_STAGES[Math.max(0, stage) % WORLD_STAGES.length];
}
