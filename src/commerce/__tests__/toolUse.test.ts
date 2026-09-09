import { describe, expect, test } from '@jest/globals';
import { canonicalToolUse, parseToolUse, type ToolUse } from '../toolUse';

describe('exact tool payloads', () => {
  test.each<ToolUse>([
    { tool: 'preview' }, { tool: 'revive' }, { tool: 'sail' }, { tool: 'needle' },
    { tool: 'teleport', pocketId: 'endless-1' },
    { tool: 'pin', targetId: 'moving-gate' }, { tool: 'velcro', targetId: 'pocket-1' },
    { tool: 'bounce', position: { x: 180, y: -500 }, angle: 179 },
    { tool: 'stitch', position: { x: 80, y: 250 } },
  ])('round-trips $tool', use => {
    expect(parseToolUse(JSON.parse(canonicalToolUse(use)))).toEqual(use);
  });

  test.each([
    null, {}, { tool: 'unknown' }, { tool: 'sail', targetId: 'unrelated' },
    { tool: 'teleport' }, { tool: 'velcro', targetId: '' }, { tool: 'pin', targetId: 'a'.repeat(161) },
    { tool: 'bounce', position: { x: 1.5, y: 2 }, angle: 0 },
    { tool: 'bounce', position: { x: 1, y: 2 }, angle: 180 },
    { tool: 'bounce', position: { x: 1, y: 2 }, angle: -1 },
    { tool: 'bounce', position: { x: 1, y: 2 }, angle: 3.5 },
    { tool: 'stitch', position: { x: 1, y: Infinity } },
    { tool: 'stitch', position: { x: 1, y: 2, z: 0 } },
  ])('rejects malformed payload %#', value => { expect(parseToolUse(value)).toBeNull(); });

  test('canonical encoding has fixed field order and binds position, angle and target', () => {
    const first = parseToolUse({ angle: 45, position: { y: 100, x: 80 }, tool: 'bounce' })!;
    const same: ToolUse = { tool: 'bounce', position: { x: 80, y: 100 }, angle: 45 };
    expect(canonicalToolUse(first)).toBe(canonicalToolUse(same));
    expect(canonicalToolUse({ ...same, angle: 46 })).not.toBe(canonicalToolUse(same));
    expect(canonicalToolUse({ ...same, position: { x: 81, y: 100 } })).not.toBe(canonicalToolUse(same));
    expect(canonicalToolUse({ tool: 'pin', targetId: 'a' })).not.toBe(canonicalToolUse({ tool: 'pin', targetId: 'b' }));
  });
});
