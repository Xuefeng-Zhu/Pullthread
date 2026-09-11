/** @jest-environment node */
import { beforeEach, expect, jest, test } from '@jest/globals';
import type { NativeCommerceRuntime } from '../../services/commerce/nativeService';
import { createCosmeticService } from '../service';

jest.mock('../../services/commerce/config', () => ({
  readCommerceConfig: () => ({
    mock: false,
    platform: 'web',
    environment: 'sandbox',
    firebase: { apiKey: 'public-key' },
    backendProvider: 'workers',
    backendUrl: 'https://points.example.com',
  }),
  resolveCommerceBackend: () => ({ provider: 'workers', url: 'https://points.example.com' }),
}));

const account = {
  uid: 'web-guest',
  environment: 'sandbox' as const,
  owned: ['rim-scalloped'],
  wallet: { points: 1120, revision: 3, environment: 'sandbox' as const },
};
const authenticate = jest.fn<NativeCommerceRuntime['authenticate']>();
const call = jest.fn<NativeCommerceRuntime['call']>();
const load = jest.fn(async () => ({ authenticate, call } as unknown as NativeCommerceRuntime));

beforeEach(() => {
  jest.clearAllMocks();
  authenticate.mockResolvedValue('web-guest');
  call.mockResolvedValue(account);
});

test('a configured web build loads and purchases from the authenticated cosmetic account', async () => {
  const service = createCosmeticService(load);

  expect(await service.identity()).toEqual({ uid: 'web-guest', environment: 'sandbox' });
  expect(await service.account()).toEqual(account);
  expect(await service.purchase({ operationId: 'cosmetic-web-1', itemId: 'rim-scalloped', expectedPrice: 50 })).toEqual(account);
  expect(load).toHaveBeenCalledTimes(3);
  expect(call).toHaveBeenNthCalledWith(1, 'cosmeticAccount', { environment: 'sandbox' });
  expect(call).toHaveBeenNthCalledWith(2, 'cosmeticPurchase', {
    operationId: 'cosmetic-web-1', itemId: 'rim-scalloped', expectedPrice: 50, environment: 'sandbox',
  });
});
