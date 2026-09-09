/** @jest-environment node */
import { describe, expect, jest, test } from '@jest/globals';

import type { CommerceService, RedeemToolRequest, ToolReceipt } from '../contracts';
import { CREATIVE_TOOLS, TOOL_COSTS } from '../contracts';
import { PaidToolJournal, paidToolJournalKey, type JournalStorage } from '../paidToolJournal';
import { CommerceError } from '../../services/commerce/errors';

const request: RedeemToolRequest = { operationId: 'operation-123', runId: 'run-12345', tool: 'preview', expectedCost: 10, contextKey: '3:endless-0' };

function setup() {
  const disk = new Map<string, string>();
  const storage: JournalStorage = {
    getItem: jest.fn(async (key: string) => disk.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { disk.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { disk.delete(key); }),
  };
  const receipts = new Map<string, ToolReceipt>();
  let balance = 100;
  let revision = 0;
  const result = (receipt: ToolReceipt) => ({ wallet: { points: balance, revision, environment: 'sandbox' as const }, receipt });
  const service: CommerceService = {
    mode: 'native', environment: 'sandbox', getAccountId: jest.fn(async () => 'guest-123'),
    getOffers: jest.fn(async () => []), getWallet: jest.fn(async () => ({ points: balance, revision, environment: 'sandbox' as const })),
    purchasePoints: jest.fn(async () => { throw new Error('Not used'); }),
    redeemTool: jest.fn(async (input: RedeemToolRequest) => {
      if (!receipts.has(input.operationId)) { balance -= input.expectedCost; revision++; receipts.set(input.operationId, { ...input, status: 'ready' }); }
      return result(receipts.get(input.operationId)!);
    }),
    getRedemption: jest.fn(async (id: string) => receipts.has(id) ? result(receipts.get(id)!) : null),
    resolveTool: jest.fn(async (id: string, action: 'applied' | 'refund') => {
      const receipt = receipts.get(id)!;
      if (receipt.status === 'ready') {
        if (action === 'refund') { balance += receipt.expectedCost; revision++; }
        receipts.set(id, { ...receipt, status: action === 'refund' ? 'refunded' : 'applied' });
      }
      return result(receipts.get(id)!);
    }),
  };
  const valid = (value: string) => value.startsWith('run:');
  const journal = () => new PaidToolJournal(storage, service, valid);
  return { storage, service, receipts, disk, journal };
}

describe('paid tool interruption journal', () => {
  test.each(CREATIVE_TOOLS)('%s recovers its exact armed snapshot without a second debit', async tool => {
    const { service, journal } = setup();
    const creativeRequest = { ...request, tool, expectedCost: TOOL_COSTS[tool], contextKey: `0:endless-0:${tool}:exact-placement` };
    jest.mocked(service.resolveTool).mockRejectedValueOnce(new Error('connection lost'));
    await expect(journal().redeem(creativeRequest, 'run:before', `run:${tool}:armed:exact-placement`)).rejects.toThrow('connection lost');
    const restored = await journal().recover();
    expect(restored.snapshot).toBe(`run:${tool}:armed:exact-placement`);
    expect(restored.result?.receipt).toMatchObject({ ...creativeRequest, status: 'applied' });
    expect(service.redeemTool).toHaveBeenCalledTimes(1);
    expect((await service.getWallet()).points).toBe(100 - TOOL_COSTS[tool]);
  });
  test('background snapshots captured while a debit settles cannot replace its delivered effect', async () => {
    const { service, journal, storage } = setup();
    const persist = storage.setItem;
    let releaseWrite!: () => void;
    let enteredWrite!: () => void;
    const entered = new Promise<void>((resolve) => { enteredWrite = resolve; });
    jest.mocked(storage.setItem).mockImplementationOnce(async (key, value) => {
      await new Promise<void>((resolve) => { releaseWrite = resolve; enteredWrite(); });
      await jest.mocked(persist).getMockImplementation()!(key, value);
    });
    const live = journal();
    const debit = live.redeem(request, 'run:before', 'run:preview-armed');
    // This can fire even before the durable intent has reached storage.
    await live.saveRun('run:before');
    await entered;
    releaseWrite();
    await debit;
    const restored = await journal().recover();
    expect(restored.snapshot).toBe('run:preview-armed');
    expect((await service.getWallet()).points).toBe(90);
  });

  test('two same-frame tool presses cannot queue different paid operations', async () => {
    const { service, journal } = setup();
    const live = journal();
    const first = live.redeem(request, 'run:before', 'run:preview');
    await expect(live.redeem({ ...request, operationId: 'double-tap-operation' }, 'run:before', 'run:preview')).rejects.toThrow('already being checked');
    await first;
    expect(service.redeemTool).toHaveBeenCalledTimes(1);
    expect((await service.getWallet()).points).toBe(90);
  });

  test('background snapshots also cannot replace the effect during recovery', async () => {
    const { service, journal } = setup();
    jest.mocked(service.resolveTool).mockRejectedValueOnce(new Error('offline'));
    await expect(journal().redeem(request, 'run:before', 'run:preview')).rejects.toThrow('offline');
    const reopened = journal();
    const recovering = reopened.recover();
    await reopened.saveRun('run:unrelated-new-game');
    await recovering;
    expect((await journal().recover()).snapshot).toBe('run:preview');
  });

  test('an authoritative refusal during recovery preserves the old run and never retries that intent', async () => {
    const { service, journal } = setup();
    const live = journal();
    await live.redeem(request, 'run:before', 'run:previous-paid-preview');
    const next = { ...request, operationId: 'next-tool-operation' };
    jest.mocked(service.redeemTool).mockRejectedValueOnce(new Error('offline'));
    await expect(live.redeem(next, 'run:previous-paid-preview', 'run:next-paid-effect')).rejects.toThrow('offline');
    jest.mocked(service.redeemTool).mockRejectedValueOnce(new CommerceError('Not enough points.', 'insufficient_points', next.operationId));
    const reopened = journal();
    expect(await reopened.recover()).toMatchObject({ cancelled: true, snapshot: 'run:previous-paid-preview', result: null });
    await reopened.saveRun('run:continued-after-refusal');
    expect(await journal().recover()).toMatchObject({ snapshot: 'run:continued-after-refusal', cancelled: true });
    expect(service.redeemTool).toHaveBeenCalledTimes(3);
  });

  test('a direct authoritative refusal restores the previous paid run and allows another action', async () => {
    const { service, journal } = setup();
    const live = journal();
    await live.redeem(request, 'run:before', 'run:paid-preview');
    const next = { ...request, operationId: 'next-tool-operation' };
    jest.mocked(service.redeemTool).mockRejectedValueOnce(new CommerceError('Not enough points.', 'insufficient_points', next.operationId));
    await expect(live.redeem(next, 'run:progressed', 'run:second-effect')).rejects.toThrow('Not enough');
    expect((await journal().recover()).snapshot).toBe('run:progressed');
    await live.redeem({ ...next, operationId: 'third-tool-operation' }, 'run:progressed', 'run:third-effect');
    expect((await service.getWallet()).points).toBe(80);
  });

  test('generic quota and mismatched insufficient responses never discard a prepared intent', async () => {
    for (const failure of [new Error('quota exceeded'), new CommerceError('Not enough points.', 'insufficient_points', 'another-operation')]) {
      const { service, journal, disk } = setup();
      jest.mocked(service.redeemTool).mockRejectedValueOnce(failure);
      await expect(journal().redeem(request, 'run:before', 'run:preview')).rejects.toThrow();
      expect(JSON.parse(disk.get(paidToolJournalKey(service))!).phase).toBe('prepared');
    }
  });

  test('a failed durable intent never sends a debit', async () => {
    const { storage, service, journal } = setup();
    jest.mocked(storage.setItem).mockRejectedValueOnce(new Error('disk full'));
    await expect(journal().redeem(request, 'run:before', 'run:preview-armed')).rejects.toThrow('disk full');
    expect(service.redeemTool).not.toHaveBeenCalled();
  });

  test('a lost debit response recovers the receipt and saved effect without a second charge', async () => {
    const { service, journal } = setup();
    const original = service.redeemTool;
    jest.mocked(service.redeemTool).mockImplementationOnce(async (input) => {
      // Backend committed, then the process/connection disappeared.
      const stored = jest.mocked(original).getMockImplementation()!;
      await stored(input);
      throw new Error('connection lost');
    });
    await expect(journal().redeem(request, 'run:before', 'run:preview-armed')).rejects.toThrow('connection lost');
    const recovered = await journal().recover();
    expect(recovered.snapshot).toBe('run:preview-armed');
    expect(recovered.result?.wallet.points).toBe(90);
    expect(recovered.result?.receipt.status).toBe('applied');
    expect(service.redeemTool).toHaveBeenCalledTimes(1);
  });

  test('a crash before the request retries the same operation, not a new spend', async () => {
    const { service, journal } = setup();
    jest.mocked(service.redeemTool).mockRejectedValueOnce(new Error('offline'));
    await expect(journal().redeem(request, 'run:before', 'run:preview')).rejects.toThrow('offline');
    const recovered = await journal().recover();
    expect(recovered.result?.wallet.points).toBe(90);
    expect(jest.mocked(service.redeemTool).mock.calls.map(([input]) => input.operationId)).toEqual([request.operationId, request.operationId]);
  });

  test('a lost acknowledgement recovers the saved effect, and later progress replaces it', async () => {
    const { service, journal } = setup();
    jest.mocked(service.resolveTool).mockRejectedValueOnce(new Error('offline'));
    const first = journal();
    await expect(first.redeem(request, 'run:before', 'run:landed')).rejects.toThrow('offline');
    const reopened = journal();
    expect((await reopened.recover()).snapshot).toBe('run:landed');
    await reopened.saveRun('run:later-catch');
    const restored = await journal().recover();
    expect(restored.snapshot).toBe('run:later-catch');
    expect(service.redeemTool).toHaveBeenCalledTimes(1);
  });

  test('an unrecoverable unapplied effect refunds exactly once', async () => {
    const { service, journal, disk } = setup();
    jest.mocked(service.resolveTool).mockRejectedValueOnce(new Error('offline'));
    await expect(journal().redeem(request, 'run:before', 'run:preview')).rejects.toThrow('offline');
    const key = paidToolJournalKey(service);
    const entry = JSON.parse(disk.get(key)!); entry.after = 'unsupported-version'; disk.set(key, JSON.stringify(entry));
    const recovered = await journal().recover();
    expect(recovered.refunded).toBe(true);
    expect(recovered.result?.wallet.points).toBe(100);
    expect((await journal().recover()).snapshot).toBeNull();
    expect(jest.mocked(service.resolveTool).mock.calls.filter(([, action]) => action === 'refund')).toHaveLength(1);
  });

  test('account changes cannot replay a debit against the new wallet', async () => {
    const { service, journal } = setup();
    jest.mocked(service.redeemTool).mockRejectedValueOnce(new Error('offline'));
    await expect(journal().redeem(request, 'run:before', 'run:preview')).rejects.toThrow('offline');
    jest.mocked(service.getAccountId).mockResolvedValue('different-guest');
    await expect(journal().recover()).rejects.toThrow('different points account');
    expect(service.redeemTool).toHaveBeenCalledTimes(1);
  });

  test('save and explicit restart are ordered; a stale write cannot restore the old run', async () => {
    const { journal } = setup();
    const live = journal();
    await live.redeem(request, 'run:before', 'run:preview');
    await Promise.all([live.saveRun('run:later'), live.abandonRun(), live.saveRun('run:stale')]);
    expect((await journal().recover()).snapshot).toBeNull();
  });

  test('a second request cannot overwrite an uncertain redemption', async () => {
    const { service, journal } = setup();
    jest.mocked(service.redeemTool).mockRejectedValueOnce(new Error('offline'));
    const live = journal();
    await expect(live.redeem(request, 'run:before', 'run:preview')).rejects.toThrow('offline');
    await expect(live.redeem({ ...request, operationId: 'new-operation' }, 'run:before', 'run:preview')).rejects.toThrow('previous tool');
    expect(service.redeemTool).toHaveBeenCalledTimes(1);
  });

  test('demo, sandbox and production journals never share a key', () => {
    expect(new Set([
      paidToolJournalKey({ mode: 'mock', environment: 'sandbox' }),
      paidToolJournalKey({ mode: 'native', environment: 'sandbox' }),
      paidToolJournalKey({ mode: 'native', environment: 'production' }),
    ]).size).toBe(3);
  });
});
