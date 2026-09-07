/** @jest-environment node */
import { describe, expect, jest, test } from '@jest/globals';
import type { CommerceWallet, RedeemToolRequest } from '../../../commerce/contracts';
import { createCommerceService, getCommerceService } from '..';
import type { CommerceConfig } from '../config';
import type { NativeCommerceRuntime, NativeRuntimeLoader } from '../nativeService';
import { isInsufficientPointsError } from '../errors';

const config: CommerceConfig = { enabled: true, mock: false, development: true, platform: 'ios', environment: 'sandbox',
  revenueCatKey: 'appl_public-test', firebase: { apiKey: 'public-key', projectId: 'project', appId: 'app' } };
const wallet = (points = 0, revision = 0): CommerceWallet => ({ points, revision, environment: 'sandbox' });
const request: RedeemToolRequest = { operationId: 'operation-1', runId: 'run-1', tool: 'preview', expectedCost: 10, contextKey: 'tick:12' };

function provider(): jest.Mocked<NativeCommerceRuntime> {
  return {
    authenticate: jest.fn<NativeCommerceRuntime['authenticate']>().mockResolvedValue('stable-guest'),
    configure: jest.fn<NativeCommerceRuntime['configure']>().mockResolvedValue(undefined),
    getProducts: jest.fn<NativeCommerceRuntime['getProducts']>().mockResolvedValue([{ productId: 'pullthread_points_100', priceLabel: '€1.29' }]),
    purchase: jest.fn<NativeCommerceRuntime['purchase']>().mockResolvedValue({ status: 'completed', transactionId: 'store-transaction-1' }),
    call: jest.fn<NativeCommerceRuntime['call']>().mockResolvedValue({ wallet: wallet() }),
  };
}

describe('commerce service gates and native verification', () => {
  test.each([
    { enabled: false }, { platform: 'web' }, { environment: undefined }, { revenueCatKey: undefined },
    { revenueCatKey: 'goog_wrong-platform' }, { firebase: {} },
  ])('unavailable configuration never loads native providers: %j', async (override) => {
    const load = jest.fn<NativeRuntimeLoader>().mockResolvedValue(provider());
    const service = createCommerceService({ ...config, ...override }, load);
    expect(service.mode).toBe('unavailable');
    await expect(service.getWallet()).rejects.toThrow();
    await expect(service.getAccountId()).rejects.toThrow();
    await expect(service.purchasePoints('pullthread_points_100')).rejects.toThrow();
    expect(load).not.toHaveBeenCalled();
  });

  test('the application service is a stable singleton', () => {
    expect(getCommerceService()).toBe(getCommerceService());
  });

  test('concurrent initialization shares authentication/configuration and uses only native prices', async () => {
    const runtime = provider();
    runtime.getProducts.mockResolvedValue([
      { productId: 'pullthread_points_100', priceLabel: '￥120' },
      { productId: 'a_subscription', priceLabel: '$4.99' },
      { productId: 'pullthread_points_550', priceLabel: '' },
    ]);
    const load = jest.fn<NativeRuntimeLoader>().mockResolvedValue(runtime);
    const service = createCommerceService(config, load);
    const [offers, current] = await Promise.all([service.getOffers(), service.getWallet()]);
    expect(offers).toEqual([{ productId: 'pullthread_points_100', points: 100, priceLabel: '￥120' }]);
    expect(current).toEqual(wallet());
    expect(load).toHaveBeenCalledTimes(1);
    expect(runtime.authenticate).toHaveBeenCalledTimes(1);
    expect(runtime.configure).toHaveBeenCalledTimes(1);
    expect(runtime.configure).toHaveBeenCalledWith('stable-guest', 'appl_public-test');
    expect(runtime.call).toHaveBeenCalledWith('commerceSyncWallet', { environment: 'sandbox' });
    expect(await service.getAccountId()).toBe('stable-guest');
  });

  test('failed guest authentication is retryable and never opens a purchase sheet', async () => {
    const runtime = provider();
    runtime.authenticate.mockRejectedValueOnce(new Error('auth unavailable'));
    const service = createCommerceService(config, async () => runtime);
    await expect(service.purchasePoints('pullthread_points_100')).rejects.toThrow('auth unavailable');
    expect(runtime.configure).not.toHaveBeenCalled();
    expect(runtime.purchase).not.toHaveBeenCalled();
    await expect(service.getWallet()).resolves.toEqual(wallet());
    expect(runtime.configure).toHaveBeenCalledTimes(1);
  });

  test.each(['cancelled', 'pending'] as const)('a %s native purchase never optimistically credits a pack', async (status) => {
    const runtime = provider();
    runtime.call.mockResolvedValue({ wallet: wallet(25, 3) });
    runtime.purchase.mockResolvedValue({ status });
    const service = createCommerceService(config, async () => runtime);
    expect(await service.purchasePoints('pullthread_points_100')).toEqual({ status, wallet: wallet(25, 3) });
  });

  test('an exact verified transaction succeeds even when concurrent spending lowers the balance', async () => {
    const runtime = provider();
    runtime.call.mockImplementation(async (_name, payload) => payload.purchase
      ? { wallet: wallet(75, 8), purchase: { ...(payload.purchase as object), verified: true } }
      : { wallet: wallet(100, 5) });
    const service = createCommerceService(config, async () => runtime);
    expect(await service.purchasePoints('pullthread_points_100')).toEqual({ status: 'verified', wallet: wallet(75, 8) });
    expect(runtime.call).toHaveBeenLastCalledWith('commerceSyncWallet', { environment: 'sandbox',
      purchase: { transactionId: 'store-transaction-1', productId: 'pullthread_points_100' } });
  });

  test('a balance increase or another transaction is insufficient proof of this purchase', async () => {
    const runtime = provider();
    runtime.call.mockImplementation(async (_name, payload) => payload.purchase
      ? { wallet: wallet(550, 8), purchase: { transactionId: 'different-purchase', productId: 'pullthread_points_100', verified: true } }
      : { wallet: wallet() });
    const service = createCommerceService(config, async () => runtime);
    expect(await service.purchasePoints('pullthread_points_100')).toEqual({ status: 'pending', wallet: wallet(550, 8) });
  });

  test('a reconciliation failure retains the earlier verified balance and retries its transaction query', async () => {
    const runtime = provider();
    let firstQuery = true;
    runtime.call.mockImplementation(async (_name, payload) => {
      if (!payload.purchase) return { wallet: wallet(10, 1) };
      if (firstQuery) { firstQuery = false; throw new Error('connection interrupted'); }
      return { wallet: wallet(110, 2), purchase: { ...(payload.purchase as object), verified: true } };
    });
    const service = createCommerceService(config, async () => runtime);
    expect(await service.purchasePoints('pullthread_points_100')).toEqual({ status: 'pending', wallet: wallet(10, 1) });
    expect(await service.getWallet()).toEqual(wallet(110, 2));
    expect(runtime.purchase).toHaveBeenCalledTimes(1);
  });

  test('double tapping shares one native purchase and a different concurrent pack is rejected', async () => {
    const runtime = provider();
    const service = createCommerceService(config, async () => runtime);
    const first = service.purchasePoints('pullthread_points_100');
    const duplicate = service.purchasePoints('pullthread_points_100');
    expect(duplicate).toBe(first);
    await expect(service.purchasePoints('pullthread_points_550')).rejects.toThrow('Finish the current purchase first');
    await first;
    expect(runtime.purchase).toHaveBeenCalledTimes(1);
    await expect(service.purchasePoints('not-allowlisted')).rejects.toThrow('unavailable');
    expect(runtime.purchase).toHaveBeenCalledTimes(1);
  });

  test('redemptions carry the frozen binding and reject mismatched receipt or wallet environments', async () => {
    const runtime = provider();
    const receipt = { ...request, status: 'ready' };
    runtime.call.mockResolvedValue({ wallet: wallet(90, 1), receipt });
    const service = createCommerceService(config, async () => runtime);
    expect(await service.redeemTool(request)).toEqual({ wallet: wallet(90, 1), receipt });
    expect(runtime.call).toHaveBeenCalledWith('commerceRedeemTool', { ...request, environment: 'sandbox' });
    runtime.call.mockResolvedValue({ wallet: wallet(90, 1), receipt: { ...receipt, contextKey: 'other-tick' } });
    await expect(service.redeemTool(request)).rejects.toThrow('another action');
    runtime.call.mockResolvedValue({ wallet: { ...wallet(90, 1), environment: 'production' }, receipt });
    await expect(service.getRedemption(request.operationId)).rejects.toThrow('verify this balance');
  });

  test('only an authoritative insufficient balance response for this operation proves no debit', async () => {
    const runtime = provider();
    const service = createCommerceService(config, async () => runtime);
    for (const failure of [
      { code: 'functions/resource-exhausted' },
      { code: 'functions/resource-exhausted', details: { reason: 'insufficient_points', operationId: 'other-action' } },
      { code: 'functions/unavailable', details: { reason: 'insufficient_points', operationId: request.operationId } },
    ]) {
      runtime.call.mockRejectedValueOnce(failure);
      const error = await service.redeemTool(request).catch((value: unknown) => value);
      expect(isInsufficientPointsError(error, request.operationId)).toBe(false);
    }
    runtime.call.mockRejectedValueOnce({ code: 'functions/resource-exhausted',
      details: { reason: 'insufficient_points', operationId: request.operationId } });
    const error = await service.redeemTool(request).catch((value: unknown) => value);
    expect(isInsufficientPointsError(error, request.operationId)).toBe(true);
  });

  test('an anonymous identity change never silently rebinds the initialized store', async () => {
    const runtime = provider();
    const service = createCommerceService(config, async () => runtime);
    expect(await service.getAccountId()).toBe('stable-guest');
    runtime.authenticate.mockResolvedValue('different-guest');
    await expect(service.getAccountId()).rejects.toThrow('guest account changed');
    expect(runtime.configure).toHaveBeenCalledTimes(1);
  });
});

describe('explicit development mock isolation', () => {
  test('mock requires enabled development sandbox configuration, including on web', async () => {
    for (const override of [{ enabled: false }, { development: false }, { environment: 'production' as const }]) {
      expect(createCommerceService({ ...config, mock: true, platform: 'web', ...override }).mode).toBe('unavailable');
    }
    const service = createCommerceService({ ...config, mock: true, platform: 'web' });
    expect(service.mode).toBe('mock');
    expect(await service.getAccountId()).toBe('mock:sandbox:pullthread');
    expect((await service.getOffers()).every((offer) => offer.priceLabel.includes('Demo'))).toBe(true);
    await service.purchasePoints('pullthread_points_100');
    await service.redeemTool(request);
    await service.redeemTool(request);
    expect((await service.getWallet()).points).toBe(90);
    await service.resolveTool(request.operationId, 'refund');
    await service.resolveTool(request.operationId, 'refund');
    expect((await service.getWallet()).points).toBe(100);
    expect((await createCommerceService({ ...config, mock: true }).getWallet()).points).toBe(0);
  });
});
