import { worldStageForScore } from './progression';

/** Separate policy keeps version-three saved worlds on their original unlocks. */
export const INTERACTIVE_MECHANICS = ['hoop', 'tear', 'switch', 'shutter'] as const;
export type InteractiveIntroduction = typeof INTERACTIVE_MECHANICS[number];
export type InteractiveMechanic = InteractiveIntroduction | 'gate' | 'fray';
export type InteractiveIntroductions = [number, number, number, number];

export function obstacleBudget(score: number): readonly [number, number] {
  if (score <= 5) return [0, 0];
  const minimum = Math.min(5, worldStageForScore(score) + 1);
  return [minimum, minimum + 1];
}
