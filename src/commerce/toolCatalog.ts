import type { ToolKind } from './contracts';

export const TOOL_LABELS: Readonly<Record<ToolKind, string>> = {
  preview: 'Preview', teleport: 'Land', revive: 'Revive',
  bounce: 'Bounce Patch', pin: 'Safety Pin', velcro: 'Velcro Patch',
  sail: 'Silk Sail', needle: 'Needle Tip', stitch: 'Pocket Stitch',
};

export const TOOL_DESCRIPTIONS: Readonly<Record<ToolKind, string>> = {
  preview: 'See your full next flight, including bounces. Pull to try different shots.',
  teleport: 'Choose a visible pocket and land there instantly.',
  revive: 'Return to your last pocket. Available once per run.',
  bounce: 'Place and angle a cushion for one bounce on your next flight.',
  pin: 'Hold a moving target at its current position for your next flight.',
  velcro: 'Catch one chosen pocket from any direction on your next flight.',
  sail: 'Open a silk sail at your next flight’s peak to slow your fall.',
  needle: 'Pass through one thorn obstacle during your next flight.',
  stitch: 'Place a temporary pocket for one catch and launch.',
};

/** Shared 24-unit artwork for the tool buttons and their collectible patches. */
export const TOOL_ICON_SIZE = 24;
export const TOOL_ICON_STROKE_WIDTH = 1.7;
export const TOOL_ICON_PATHS: Readonly<Record<ToolKind, string>> = {
  preview: 'M 5 18 Q 5 3 16 6 M 12 2 L 17 6 L 12 10 M 5 18 L 18 18',
  teleport: 'M 4 9 L 4 18 Q 12 24 20 18 L 20 9 M 12 3 L 12 15 M 8 11 L 12 15 L 16 11',
  revive: 'M 12 20 C -6 9 7 -2 12 7 C 17 -2 30 9 12 20 Z',
  bounce: 'M 3 15 L 18 7 L 21 12 L 6 20 Z M 5 8 L 9 11 L 11 5',
  pin: 'M 7 5 L 18 16 Q 22 21 17 21 Q 14 21 12 18 L 3 9 Q 0 4 5 3 L 8 6 M 8 6 L 18 16',
  velcro: 'M 4 8 L 4 17 Q 12 23 20 17 L 20 8 M 7 7 L 7 12 M 12 5 L 12 11 M 17 7 L 17 12',
  sail: 'M 3 11 Q 12 -2 21 11 Q 17 7 12 11 Q 7 7 3 11 Z M 3 11 L 12 21 L 21 11 M 12 11 L 12 21',
  needle: 'M 4 21 L 13 4 Q 16 -1 19 3 Q 21 6 17 9 L 4 21 Z M 15 5 L 17 4',
  stitch: 'M 4 5 L 4 17 Q 12 23 20 17 L 20 5 M 7 5 L 9 8 M 11 5 L 13 8 M 15 5 L 17 8 M 8 13 L 16 13',
};
