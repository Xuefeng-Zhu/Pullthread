export const GAMEPLAY_PLAYBACK_RATE = 2;

export function scaleGameplayElapsed(realElapsedSeconds: number): number {
  return realElapsedSeconds * GAMEPLAY_PLAYBACK_RATE;
}
