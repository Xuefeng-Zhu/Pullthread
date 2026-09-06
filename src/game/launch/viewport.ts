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

/**
 * Fill portrait width while keeping a usable world height on short screens.
 * The physical floor remains above the screen's bottom inset. Rendering and
 * gesture inversion must share this projection; physics stays in world units.
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
    usableHeight / MIN_VISIBLE_WORLD_HEIGHT,
  );
  return {
    scale,
    offsetX: (viewportWidth - bounds.width * scale) / 2,
    offsetY: usableHeight - bounds.height * scale,
  };
}
