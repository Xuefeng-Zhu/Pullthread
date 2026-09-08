import { jest, test, expect } from '@jest/globals';
import { RankedJournal, ACTIVE_RANKED_KEY } from '../journal';
import type { LeaderboardService, RankedRun, ReplayBatch } from '../contracts';
const run: RankedRun = { id: 'ranked-run', uid: 'guest', seed: 1, week: 0, deadline: 9999999999999, ruleset: 'stitched-v4-weekly-1', environment: 'sandbox' };
function setup() {
  const values = new Map<string, string>();
  const storage = { getItem: jest.fn(async (key: string) => values.get(key) ?? null), setItem: jest.fn(async (key: string, value: string) => { values.set(key, value); }), removeItem: jest.fn(async (key: string) => { values.delete(key); }) };
  const upload = jest.fn(async (_id: string, batch: ReplayBatch) => ({ sequence: batch.sequence, score: 2 }));
  const service = { upload, getAccountId: async () => 'guest' } as unknown as LeaderboardService;
  return { values, storage, service, upload, journal: new RankedJournal(run, storage, service) };
}
test('only durable batches upload; retries preserve exact sequence and commands', async () => {
  const { journal, upload } = setup();
  for (let tick = 0; tick < 240; tick++) journal.tick();
  await journal.flush(); expect(upload).not.toHaveBeenCalled();
  journal.action({ type: 'aim' });
  await journal.checkpoint('checkpoint');
  upload.mockRejectedValueOnce(new Error('offline'));
  await journal.flush(); expect(journal.status).toContain('Pending');
  await journal.flush();
  expect(upload.mock.calls[0]).toEqual(upload.mock.calls[1]);
  expect(journal.verifiedScore).toBe(2);
});
test('recovery keeps the checkpoint and rejects a changed account', async () => {
  const { journal, storage, service } = setup();
  await journal.activate(); journal.tick(); await journal.checkpoint('snapshot');
  const restored = await RankedJournal.recover(storage, service);
  expect(restored?.snapshot).toBe('snapshot');
  expect(await RankedJournal.recover(storage, { ...service, getAccountId: async () => 'other' })).toBeNull();
});
test('paid delivery recovered after a crash records exactly one tool action', async () => {
  const { journal, storage, service, upload } = setup();
  await journal.activate();
  await journal.prepareTool({ type: 'tool', tool: 'preview', operationId: 'receipt' }, 'before', 'after');
  const recovered = (await RankedJournal.recover(storage, service))!;
  expect(recovered.reconcileTool('after')).toBe(true);
  await recovered.checkpoint('after'); await recovered.flush();
  expect(upload.mock.calls[0][1].commands).toEqual([{ type: 'tool', tool: 'preview', operationId: 'receipt', at: 0 }]);
});
test('old run writes cannot overwrite the active run pointer', async () => {
  const { journal, storage, service } = setup();
  await journal.activate();
  const next = new RankedJournal({ ...run, id: 'next' }, storage, service);
  await next.activate(); const active = await storage.getItem(ACTIVE_RANKED_KEY);
  await journal.checkpoint('old'); expect(await storage.getItem(ACTIVE_RANKED_KEY)).toBe(active);
});
test('a saved run from last week can continue locally without entering the new week', async () => {
  const { storage, service, upload } = setup();
  const old = new RankedJournal({ ...run, deadline: 1 }, storage, service);
  await old.activate(); old.tick(); await old.checkpoint('last-week');
  const recovered = (await RankedJournal.recover(storage, service))!;
  expect(recovered.snapshot).toBe('last-week');
  expect(recovered.status).toContain('Week ended');
  recovered.tick(); await recovered.checkpoint('continued-locally'); await recovered.flush();
  expect(upload).not.toHaveBeenCalled();
  expect((await RankedJournal.recover(storage, service))?.snapshot).toBe('continued-locally');
});
