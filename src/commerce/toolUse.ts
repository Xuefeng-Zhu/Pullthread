import { isToolKind } from './contracts';

export interface ToolPosition { readonly x: number; readonly y: number }
export type ToolUse =
  | { readonly tool: 'preview' | 'revive' | 'sail' | 'needle' }
  | { readonly tool: 'teleport'; readonly pocketId: string }
  | { readonly tool: 'bounce'; readonly position: ToolPosition; readonly angle: number }
  | { readonly tool: 'pin' | 'velcro'; readonly targetId: string }
  | { readonly tool: 'stitch'; readonly position: ToolPosition };

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).length === allowed.length && Object.keys(value).every(key => allowed.includes(key));
}
function position(value: unknown): value is ToolPosition {
  return record(value) && keys(value, ['x', 'y']) && Number.isSafeInteger(value.x) && Number.isSafeInteger(value.y);
}
function target(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 160;
}

/** Parse the exact gameplay payload. World-dependent legality is checked by the engine. */
export function parseToolUse(value: unknown): ToolUse | null {
  if (!record(value) || !isToolKind(value.tool)) return null;
  switch (value.tool) {
    case 'preview': case 'revive': case 'sail': case 'needle':
      return keys(value, ['tool']) ? { tool: value.tool } : null;
    case 'teleport':
      return keys(value, ['tool', 'pocketId']) && target(value.pocketId)
        ? { tool: value.tool, pocketId: value.pocketId } : null;
    case 'pin': case 'velcro':
      return keys(value, ['tool', 'targetId']) && target(value.targetId)
        ? { tool: value.tool, targetId: value.targetId } : null;
    case 'bounce':
      return keys(value, ['tool', 'position', 'angle']) && position(value.position)
        && Number.isInteger(value.angle) && (value.angle as number) >= 0 && (value.angle as number) < 180
        ? { tool: value.tool, position: { x: value.position.x, y: value.position.y }, angle: value.angle as number } : null;
    case 'stitch':
      return keys(value, ['tool', 'position']) && position(value.position)
        ? { tool: value.tool, position: { x: value.position.x, y: value.position.y } } : null;
  }
}

/** Fixed field order binds receipt authorization to the exact selected effect. */
export function canonicalToolUse(use: ToolUse): string {
  const parsed = parseToolUse(use);
  if (!parsed) throw new Error('Invalid tool use.');
  return JSON.stringify(parsed);
}
