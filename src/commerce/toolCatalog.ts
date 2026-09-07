import type { ToolKind } from './contracts';

export const TOOL_LABELS: Readonly<Record<ToolKind, string>> = {
  preview: 'Preview', teleport: 'Land', revive: 'Revive',
};

export const TOOL_DESCRIPTIONS: Readonly<Record<ToolKind, string>> = {
  preview: 'See your full next flight, including bounces. Pull to try different shots.',
  teleport: 'Choose a visible pocket and land there instantly.',
  revive: 'Return to your last pocket. Available once per run.',
};

export const TOOL_ICONS = {
  preview: 'git-branch-outline', teleport: 'locate-outline', revive: 'heart-outline',
} as const;
