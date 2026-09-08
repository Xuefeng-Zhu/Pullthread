import { jest, it, expect } from '@jest/globals';
import { COSMETIC_CATALOG, ORIGINAL, ownedAppearance, type CosmeticAccount, type CosmeticService } from '../catalog';
import { createCollectionStore } from '../store';
import { CommerceError } from '../../services/commerce/errors';
jest.mock('../service', () => ({ cosmeticService: {} }));
jest.mock('../../store/useCommerceStore', () => ({ useCommerceStore: { getState: () => ({ acceptWallet: jest.fn() }) } }));
function fixture() {
  const values = new Map<string, string>();
  const storage = { getItem: jest.fn(async (key: string) => values.get(key) ?? null), setItem: jest.fn(async (key: string, value: string) => { values.set(key, value); }), removeItem: jest.fn(async (key: string) => { values.delete(key); }) };
  let account: CosmeticAccount = { uid: 'guest', environment: 'sandbox', owned: [], wallet: { points: 100, revision: 1, environment: 'sandbox' } };
  const service: CosmeticService = { identity: jest.fn(async () => ({ uid: account.uid, environment: account.environment })), account: jest.fn(async () => account), purchase: jest.fn<CosmeticService['purchase']>(async request => {
    if (!account.owned.includes(request.itemId)) account = { ...account, owned: [...account.owned, request.itemId], wallet: { ...account.wallet, points: account.wallet.points - request.expectedPrice, revision: account.wallet.revision + 1 } };
    return account;
  }) };
  return { storage, values, service, setAccount: (next: CosmeticAccount) => { account = next; }, account: () => account };
}
it('launch collection has 12 paid parts and a complete look costs 150', () => {
  expect(COSMETIC_CATALOG.filter(p => p.price)).toHaveLength(12);
  expect(COSMETIC_CATALOG.filter(p => p.category === 'color' && p.price).every(p => p.price === 25)).toBe(true);
  expect(COSMETIC_CATALOG.filter(p => p.category === 'rim' && p.price).every(p => p.price === 50)).toBe(true);
  expect(COSMETIC_CATALOG.filter(p => p.category === 'pattern' && p.price).every(p => p.price === 75)).toBe(true);
  expect(ownedAppearance({ color: 'unknown', rim: 'rim-brass', pattern: 'pattern-stars' }, ['rim-brass'])).toEqual({ ...ORIGINAL, rim: 'rim-brass' });
});
it('persists intent before purchase, unlocks without equipping, equips immediately and recovers offline', async () => {
  const f = fixture(); const store = createCollectionStore(f.service, f.storage);
  await store.getState().initialize(); await store.getState().buy('color-coral');
  expect(f.storage.setItem.mock.invocationCallOrder[1]).toBeLessThan((f.service.purchase as jest.MockedFunction<CosmeticService['purchase']>).mock.invocationCallOrder[0]);
  expect(store.getState().appearance).toEqual(ORIGINAL);
  const look = { ...ORIGINAL, color: 'color-coral' }; await store.getState().equip(look);
  expect(store.getState().appearance).toEqual(look);
  (f.service.account as jest.MockedFunction<CosmeticService['account']>).mockRejectedValue(new Error('Offline'));
  const recovered = createCollectionStore(f.service, f.storage); await recovered.getState().initialize();
  expect(recovered.getState().appearance).toEqual(look);
  await recovered.getState().equip(ORIGINAL); expect(recovered.getState().appearance).toEqual(ORIGINAL);
});
it('lost response retries exactly the durable operation and never buys another part', async () => {
  const f = fixture();
  (f.service.purchase as jest.MockedFunction<CosmeticService['purchase']>).mockReset().mockImplementationOnce(async request => {
    f.setAccount({ ...f.account(), owned: [request.itemId], wallet: { ...f.account().wallet, points: 75, revision: 2 } }); throw new Error('Lost response');
  }).mockImplementation(async () => f.account());
  const store = createCollectionStore(f.service, f.storage); await store.getState().initialize(); await store.getState().buy('color-coral');
  expect(store.getState().owned).toEqual([]); expect(store.getState().pending).toBe(true);
  const recovered = createCollectionStore(f.service, f.storage); await recovered.getState().initialize();
  expect((f.service.purchase as jest.MockedFunction<CosmeticService['purchase']>).mock.calls[0][0]).toEqual((f.service.purchase as jest.MockedFunction<CosmeticService['purchase']>).mock.calls[1][0]);
  expect(recovered.getState().owned).toEqual(['color-coral']); expect(recovered.getState().pending).toBe(false);
});
it('failed durable intent never calls server; locked looks cannot equip', async () => {
  const f = fixture(); const store = createCollectionStore(f.service, f.storage); await store.getState().initialize();
  f.storage.setItem.mockRejectedValueOnce(new Error('Storage full'));
  await store.getState().buy('color-coral'); expect(f.service.purchase).not.toHaveBeenCalled();
  await store.getState().equip({ ...ORIGINAL, rim: 'rim-brass' }); expect(store.getState().appearance).toEqual(ORIGINAL);
});
it('insufficient funds clears only a bound refusal and account changes cannot inherit ownership', async () => {
  const f = fixture(); const store = createCollectionStore(f.service, f.storage); await store.getState().initialize();
  (f.service.purchase as jest.MockedFunction<CosmeticService['purchase']>).mockImplementation(async request => { throw new CommerceError('Not enough', 'insufficient_points', request.operationId); });
  await store.getState().buy('color-coral'); expect(store.getState().pending).toBe(false);
  f.setAccount({ ...f.account(), uid: 'other' }); await store.getState().initialize(); expect(store.getState().owned).toEqual([]);
});
