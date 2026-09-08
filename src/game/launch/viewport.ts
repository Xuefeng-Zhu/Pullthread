export interface LaunchViewportSize {
  readonly width: number;
  readonly height: number;
}

export interface LaunchViewport {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

// High bank receivers must be visible before release even in a short browser.
const MIN_VISIBLE_WORLD_HEIGHT = 520;
// The pocket stretches 35 units below the button. Leave a finger-sized margin
// beneath that fabric at full pull, including touches that begin below the lip.
const PULL_GUTTER = 80;

/**
 * Fill portrait width while keeping a usable world height on short screens.
 * Reserve extra fabric below the world for the downward pull, above the safe
 * inset. Rendering and gesture inversion share this projection; physics and
 * saved camera positions stay in world units.
 */
export function getLaunchViewport(
  size: LaunchViewportSize,
  bounds: LaunchViewportSize,
  bottomInset = 0,
): LaunchViewport {
  // Native safe-area insets can arrive before the first nonzero layout.
  // Keep the provisional projection invertible until that measurement arrives.
  const viewportWidth = Math.max(1, size.width);
  const usableHeight = Math.max(1, size.height - bottomInset);
  const scale = Math.min(
    viewportWidth / bounds.width,
    usableHeight / (MIN_VISIBLE_WORLD_HEIGHT + PULL_GUTTER),
  );
  return {
    scale,
    offsetX: (viewportWidth - bounds.width * scale) / 2,
    offsetY: usableHeight - (bounds.height + PULL_GUTTER) * scale,
  };
}
