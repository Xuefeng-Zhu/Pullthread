/** @jest-environment node */
import { describe, expect, jest, test } from '@jest/globals';

import { PaidToolJournal, type JournalStorage } from '../../../commerce/paidToolJournal';
import { TOOL_COSTS, type RedeemToolRequest } from '../../../commerce/contracts';
import { createMockCommerceService } from '../../../services/commerce/mockService';
import { createEndlessRun, createSectionEndlessRun, nextEndlessTargets, teleportEndless } from '../endless';
import { cloneEndlessRun, deserializeEndlessRun, serializeEndlessRun } from '../snapshots';

async function setup() {
  const disk = new Map<string, string>();
  const storage: JournalStorage = {
    getItem: async (key) => disk.get(key) ?? null,
    setItem: async (key, value) => { disk.set(key, value); },
    removeItem: async (key) => { disk.delete(key); },
  };
  const service = createMockCommerceService();
  await service.purchasePoints('pullthread_points_100');
  const journal = () => new PaidToolJournal(storage, service, (snapshot) => deserializeEndlessRun(snapshot) !== null);
  return { service, journal };
}

describe('version-two paid tool recovery', () => {
  test('an interrupted paid branch teleport recovers the exact generated world and scores only once', async () => {
    const { service, journal } = await setup();
    const before = createSectionEndlessRun(0);
    expect(teleportEndless(before, 'endless-2', true)).toBe(true);
    const target = nextEndlessTargets(before).find((id) => before.room.pockets.find((pocket) => pocket.id === id)?.route === 'reward')!;
    const after = cloneEndlessRun(before);
    expect(teleportEndless(after, target, true)).toBe(true);
    const request: RedeemToolRequest = {
      operationId: 'v2-branch-teleport', runId: 'v2-branch-run', tool: 'teleport',
      expectedCost: TOOL_COSTS.teleport, contextKey: `${before.state.tick}:${target}`,
    };
    const redeem = jest.spyOn(service, 'redeemTool');
    jest.spyOn(service, 'resolveTool').mockRejectedValueOnce(new Error('acknowledgement lost'));
    await expect(journal().redeem(request, serializeEndlessRun(before), serializeEndlessRun(after)))
      .rejects.toThrow('acknowledgement lost');
    const recovered = await journal().recover();
    const run = deserializeEndlessRun(recovered.snapshot!);
    expect(run).toEqual(after);
    expect(run!.generationVersion).toBe(2);
    expect(run!.pocketsCaught).toBe(before.pocketsCaught + 1);
    expect(run!.inventory).toEqual(before.inventory);
    expect(recovered.result?.receipt.status).toBe('applied');
    expect((await service.getWallet()).points).toBe(75);
    expect(redeem).toHaveBeenCalledTimes(1);
    const reopened = await journal().recover();
    expect(deserializeEndlessRun(reopened.snapshot!)).toEqual(after);
    expect((await service.getWallet()).points).toBe(75);
    expect(redeem).toHaveBeenCalledTimes(1);
  });

  test.each([1, 2, 3, 4] as const)('pending generation-version-%i snapshots retain their generator through recovery', async (version) => {
    const { service, journal } = await setup();
    const before = createEndlessRun(77, version);
    const after = cloneEndlessRun(before);
    expect(teleportEndless(after, 'endless-1', true)).toBe(true);
    const request: RedeemToolRequest = {
      operationId: `pending-v${version}`, runId: `saved-v${version}`, tool: 'teleport',
      expectedCost: TOOL_COSTS.teleport, contextKey: '0:endless-1',
    };
    jest.spyOn(service, 'resolveTool').mockRejectedValueOnce(new Error('interrupted'));
    await expect(journal().redeem(request, serializeEndlessRun(before), serializeEndlessRun(after))).rejects.toThrow('interrupted');
    const recovered = deserializeEndlessRun((await journal().recover()).snapshot!);
    expect(recovered).toEqual(after);
    expect(recovered!.generationVersion).toBe(version);
    expect(recovered!.sectionProgress !== undefined).toBe(version >= 2);
    expect((await service.getWallet()).points).toBe(75);
  });
});
