import type { ToolKind } from '../../commerce/contracts';
import type { ChallengePattern } from './challengeTypes';

export function scheduledPickupKind(index: number): ToolKind | undefined {
  if (index === 2 || index === 10) return 'preview';
  if (index === 4) return 'revive';
  if (index === 6 || index === 14) return 'teleport';
  if (index >= 19 && (index - 19) % 5 === 0) {
    return (['revive', 'preview', 'teleport'] as const)[((index - 19) / 5) % 3];
  }
  return undefined;
}

/**
 * A short outward side hop collects the charge and returns to the same pocket.
 * Main routes can bypass it. Banks offer the detour at their entry, where their
 * required bounce trajectory is still unchanged; roomy flights offer it at exit.
 */
export function pickupPlacement(pattern: ChallengePattern) {
  if (pattern.family === 'opening') {
    return { center: { x: pattern.entryX.min + (pattern.entryX.min > 180 ? 10 : -10), y: -50 }, radius: 14 };
  }
  const anchor = pattern.family === 'bank'
    ? { x: pattern.entryX.min, y: 0 } : pattern.receiver.center;
  return {
    center: { x: anchor.x + (anchor.x < 180 ? -40 : 40), y: anchor.y - 15 },
    radius: 14,
  };
}
