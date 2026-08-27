import { describe, expect, it, jest } from '@jest/globals';
import { MockEntitlementService } from '../MockEntitlementService';
import {
  RevenueCatEntitlementService,
  type PurchasesClient,
} from '../RevenueCatEntitlementService';
import { createEntitlementService } from '../createEntitlementService';

const makeClient = (): PurchasesClient => ({
  isConfigured: jest.fn(async () => false),
  configure:
    jest.fn<(configuration: Readonly<{ apiKey: string }>) => void>(),
  getCustomerInfo: jest.fn(async () => ({
    entitlements: { active: {} },
  })),
  getOfferings: jest.fn(async () => ({ current: null })),
  purchasePackage: jest.fn(async () => ({
    customerInfo: { entitlements: { active: {} } },
  })),
  restorePurchases: jest.fn(async () => ({
    entitlements: { active: {} },
  })),
  addCustomerInfoUpdateListener: jest.fn(),
  removeCustomerInfoUpdateListener: jest.fn(() => true),
});

describe('createEntitlementService', () => {
  it('uses the iOS public SDK key for native auto mode', async () => {
    const client = makeClient();
    const service = createEntitlementService({
      platform: 'ios',
      isDevelopment: true,
      mode: 'auto',
      iosApiKey: 'ios_public_key',
      androidApiKey: 'android_public_key',
      purchasesClient: client,
    });

    expect(service).toBeInstanceOf(RevenueCatEntitlementService);
    expect(service.kind).toBe('revenuecat');
    await service.initialize();
    expect(client.configure).toHaveBeenCalledWith({ apiKey: 'ios_public_key' });
  });

  it('uses the Android public SDK key for explicit RevenueCat mode', async () => {
    const client = makeClient();
    const service = createEntitlementService({
      platform: 'android',
      isDevelopment: false,
      mode: 'revenuecat',
      iosApiKey: 'ios_public_key',
      androidApiKey: 'android_public_key',
      purchasesClient: client,
    });

    expect(service.kind).toBe('revenuecat');
    await service.initialize();
    expect(client.configure).toHaveBeenCalledWith({
      apiKey: 'android_public_key',
    });
  });

  it('uses the deterministic mock for native development without keys', () => {
    const service = createEntitlementService({
      platform: 'ios',
      isDevelopment: true,
      mode: 'auto',
    });

    expect(service).toBeInstanceOf(MockEntitlementService);
    expect(service.kind).toBe('mock');
  });

  it('honors explicit mock mode in development', () => {
    const service = createEntitlementService({
      platform: 'web',
      isDevelopment: true,
      mode: 'mock',
    });

    expect(service.kind).toBe('mock');
  });

  it('keeps production locked even if mock mode is misconfigured', async () => {
    const service = createEntitlementService({
      platform: 'ios',
      isDevelopment: false,
      mode: 'mock',
    });

    expect(service.kind).toBe('unavailable');
    await expect(service.hasFullGame()).resolves.toBe(false);
  });

  it('keeps web locked in auto mode instead of loading mobile purchases', async () => {
    const service = createEntitlementService({
      platform: 'web',
      isDevelopment: true,
      mode: 'auto',
      iosApiKey: 'ios_public_key',
    });

    expect(service.kind).toBe('unavailable');
    await expect(service.hasFullGame()).resolves.toBe(false);
    await expect(service.getFullGameOffer()).resolves.toBeNull();
  });

  it('locks production when the selected platform key is missing', async () => {
    const service = createEntitlementService({
      platform: 'ios',
      isDevelopment: false,
      mode: 'auto',
      androidApiKey: 'android_public_key',
    });

    expect(service.kind).toBe('unavailable');
    await expect(service.purchaseFullGame()).resolves.toEqual({
      status: 'error',
      message: 'Purchases are unavailable in this build.',
    });
    await expect(service.restorePurchases()).resolves.toEqual({
      status: 'error',
      message: 'Purchases are unavailable in this build.',
    });
  });

  it('does not silently replace explicitly requested RevenueCat with a mock', () => {
    const service = createEntitlementService({
      platform: 'ios',
      isDevelopment: true,
      mode: 'revenuecat',
    });

    expect(service.kind).toBe('unavailable');
  });
});
