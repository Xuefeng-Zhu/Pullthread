import { describe, expect, it, jest } from '@jest/globals';
import {
  RevenueCatEntitlementService,
  type PurchasesClient,
  type RevenueCatCustomerInfo,
  type RevenueCatCustomerInfoListener,
  type RevenueCatOfferings,
  type RevenueCatPackage,
} from '../RevenueCatEntitlementService';

const lockedCustomerInfo = (): RevenueCatCustomerInfo => ({
  entitlements: { active: {} },
});

const unlockedCustomerInfo = (): RevenueCatCustomerInfo => ({
  entitlements: {
    active: {
      full_atelier: { isActive: true },
    },
  },
});

const makePackage = (
  identifier = 'pullthread_full_game',
  productOverrides: Partial<RevenueCatPackage['product']> = {},
): RevenueCatPackage => ({
  product: {
    identifier,
    title: 'Full Atelier',
    description: 'Unlock the complete campaign.',
    priceString: '$4.99',
    productCategory: 'NON_SUBSCRIPTION',
    productType: 'NON_CONSUMABLE',
    ...productOverrides,
  },
});

const makeOfferings = (
  availablePackages: readonly RevenueCatPackage[] = [makePackage()],
): RevenueCatOfferings => ({
  current: { availablePackages },
});

const makeClient = (
  overrides: Partial<PurchasesClient> = {},
): PurchasesClient => ({
  isConfigured: jest.fn(async () => false),
  configure:
    jest.fn<(configuration: Readonly<{ apiKey: string }>) => void>(),
  getCustomerInfo: jest.fn(async () => lockedCustomerInfo()),
  getOfferings: jest.fn(async () => makeOfferings()),
  purchasePackage: jest.fn(async () => ({
    customerInfo: unlockedCustomerInfo(),
  })),
  restorePurchases: jest.fn(async () => lockedCustomerInfo()),
  addCustomerInfoUpdateListener: jest.fn(),
  removeCustomerInfoUpdateListener: jest.fn(() => true),
  ...overrides,
});

describe('RevenueCatEntitlementService', () => {
  it('configures the RevenueCat singleton at most once', async () => {
    const client = makeClient();
    const service = new RevenueCatEntitlementService('  public_ios_key  ', client);

    await Promise.all([service.initialize(), service.initialize()]);
    await service.initialize();

    expect(client.isConfigured).toHaveBeenCalledTimes(1);
    expect(client.configure).toHaveBeenCalledTimes(1);
    expect(client.configure).toHaveBeenCalledWith({ apiKey: 'public_ios_key' });
  });

  it('does not configure an SDK instance that is already configured', async () => {
    const client = makeClient({
      isConfigured: jest.fn(async () => true),
    });
    const service = new RevenueCatEntitlementService('public_ios_key', client);

    await service.initialize();

    expect(client.configure).not.toHaveBeenCalled();
  });

  it('checks only the canonical Full Atelier entitlement', async () => {
    const client = makeClient({
      getCustomerInfo: jest
        .fn<() => Promise<RevenueCatCustomerInfo>>()
        .mockResolvedValueOnce({
          entitlements: { active: { another_entitlement: { isActive: true } } },
        })
        .mockResolvedValueOnce(unlockedCustomerInfo()),
    });
    const service = new RevenueCatEntitlementService('public_ios_key', client);

    await expect(service.hasFullGame()).resolves.toBe(false);
    await expect(service.hasFullGame()).resolves.toBe(true);
  });

  it('maps the configured full-game package into a localized offer', async () => {
    const client = makeClient({
      getOfferings: jest.fn(async () =>
        makeOfferings([makePackage('another_product'), makePackage()]),
      ),
    });
    const service = new RevenueCatEntitlementService('public_ios_key', client);

    await expect(service.getFullGameOffer()).resolves.toEqual({
      productId: 'pullthread_full_game',
      title: 'Full Atelier',
      description: 'Unlock the complete campaign.',
      priceString: '$4.99',
    });
  });

  it('accepts an explicit non-consumable when its category is null', async () => {
    const androidPackage = makePackage('pullthread_full_game', {
      productCategory: null,
      productType: 'NON_CONSUMABLE',
    });
    const client = makeClient({
      getOfferings: jest.fn(async () => makeOfferings([androidPackage])),
    });
    const service = new RevenueCatEntitlementService(
      'public_android_key',
      client,
      'android',
    );

    await expect(service.getFullGameOffer()).resolves.toMatchObject({
      productId: 'pullthread_full_game',
      priceString: '$4.99',
    });
    await expect(service.purchaseFullGame()).resolves.toEqual({
      status: 'purchased',
    });
    expect(client.purchasePackage).toHaveBeenCalledWith(androidPackage);
  });

  it('accepts the installed Google Play INAPP metadata mapping', async () => {
    const androidPackage = makePackage('pullthread_full_game', {
      productCategory: 'NON_SUBSCRIPTION',
      productType: 'CONSUMABLE',
    });
    const client = makeClient({
      getOfferings: jest.fn(async () => makeOfferings([androidPackage])),
    });
    const service = new RevenueCatEntitlementService(
      'public_android_key',
      client,
      'android',
    );

    await expect(service.getFullGameOffer()).resolves.toMatchObject({
      productId: 'pullthread_full_game',
      priceString: '$4.99',
    });
    await expect(service.purchaseFullGame()).resolves.toEqual({
      status: 'purchased',
    });
    expect(client.purchasePackage).toHaveBeenCalledWith(androidPackage);
  });

  it('returns null when the current offering lacks the full-game product', async () => {
    const client = makeClient({
      getOfferings: jest.fn(async () =>
        makeOfferings([makePackage('another_product')]),
      ),
    });
    const service = new RevenueCatEntitlementService('public_ios_key', client);

    await expect(service.getFullGameOffer()).resolves.toBeNull();
  });

  it.each([
    {
      productCategory: 'SUBSCRIPTION' as const,
      productType: 'AUTO_RENEWABLE_SUBSCRIPTION' as const,
    },
    {
      productCategory: 'UNKNOWN' as const,
      productType: 'UNKNOWN' as const,
    },
    {
      productCategory: 'NON_SUBSCRIPTION' as const,
      productType: 'CONSUMABLE' as const,
    },
    {
      productCategory: 'NON_SUBSCRIPTION' as const,
      productType: 'UNKNOWN' as const,
    },
    {
      productCategory: null,
      productType: 'CONSUMABLE' as const,
    },
    {
      productCategory: null,
      productType: 'AUTO_RENEWABLE_SUBSCRIPTION' as const,
    },
    {
      productCategory: null,
      productType: 'UNKNOWN' as const,
    },
  ])('rejects a Full Atelier product that is not a known one-time unlock', async (metadata) => {
    const client = makeClient({
      getOfferings: jest.fn(async () =>
        makeOfferings([makePackage('pullthread_full_game', metadata)]),
      ),
    });
    const service = new RevenueCatEntitlementService('public_ios_key', client);

    await expect(service.getFullGameOffer()).resolves.toBeNull();
    await expect(service.purchaseFullGame()).resolves.toEqual({
      status: 'error',
      message: 'The Full Atelier offer is currently unavailable.',
    });
    expect(client.purchasePackage).not.toHaveBeenCalled();
  });

  it('purchases the matching package and verifies returned entitlement state', async () => {
    const fullGamePackage = makePackage();
    const client = makeClient({
      getOfferings: jest.fn(async () => makeOfferings([fullGamePackage])),
      purchasePackage: jest.fn(async () => ({
        customerInfo: unlockedCustomerInfo(),
      })),
    });
    const service = new RevenueCatEntitlementService('public_ios_key', client);

    await expect(service.purchaseFullGame()).resolves.toEqual({
      status: 'purchased',
    });
    expect(client.purchasePackage).toHaveBeenCalledWith(fullGamePackage);
  });

  it('treats user cancellation as a neutral purchase result', async () => {
    const client = makeClient({
      purchasePackage: jest.fn(async () => {
        throw { code: '1', message: 'Cancelled', userCancelled: true };
      }),
    });
    const service = new RevenueCatEntitlementService('public_ios_key', client);

    await expect(service.purchaseFullGame()).resolves.toEqual({
      status: 'cancelled',
    });
  });

  it('does not claim success without the Full Atelier entitlement', async () => {
    const client = makeClient({
      purchasePackage: jest.fn(async () => ({
        customerInfo: lockedCustomerInfo(),
      })),
    });
    const service = new RevenueCatEntitlementService('public_ios_key', client);

    await expect(service.purchaseFullGame()).resolves.toEqual({
      status: 'error',
      message: 'The purchase completed, but Full Atelier access is not active.',
    });
  });

  it('reports restored and not-found outcomes from returned CustomerInfo', async () => {
    const client = makeClient({
      restorePurchases: jest
        .fn<() => Promise<RevenueCatCustomerInfo>>()
        .mockResolvedValueOnce(unlockedCustomerInfo())
        .mockResolvedValueOnce(lockedCustomerInfo()),
    });
    const service = new RevenueCatEntitlementService('public_ios_key', client);

    await expect(service.restorePurchases()).resolves.toEqual({
      status: 'restored',
    });
    await expect(service.restorePurchases()).resolves.toEqual({
      status: 'not-found',
    });
  });

  it('returns a restore error without manufacturing entitlement state', async () => {
    const client = makeClient({
      restorePurchases: jest.fn(async () => {
        throw new Error('Store is offline');
      }),
    });
    const service = new RevenueCatEntitlementService('public_ios_key', client);

    await expect(service.restorePurchases()).resolves.toEqual({
      status: 'error',
      message: 'Store is offline',
    });
  });

  it('removes the exact stable RevenueCat listener on unsubscribe', async () => {
    let revenueCatListener: RevenueCatCustomerInfoListener | undefined;
    const client = makeClient({
      addCustomerInfoUpdateListener:
        jest.fn<(listener: RevenueCatCustomerInfoListener) => void>(
          (listener) => {
            revenueCatListener = listener;
          },
        ),
    });
    const service = new RevenueCatEntitlementService('public_ios_key', client);
    const listener = jest.fn();

    const unsubscribe = service.subscribe(listener);
    await service.initialize();

    expect(revenueCatListener).toBeDefined();
    revenueCatListener?.(unlockedCustomerInfo());
    expect(listener).toHaveBeenCalledWith(true);

    unsubscribe();
    unsubscribe();

    expect(client.removeCustomerInfoUpdateListener).toHaveBeenCalledTimes(1);
    expect(client.removeCustomerInfoUpdateListener).toHaveBeenCalledWith(
      revenueCatListener,
    );
  });
});
