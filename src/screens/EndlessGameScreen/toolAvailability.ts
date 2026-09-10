import type { ToolKind } from '../../commerce/contracts';

export interface ToolAvailability {
  phase: string;
  previewActive: boolean;
  reviveUsed: boolean;
  preparedTools?: readonly ToolKind[];
  creativeEnabled?: boolean;
}

export function isToolUnavailable(kind: ToolKind, state: ToolAvailability): boolean {
  if (kind === 'preview') return state.phase !== 'held' || state.previewActive;
  if (kind === 'teleport') return state.phase === 'failed';
  if (kind === 'revive') return state.phase !== 'failed' || state.reviveUsed;
  return state.phase !== 'held' || state.creativeEnabled === false || !!state.preparedTools?.includes(kind);
}
