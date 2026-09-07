import type { ToolKind } from './contracts';

export const TOOL_LABELS: Readonly<Record<ToolKind, string>> = {
  preview: 'Preview', teleport: 'Land', revive: 'Revive',
};

export const TOOL_DESCRIPTIONS: Readonly<Record<ToolKind, string>> = {
  preview: 'See your full next flight, including bounces. Pull to try different shots.',
  teleport: 'Choose a visible pocket and land there instantly.',
  revive: 'Return to your last pocket. Available once per run.',
};

/** Shared 24-unit artwork for the tool buttons and their collectible patches. */
export const TOOL_ICON_SIZE = 24;
export const TOOL_ICON_STROKE_WIDTH = 1.7;
export const TOOL_ICON_PATHS: Readonly<Record<ToolKind, string>> = {
  preview: 'M 5 18 Q 5 3 16 6 M 12 2 L 17 6 L 12 10 M 5 18 L 18 18',
  teleport: 'M 4 9 L 4 18 Q 12 24 20 18 L 20 9 M 12 3 L 12 15 M 8 11 L 12 15 L 16 11',
  revive: 'M 12 20 C -6 9 7 -2 12 7 C 17 -2 30 9 12 20 Z',
};
