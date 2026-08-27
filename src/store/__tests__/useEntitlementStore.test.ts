import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from '@jest/globals';

import type { EntitlementService } from '../../services/entitlements/EntitlementService';
import { MockEntitlementService } from '../../services/entitlements/MockEntitlementService';
import {
  ENTITLEMENT_STORAGE_KEY,
  ENTITLEMENT_STORAGE_VERSION,
  initializeEntitlements,
  resetEntitlementStoreForTests,
  selectHasFullGame,
  useEntitlementStore,
} from '../useEntitlementStore';

const persistEntitlementCache = async (
  cachedHasFullGame: boolean,
  cacheSource: 'mock' | 'revenuecat',
): Promise<void> => {
  await AsyncStorage.setItem(
    ENTITLEMENT_STORAGE_KEY,
    JSON.stringify({
      state: {
        cachedHasFullGame,
        cacheSource,
        verifiedAt: 123,
      },
      version: ENTITLEMENT_STORAGE_VERSION,
    }),
  );
};

const createUnavailableService = (): EntitlementService => ({
  kind: 'unavailable',
  initialize: async () => undefined,
  hasFullGame: async () => false,
  getFullGameOffer: async () => null,
  purchaseFullGame: async () => ({
    status: 'error',
    message: 'Purchases are unavailable.',
  }),
  restorePurchases: async () => ({
    status: 'error',
    message: 'Restore is unavailable.',
  }),
  subscribe: () => () => undefined,
});

describe('entitlement store', () => {
  beforeEach(async () => {
    await resetEntitlementStoreForTests();
  });

  afterEach(async () => {
    await resetEntitlementStoreForTests();
  });

  test('hydrates a RevenueCat-verified cache as authoritative offline access', async () => {
    await persistEntitlementCache(true, 'revenuecat');

    await useEntitlementStore.persist.rehydrate();

    expect(useEntitlementStore.getState()).toMatchObject({
      hasFullGame: true,
      cachedHasFullGame: true,
      cacheSource: 'revenuecat',
      verifiedAt: 123,
      status: 'idle',
    });
  });

  test('rejects an unlocked cache without a valid verification record', async () => {
    await AsyncStorage.setItem(
      ENTITLEMENT_STORAGE_KEY,
      JSON.stringify({
        state: {
          cachedHasFullGame: true,
          cacheSource: 'revenuecat',
          verifiedAt: 'yesterday',
        },
        version: ENTITLEMENT_STORAGE_VERSION,
      }),
    );

    await useEntitlementStore.persist.rehydrate();

    expect(useEntitlementStore.getState()).toMatchObject({
      hasFullGame: false,
      cachedHasFullGame: false,
      cacheSource: null,
      verifiedAt: null,
    });
  });

  test('does not trust a mock cache until an injected mock service initializes', async () => {
    await persistEntitlementCache(true, 'mock');
    await useEntitlementStore.persist.rehydrate();

    expect(useEntitlementStore.getState()).toMatchObject({
      hasFullGame: false,
      cachedHasFullGame: true,
      cacheSource: 'mock',
    });

    await initializeEntitlements(new MockEntitlementService());

    expect(useEntitlementStore.getState()).toMatchObject({
      hasFullGame: true,
      cachedHasFullGame: true,
      cacheSource: 'mock',
      serviceKind: 'mock',
      status: 'ready',
    });
  });

  test('records a successful mock purchase and caches the unlock', async () => {
    await initializeEntitlements(new MockEntitlementService());

    const result = await useEntitlementStore.getState().purchaseFullGame();

    expect(result).toEqual({ status: 'purchased' });
    expect(useEntitlementStore.getState()).toMatchObject({
      hasFullGame: true,
      cachedHasFullGame: true,
      cacheSource: 'mock',
      status: 'ready',
      notice: {
        kind: 'success',
        message: 'Full Atelier is unlocked on this device.',
      },
    });
    expect(useEntitlementStore.getState().verifiedAt).toEqual(
      expect.any(Number),
    );
  });

  test('treats a cancelled mock purchase as neutral and keeps access locked', async () => {
    await initializeEntitlements(
      new MockEntitlementService({ purchaseOutcome: 'cancel' }),
    );

    const result = await useEntitlementStore.getState().purchaseFullGame();

    expect(result).toEqual({ status: 'cancelled' });
    expect(useEntitlementStore.getState()).toMatchObject({
      hasFullGame: false,
      cachedHasFullGame: false,
      status: 'ready',
      notice: {
        kind: 'neutral',
        message: 'Purchase cancelled. Nothing was charged.',
      },
    });
  });

  test('surfaces a mock purchase failure without changing cached access', async () => {
    await initializeEntitlements(
      new MockEntitlementService({
        purchaseOutcome: 'error',
        purchaseErrorMessage: 'Mock store failed.',
      }),
    );

    const result = await useEntitlementStore.getState().purchaseFullGame();

    expect(result).toEqual({
      status: 'error',
      message: 'Mock store failed.',
    });
    expect(useEntitlementStore.getState()).toMatchObject({
      hasFullGame: false,
      cachedHasFullGame: false,
      status: 'error',
      notice: { kind: 'error', message: 'Mock store failed.' },
    });
  });

  test('restores a mock purchase and caches the unlock', async () => {
    await initializeEntitlements(
      new MockEntitlementService({ restoreOutcome: 'restored' }),
    );

    const result = await useEntitlementStore.getState().restorePurchases();

    expect(result).toEqual({ status: 'restored' });
    expect(useEntitlementStore.getState()).toMatchObject({
      hasFullGame: true,
      cachedHasFullGame: true,
      cacheSource: 'mock',
      status: 'ready',
      notice: {
        kind: 'success',
        message: 'Full Atelier purchase restored.',
      },
    });
  });

  test('locks access when a mock restore finds no purchase', async () => {
    await initializeEntitlements(
      new MockEntitlementService({
        initiallyUnlocked: true,
        restoreOutcome: 'not-found',
      }),
    );
    expect(useEntitlementStore.getState().hasFullGame).toBe(true);

    const result = await useEntitlementStore.getState().restorePurchases();

    expect(result).toEqual({ status: 'not-found' });
    expect(useEntitlementStore.getState()).toMatchObject({
      hasFullGame: false,
      cachedHasFullGame: false,
      cacheSource: 'mock',
      status: 'ready',
      notice: {
        kind: 'neutral',
        message: 'No Full Atelier purchase was found for this store account.',
      },
    });
  });

  test('preserves access when a mock restore fails', async () => {
    await initializeEntitlements(
      new MockEntitlementService({
        initiallyUnlocked: true,
        restoreOutcome: 'error',
        restoreErrorMessage: 'Mock restore failed.',
      }),
    );

    const result = await useEntitlementStore.getState().restorePurchases();

    expect(result).toEqual({
      status: 'error',
      message: 'Mock restore failed.',
    });
    expect(useEntitlementStore.getState()).toMatchObject({
      hasFullGame: true,
      cachedHasFullGame: true,
      status: 'error',
      notice: { kind: 'error', message: 'Mock restore failed.' },
    });
  });

  test('updates cached access from the active service subscription', async () => {
    const service = new MockEntitlementService();
    await initializeEntitlements(service);

    service.debugSetFullGame(true);

    expect(useEntitlementStore.getState()).toMatchObject({
      hasFullGame: true,
      cachedHasFullGame: true,
      cacheSource: 'mock',
    });
  });

  test('keeps the development override ephemeral and restores service state on AUTO', async () => {
    await initializeEntitlements(new MockEntitlementService());

    useEntitlementStore.getState().setDebugEntitlement(true);
    expect(selectHasFullGame(useEntitlementStore.getState())).toBe(true);
    expect(useEntitlementStore.getState()).toMatchObject({
      hasFullGame: false,
      cachedHasFullGame: false,
      debugOverride: true,
    });

    useEntitlementStore.getState().setDebugEntitlement(null);
    expect(selectHasFullGame(useEntitlementStore.getState())).toBe(false);
    expect(useEntitlementStore.getState().debugOverride).toBeNull();
  });

  test('preserves cached RevenueCat access when a refresh fails', async () => {
    await persistEntitlementCache(true, 'revenuecat');
    await useEntitlementStore.persist.rehydrate();
    const failingService: EntitlementService = {
      kind: 'revenuecat',
      initialize: async () => undefined,
      hasFullGame: async () => {
        throw new Error('Offline');
      },
      getFullGameOffer: async () => null,
      purchaseFullGame: async () => ({ status: 'purchased' }),
      restorePurchases: async () => ({ status: 'restored' }),
      subscribe: () => () => undefined,
    };

    await initializeEntitlements(failingService);

    expect(useEntitlementStore.getState()).toMatchObject({
      hasFullGame: true,
      cachedHasFullGame: true,
      cacheSource: 'revenuecat',
      verifiedAt: 123,
      serviceKind: 'revenuecat',
      status: 'error',
      notice: {
        kind: 'error',
        message:
          'Full Atelier could not be refreshed. Cached access remains unchanged.',
      },
    });
  });

  test('keeps cached RevenueCat access when production purchases are unavailable', async () => {
    await persistEntitlementCache(true, 'revenuecat');
    await useEntitlementStore.persist.rehydrate();

    await initializeEntitlements(createUnavailableService());

    expect(useEntitlementStore.getState()).toMatchObject({
      hasFullGame: true,
      cachedHasFullGame: true,
      cacheSource: 'revenuecat',
      verifiedAt: 123,
      serviceKind: 'unavailable',
      status: 'ready',
      offer: null,
      notice: {
        kind: 'neutral',
        message:
          'Purchases are unavailable in this build. Previously verified access remains available offline.',
      },
    });
  });
});
