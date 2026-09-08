import { test, expect } from '@jest/globals';
import { createRankedSimulation, replayBatch } from '../replay';
import { launchEndless, stepEndless } from '../../game/launch/endless';
import { serializeEndlessRun } from '../../game/launch/snapshots';
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
