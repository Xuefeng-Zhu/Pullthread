/** @jest-environment node */
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import type { CommerceConfig } from '../config';
import type { NativeCommerceRuntime } from '../nativeService';

const mockToken = jest.fn(async () => 'firebase-web-token');
const mockAuth: { currentUser: { uid: string; getIdToken: typeof mockToken } | null; authStateReady: jest.Mock<() => Promise<void>> } = {
  currentUser: null, authStateReady: jest.fn<() => Promise<void>>(),
};
const mockSignIn = jest.fn(async () => ({ user: { uid: 'new-web-guest', getIdToken: mockToken } }));
const mockApp = { name: 'pullthread-commerce', options: { projectId: 'project', appId: 'app' } };
const mockCall = jest.fn(async () => ({ data: { wallet: { points: 0 } } }));
const mockPurchases = {
  isConfigured: jest.fn(async () => false), configure: jest.fn((_options: unknown) => undefined),
  getAppUserID: jest.fn(async () => 'web-guest'), getOfferings: jest.fn<() => Promise<unknown>>(),
  purchasePackage: jest.fn<(_item: unknown) => Promise<unknown>>(),
};

jest.mock('firebase/app', () => ({ getApps: () => [mockApp], initializeApp: jest.fn() }));
jest.mock('firebase/auth', () => ({ getAuth: () => mockAuth, signInAnonymously: mockSignIn }));
jest.mock('firebase/functions', () => ({ getFunctions: () => ({}), httpsCallable: () => mockCall }));
jest.mock('react-native-purchases', () => ({ __esModule: true, default: mockPurchases,
  PRODUCT_CATEGORY: { NON_SUBSCRIPTION: 'NON_SUBSCRIPTION' },
  PURCHASES_ERROR_CODE: { PURCHASE_CANCELLED_ERROR: '1', PAYMENT_PENDING_ERROR: '20' },
}));

const config: CommerceConfig = { enabled: true, mock: false, development: true, platform: 'web',
  environment: 'sandbox', revenueCatKey: 'rcb_web_public', firebase: { apiKey: 'public', ...mockApp.options },
  backendProvider: 'workers', backendUrl: 'https://points.example.com' };
const product = (identifier = 'pullthread_points_100', productCategory = 'NON_SUBSCRIPTION') => ({
  identifier: 'web-package', product: { identifier, productCategory, priceString: '$0.99' },
});

async function runtime(overrides: Partial<CommerceConfig> = {}): Promise<NativeCommerceRuntime> {
  let result!: NativeCommerceRuntime;
  await jest.isolateModulesAsync(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const webModule = require('../nativeRuntime.web') as typeof import('../nativeRuntime.web');
    result = await webModule.loadNativeRuntime({ ...config, ...overrides });
  });
  return result;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.currentUser = { uid: 'web-guest', getIdToken: mockToken };
  mockAuth.authStateReady.mockResolvedValue(undefined);
  mockToken.mockResolvedValue('firebase-web-token');
  mockPurchases.isConfigured.mockResolvedValue(false);
  mockPurchases.getAppUserID.mockResolvedValue('web-guest');
  mockPurchases.getOfferings.mockResolvedValue({ all: { points: { availablePackages: [product()] } } });
  mockPurchases.purchasePackage.mockResolvedValue({ transaction: { transactionIdentifier: 'rcb-transaction' } });
});
afterEach(() => { jest.restoreAllMocks(); });

describe('RevenueCat Billing browser runtime', () => {
  test('uses persistent Firebase web identity and creates a guest only when none was restored', async () => {
    const adapter = await runtime();
    expect(await adapter.authenticate()).toBe('web-guest');
    expect(mockSignIn).not.toHaveBeenCalled();
    mockAuth.currentUser = null;
    const fresh = await runtime();
    expect(await fresh.authenticate()).toBe('new-web-guest');
    expect(mockSignIn).toHaveBeenCalledWith(mockAuth);
  });

  test('loads only allowlisted one-time point packs and returns the web transaction identifier', async () => {
    mockPurchases.getOfferings.mockResolvedValue({ all: { points: { availablePackages: [
      product(), product('pullthread_points_550', 'SUBSCRIPTION'), product('unrelated'),
    ] } } });
    const adapter = await runtime();
    await adapter.configure('web-guest', 'rcb_web_public');
    expect(mockPurchases.configure).toHaveBeenCalledWith({ appUserID: 'web-guest', apiKey: 'rcb_web_public' });
    expect(await adapter.getProducts()).toEqual([{ productId: 'pullthread_points_100', priceLabel: '$0.99' }]);
    expect(await adapter.purchase('pullthread_points_100')).toEqual({ status: 'completed', transactionId: 'rcb-transaction' });
    await expect(adapter.purchase('pullthread_points_550')).rejects.toThrow('unavailable');
  });

  test.each([{ code: 1, status: 'cancelled' }, { code: 20, status: 'pending' }] as const)(
    'maps the browser SDK numeric error $code to $status', async ({ code, status }) => {
      mockPurchases.purchasePackage.mockRejectedValueOnce({ code });
      const adapter = await runtime();
      await adapter.configure('web-guest', 'rcb_web_public');
      await adapter.getProducts();
      expect(await adapter.purchase('pullthread_points_100')).toEqual({ status });
    },
  );

  test('calls the Worker with a fresh Firebase token and refuses changed identity', async () => {
    const fetcher = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ result: { wallet: { points: 25 } } }), {
      headers: { 'content-type': 'application/json' },
    }));
    const adapter = await runtime();
    expect(await adapter.authenticate()).toBe('web-guest');
    expect(await adapter.call('commerceSyncWallet', { environment: 'sandbox' })).toEqual({ wallet: { points: 25 } });
    expect(fetcher).toHaveBeenCalledWith('https://points.example.com/commerceSyncWallet', expect.objectContaining({
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer firebase-web-token' },
    }));
    mockAuth.currentUser = { uid: 'changed-web-guest', getIdToken: mockToken };
    await expect(adapter.call('commerceSyncWallet', { environment: 'sandbox' })).rejects.toThrow('guest account changed');
  });

  test('does not run the browser adapter on another platform', async () => {
    await expect(runtime({ platform: 'windows' })).rejects.toThrow('unavailable on this platform');
  });
});
