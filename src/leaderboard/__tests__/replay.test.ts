import { test, expect } from '@jest/globals';
import { createRankedSimulation, replayBatch, toolContext, validateBatch } from '../replay';
import { launchEndless, stepEndless } from '../../game/launch/endless';
import { cloneEndlessRun, serializeEndlessRun } from '../../game/launch/snapshots';
import { CREATIVE_TOOLS, type CreativeToolKind } from '../../commerce/contracts';
import type { ToolUse } from '../../commerce/toolUse';
import { applyEndlessTool, eligibleVelcroTargets, getToolPlacement } from '../../game/launch/tools';
import { grantFreeTool } from '../../game/launch/toolInventory';
import type { ReplayBatch } from '../contracts';
test('ordered chunks reproduce live flight and camera freezing exactly', async () => {
  const live = createRankedSimulation(123), server = createRankedSimulation(123);
  for (let tick = 0; tick < 90; tick++) stepEndless(live, true);
  expect(launchEndless(live, { x: 0, y: 90 })).toBe(true);
  for (let tick = 90; tick < 240; tick++) stepEndless(live);
  const cursor = { elapsed: 0, aiming: false };
  await replayBatch(server, cursor, { sequence: 0, from: 0, to: 240, commands: [
    { at: 0, type: 'aim' }, { at: 90, type: 'launch', x: 0, y: 90 },
  ] });
  expect(serializeEndlessRun(server)).toBe(serializeEndlessRun(live));
  expect(cursor.elapsed).toBe(240);
});
test.each([
  { sequence: 0, from: 0, to: 241, commands: [] },
  { sequence: 0, from: 0, to: 0, commands: [] },
  { sequence: 0, from: 0, to: 1, commands: [{ at: 0, type: 'launch', x: 0, y: 90 }] },
  { sequence: 0, from: 0, to: 1, commands: [{ at: 0, type: 'aim' }, { at: 0, type: 'launch', x: 0, y: 10000 }] },
  { sequence: 0, from: 0, to: 1, commands: [{ at: 0, type: 'tool', tool: 'teleport', pocketId: 'missing', operationId: 'forged' }] },
])('rejects invalid replay %#', async batch => {
  await expect(replayBatch(createRankedSimulation(1), { elapsed: 0, aiming: false }, batch as ReplayBatch)).rejects.toThrow();
});

function creativeFixture(tool: CreativeToolKind) {
  const run = createRankedSimulation(123);
  grantFreeTool(run, tool);
  let use: ToolUse;
  if (tool === 'pin') {
    run.room = { ...run.room, hazards: [...run.room.hazards, { id: 'moving-fixture', center: { x: 50, y: 150 }, radius: 8,
      motion: { amplitude: 15, periodTicks: 120, phaseTicks: 0 } }] };
    use = { tool, targetId: 'moving-fixture' };
  } else if (tool === 'velcro') use = { tool, targetId: eligibleVelcroTargets(run)[0].id };
  else if (tool === 'bounce' || tool === 'stitch') {
    let placement: ToolUse | null = null;
    for (let y = 60; y <= 420 && !placement; y += 30) {
      for (let x = 60; x <= 300 && !placement; x += 30) placement = getToolPlacement(run, tool, { x, y }, 45);
    }
    if (!placement) throw new Error(`No valid ${tool} fixture placement.`);
    use = placement;
  } else use = { tool };
  return { run, use };
}

test.each(CREATIVE_TOOLS)('%s free use and flight replay match live inventory, effects and physics', async tool => {
  const { run: live, use } = creativeFixture(tool);
  const server = cloneEndlessRun(live);
  expect(applyEndlessTool(live, use)).toBe(true);
  expect(launchEndless(live, { x: 0, y: 90 })).toBe(true);
  for (let tick = 0; tick < 120; tick++) stepEndless(live);
  await replayBatch(server, { elapsed: 0, aiming: false }, { sequence: 0, from: 0, to: 120, commands: [
    { type: 'tool', ...use, at: 0 }, { type: 'aim', at: 0 }, { type: 'launch', x: 0, y: 90, at: 0 },
  ] });
  expect(serializeEndlessRun(server)).toBe(serializeEndlessRun(live));
  expect(server.inventory[tool]).toBe(0);
});

test('paid placement context binds target geometry and preserves the legacy receipt format', async () => {
  const { run, use } = creativeFixture('bounce');
  if (use.tool !== 'bounce') throw new Error('Expected bounce fixture.');
  const command = { type: 'tool' as const, ...use, at: 0, operationId: 'placement-receipt' };
  const authorized = toolContext(run, command);
  expect(toolContext(run, { ...command, angle: (use.angle + 1) % 180 })).not.toBe(authorized);
  expect(toolContext(run, { ...command, position: { ...use.position, x: use.position.x + 1 } })).not.toBe(authorized);
  expect(toolContext(run, { type: 'tool', tool: 'preview', at: 0 })).toBe('0:endless-0:preview:');
  await expect(replayBatch(run, { elapsed: 0, aiming: false }, { sequence: 0, from: 0, to: 0,
    commands: [{ ...command, angle: (use.angle + 1) % 180 }] }, async (_command, context) => {
    if (context !== authorized) throw new Error('Mismatched receipt.');
  })).rejects.toThrow('Mismatched receipt');
  expect(run.inventory.bounce).toBe(1);
  expect(run.state.toolEffects?.bounce).toBeUndefined();
});

test.each([
  { tool: 'sail', targetId: 'extra' }, { tool: 'velcro' },
  { tool: 'bounce', position: { x: 100, y: 200 }, angle: 180 },
  { tool: 'stitch', position: { x: 100.5, y: 200 } },
  { tool: 'needle', operationId: '' },
])('rejects malformed creative replay payload %#', payload => {
  expect(() => validateBatch({ sequence: 0, from: 0, to: 0,
    commands: [{ type: 'tool', at: 0, ...payload }] } as ReplayBatch, 0)).toThrow('Invalid tool');
});
