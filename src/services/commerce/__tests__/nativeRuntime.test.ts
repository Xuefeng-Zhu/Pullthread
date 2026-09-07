/** @jest-environment node */
import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CommerceConfig } from '../config';
import type { NativeCommerceRuntime } from '../nativeService';

const mockAuth: { currentUser: { uid: string } | null; authStateReady: jest.Mock<() => Promise<void>> } = {
  currentUser: null, authStateReady: jest.fn<() => Promise<void>>(),
};
const mockPersistence = jest.fn(() => ({ type: 'LOCAL' }));
const mockInitializeAuth = jest.fn(() => mockAuth);
const mockSignIn = jest.fn(async () => ({ user: { uid: 'new-guest' } }));
const mockApp = { name: 'pullthread-commerce', options: { projectId: 'project', appId: 'app' } };
const mockCall = jest.fn(async (_payload: unknown) => ({ data: { wallet: { points: 0 } } }));
const mockCallable = jest.fn(() => mockCall);
const mockPurchases = {
  isConfigured: jest.fn(async () => false),
  configure: jest.fn((_options: unknown) => undefined),
  getAppUserID: jest.fn(async () => 'restored-guest'),
  getOfferings: jest.fn<() => Promise<unknown>>(),
  purchasePackage: jest.fn<(_item: unknown) => Promise<unknown>>(),
};

jest.mock('firebase/app', () => ({ getApps: () => [mockApp], initializeApp: jest.fn() }));
jest.mock('firebase/auth', () => ({
  getReactNativePersistence: mockPersistence, initializeAuth: mockInitializeAuth,
  getAuth: () => mockAuth, signInAnonymously: mockSignIn,
}));
jest.mock('firebase/functions', () => ({ getFunctions: () => ({}), httpsCallable: mockCallable }));
jest.mock('react-native-purchases', () => ({ __esModule: true, default: mockPurchases,
  PRODUCT_CATEGORY: { NON_SUBSCRIPTION: 'NON_SUBSCRIPTION' },
  PURCHASES_ERROR_CODE: { PURCHASE_CANCELLED_ERROR: '1', PAYMENT_PENDING_ERROR: '20' },
}));

const config: CommerceConfig = { enabled: true, mock: false, development: true, platform: 'ios',
  environment: 'sandbox', revenueCatKey: 'appl_public', firebase: { apiKey: 'public', ...mockApp.options } };
const product = (identifier = 'pullthread_points_100', productCategory = 'NON_SUBSCRIPTION') => ({
  identifier: 'package', product: { identifier, productCategory, priceString: '€1,29' },
});

async function runtime(): Promise<NativeCommerceRuntime> {
  let result!: NativeCommerceRuntime;
  await jest.isolateModulesAsync(async () => {
    // Jest's CJS runner needs require to reload native module state per case.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nativeModule = require('../nativeRuntime.native') as typeof import('../nativeRuntime.native');
    result = await nativeModule.loadNativeRuntime(config);
  });
  return result;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.currentUser = { uid: 'restored-guest' };
  mockAuth.authStateReady.mockResolvedValue(undefined);
  mockInitializeAuth.mockImplementation(() => mockAuth);
  mockPurchases.isConfigured.mockResolvedValue(false);
  mockPurchases.getAppUserID.mockResolvedValue('restored-guest');
  mockPurchases.getOfferings.mockResolvedValue({ all: { points: { availablePackages: [product()] } } });
  mockPurchases.purchasePackage.mockResolvedValue({ transaction: { transactionIdentifier: 'store-transaction' } });
});

describe('native guest identity and RevenueCat adapter', () => {
  test('restores persisted Firebase auth before deciding whether to create a guest', async () => {
    let restored!: () => void;
    mockAuth.currentUser = null;
    mockAuth.authStateReady.mockReturnValue(new Promise((resolve) => { restored = resolve; }));
    const adapter = await runtime();
    expect(mockPersistence).toHaveBeenCalledWith(AsyncStorage);
    const identity = adapter.authenticate();
    expect(adapter.authenticate()).toBe(identity);
    expect(mockSignIn).not.toHaveBeenCalled();
    mockAuth.currentUser = { uid: 'restored-guest' };
    restored();
    expect(await identity).toBe('restored-guest');
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  test('only creates an anonymous guest after restoration confirms no existing user', async () => {
    mockAuth.currentUser = null;
    const adapter = await runtime();
    expect(await adapter.authenticate()).toBe('new-guest');
    expect(mockSignIn).toHaveBeenCalledTimes(1);
    expect(mockSignIn).toHaveBeenCalledWith(mockAuth);
  });

  test('configures once with the stable UID and rejects changed native or Firebase identities', async () => {
    const adapter = await runtime();
    await Promise.all([adapter.configure('restored-guest', 'appl_public'), adapter.configure('restored-guest', 'appl_public')]);
    expect(mockPurchases.configure).toHaveBeenCalledTimes(1);
    expect(mockPurchases.configure).toHaveBeenCalledWith({ appUserID: 'restored-guest', apiKey: 'appl_public' });
    await adapter.getProducts();
    await expect(adapter.configure('another-guest', 'appl_public')).rejects.toThrow('guest account');
    mockAuth.currentUser = { uid: 'another-guest' };
    await expect(adapter.call('commerceRedeemTool', {})).rejects.toThrow('guest account changed');
    await expect(adapter.purchase('pullthread_points_100')).rejects.toThrow('guest account changed');
    expect(mockCall).not.toHaveBeenCalled();
    expect(mockPurchases.purchasePackage).not.toHaveBeenCalled();
  });

  test('an existing RevenueCat SDK configured to a different UID cannot open checkout', async () => {
    mockPurchases.isConfigured.mockResolvedValue(true);
    mockPurchases.getAppUserID.mockResolvedValue('other-guest');
    const adapter = await runtime();
    await expect(adapter.configure('restored-guest', 'appl_public')).rejects.toThrow('could not be verified');
    expect(mockPurchases.configure).not.toHaveBeenCalled();
    expect(mockPurchases.purchasePackage).not.toHaveBeenCalled();
  });

  test('uses only allowlisted non-subscription products in the named points offering', async () => {
    mockPurchases.getOfferings.mockResolvedValue({ current: { availablePackages: [product('pullthread_points_550')] },
      all: { points: { availablePackages: [product(), product('pullthread_points_550', 'SUBSCRIPTION'), product('unrelated')] } } });
    const adapter = await runtime();
    expect(await adapter.getProducts()).toEqual([{ productId: 'pullthread_points_100', priceLabel: '€1,29' }]);
    await expect(adapter.purchase('pullthread_points_550')).rejects.toThrow('unavailable');
    expect(await adapter.purchase('pullthread_points_100')).toEqual({ status: 'completed', transactionId: 'store-transaction' });
    expect(mockPurchases.purchasePackage).toHaveBeenCalledWith(product());
  });

  test.each([{ code: '1', status: 'cancelled' }, { code: '20', status: 'pending' }])('maps SDK $code without inventing a transaction', async ({ code, status }) => {
    const adapter = await runtime();
    await adapter.getProducts();
    mockPurchases.purchasePackage.mockRejectedValueOnce({ code });
    expect(await adapter.purchase('pullthread_points_100')).toEqual({ status });
  });

  test('failed persisted auth does not silently fall back to a fresh guest', async () => {
    mockAuth.authStateReady.mockRejectedValueOnce(new Error('storage failed'));
    const adapter = await runtime();
    await expect(adapter.authenticate()).rejects.toThrow('storage failed');
    expect(mockSignIn).not.toHaveBeenCalled();
    expect(mockPurchases.configure).not.toHaveBeenCalled();
  });
});
