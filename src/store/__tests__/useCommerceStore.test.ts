/** @jest-environment node */
import { describe, expect, jest, test } from '@jest/globals';
import type { CommerceService, CommerceWallet, RedeemToolRequest } from '../../commerce/contracts';
import { createCommerceService } from '../../services/commerce';
import { createCommerceStore } from '../useCommerceStore';

const wallet = (points = 100, revision = 1): CommerceWallet => ({ points, revision, environment: 'sandbox' });
const request: RedeemToolRequest = { operationId: 'tool-1', runId: 'run-1', tool: 'preview', expectedCost: 10, contextKey: 'tick:45' };

function provider(): jest.Mocked<CommerceService> {
  return { mode: 'native', environment: 'sandbox',
    getAccountId: jest.fn<CommerceService['getAccountId']>().mockResolvedValue('guest'),
    getWallet: jest.fn<CommerceService['getWallet']>().mockResolvedValue(wallet()),
    getOffers: jest.fn<CommerceService['getOffers']>().mockResolvedValue([{ productId: 'pullthread_points_100', points: 100, priceLabel: '$1.99' }]),
    purchasePoints: jest.fn<CommerceService['purchasePoints']>().mockResolvedValue({ status: 'verified', wallet: wallet(200, 2) }),
    redeemTool: jest.fn<CommerceService['redeemTool']>().mockResolvedValue({ wallet: wallet(90, 2), receipt: { ...request, status: 'ready' } }),
    getRedemption: jest.fn<CommerceService['getRedemption']>().mockResolvedValue(null),
    resolveTool: jest.fn<CommerceService['resolveTool']>().mockResolvedValue({ wallet: wallet(100, 3), receipt: { ...request, status: 'refunded' } }),
  };
}

describe('commerce display store', () => {
  test('starts without a cached balance and concurrent initialization shares one read', async () => {
    const service = provider();
    const store = createCommerceStore(service);
    expect(store.getState().wallet).toBeNull();
    const first = store.getState().initialize();
    expect(store.getState().initialize()).toBe(first);
    await first;
    expect(store.getState()).toMatchObject({ status: 'ready', wallet: wallet(), busy: false });
    expect(service.getWallet).toHaveBeenCalledTimes(1);
  });

  test('initial auth failure is fail-soft, displays no balance, and is retryable', async () => {
    const service = provider();
    service.getWallet.mockRejectedValueOnce(new Error('auth failed'));
    const store = createCommerceStore(service);
    await store.getState().initialize();
    expect(store.getState()).toMatchObject({ status: 'error', wallet: null });
    await store.getState().initialize();
    expect(store.getState().status).toBe('ready');
  });

  test('opening or refreshing the shop rechecks prices and delayed verified purchases', async () => {
    const service = provider();
    service.getOffers.mockRejectedValueOnce(new Error('store offline'));
    const store = createCommerceStore(service);
    await store.getState().initialize();
    expect(store.getState()).toMatchObject({ status: 'ready', offers: [] });
    service.getWallet.mockResolvedValue(wallet(200, 2));
    await store.getState().initialize();
    expect(service.getWallet).toHaveBeenCalledTimes(2);
    expect(store.getState()).toMatchObject({ wallet: wallet(200, 2), error: null });
    expect(store.getState().offers).toHaveLength(1);
  });

  test('journal receipts use the same revision and environment guard as refreshes', () => {
    const store = createCommerceStore(provider());
    store.getState().acceptWallet(wallet(90, 2));
    store.getState().acceptWallet(wallet(100, 1));
    expect(store.getState().wallet).toEqual(wallet(90, 2));
    expect(() => store.getState().acceptWallet({ ...wallet(1000, 3), environment: 'production' })).toThrow();
    expect(store.getState().wallet).toEqual(wallet(90, 2));
  });

  test('unavailable builds never initialize a provider; offers failure still leaves a verified wallet usable', async () => {
    const unavailable = createCommerceService({ enabled: false, mock: false, development: false, platform: 'web', firebase: {} });
    const blocked = createCommerceStore(unavailable);
    await blocked.getState().initialize();
    expect(blocked.getState()).toMatchObject({ status: 'unavailable', wallet: null, offers: [] });
    const service = provider();
    service.getOffers.mockRejectedValue(new Error('store offline'));
    const store = createCommerceStore(service);
    await store.getState().initialize();
    expect(store.getState()).toMatchObject({ status: 'ready', wallet: wallet(), offers: [] });
    await store.getState().redeemTool(request);
    expect(store.getState().wallet?.points).toBe(90);
  });

  test.each(['cancelled', 'pending'] as const)('%s purchases retain only the returned verified wallet', async (status) => {
    const service = provider();
    service.purchasePoints.mockResolvedValue({ status, wallet: wallet() });
    const store = createCommerceStore(service);
    await store.getState().initialize();
    await store.getState().purchasePoints('pullthread_points_100');
    expect(store.getState()).toMatchObject({ wallet: wallet(), purchaseStatus: status, busy: false });
  });

  test('double tapping a pack shares one purchase while the visible balance waits for verification', async () => {
    const service = provider();
    let complete!: (value: Awaited<ReturnType<CommerceService['purchasePoints']>>) => void;
    service.purchasePoints.mockReturnValue(new Promise((resolve) => { complete = resolve; }));
    const store = createCommerceStore(service);
    await store.getState().initialize();
    const first = store.getState().purchasePoints('pullthread_points_100');
    const duplicate = store.getState().purchasePoints('pullthread_points_100');
    expect(duplicate).toBe(first);
    expect(store.getState()).toMatchObject({ wallet: wallet(), busy: true });
    await expect(store.getState().purchasePoints('pullthread_points_550')).rejects.toThrow('Finish');
    complete({ status: 'verified', wallet: wallet(200, 2) });
    await first;
    expect(service.purchasePoints).toHaveBeenCalledTimes(1);
    expect(store.getState().wallet).toEqual(wallet(200, 2));
  });

  test('a stale refresh cannot resurrect spent points', async () => {
    const service = provider();
    const store = createCommerceStore(service);
    await store.getState().initialize();
    let complete!: (value: CommerceWallet) => void;
    service.getWallet.mockReturnValueOnce(new Promise((resolve) => { complete = resolve; }));
    const refresh = store.getState().refreshWallet();
    await store.getState().redeemTool(request);
    complete(wallet(100, 1));
    await refresh;
    expect(store.getState().wallet).toEqual(wallet(90, 2));
    await store.getState().resolveTool(request.operationId, 'refund');
    expect(store.getState().wallet).toEqual(wallet(100, 3));
  });

  test('an interrupted debit never changes local points and can reconcile the same receipt', async () => {
    const service = provider();
    service.redeemTool.mockRejectedValue(new Error('response lost'));
    service.getRedemption.mockResolvedValue({ wallet: wallet(90, 2), receipt: { ...request, status: 'ready' } });
    const store = createCommerceStore(service);
    await store.getState().initialize();
    await expect(store.getState().redeemTool(request)).rejects.toThrow('response lost');
    expect(store.getState()).toMatchObject({ status: 'error', wallet: wallet() });
    await store.getState().getRedemption(request.operationId);
    expect(store.getState()).toMatchObject({ status: 'ready', wallet: wallet(90, 2) });
  });

  test('demo balances are labeled and never hydrate into another store', async () => {
    const service = createCommerceService({ enabled: true, mock: true, development: true, platform: 'web', environment: 'sandbox', firebase: {} });
    const store = createCommerceStore(service);
    await store.getState().initialize();
    await store.getState().purchasePoints('pullthread_points_100');
    expect(store.getState()).toMatchObject({ mode: 'mock', notice: 'Demo wallet · no real purchases' });
    const other = createCommerceStore(provider());
    expect(other.getState().wallet).toBeNull();
  });
});
