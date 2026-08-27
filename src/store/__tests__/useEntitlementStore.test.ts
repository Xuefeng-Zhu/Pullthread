import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from '@jest/globals';

import type {
  EntitlementService,
  PurchaseResult,
  RestoreResult,
} from '../../services/entitlements/EntitlementService';
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

  test('does not let a locked development mock downgrade RevenueCat ownership', async () => {
    await persistEntitlementCache(true, 'revenuecat');
    await useEntitlementStore.persist.rehydrate();

    await initializeEntitlements(new MockEntitlementService());

    expect(useEntitlementStore.getState()).toMatchObject({
      hasFullGame: true,
      cachedHasFullGame: true,
      cacheSource: 'revenuecat',
      verifiedAt: 123,
      serviceKind: 'mock',
      status: 'ready',
    });
  });

  test('keeps RevenueCat cache evidence while mock state changes for the session', async () => {
    await persistEntitlementCache(false, 'revenuecat');
    await useEntitlementStore.persist.rehydrate();
    await initializeEntitlements(new MockEntitlementService());

    const result = await useEntitlementStore.getState().purchaseFullGame();

    expect(result).toEqual({ status: 'purchased' });
    expect(useEntitlementStore.getState()).toMatchObject({
      hasFullGame: true,
      cachedHasFullGame: false,
      cacheSource: 'revenuecat',
      verifiedAt: 123,
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

  test('shares one in-flight purchase across rapid calls', async () => {
    let purchaseCalls = 0;
    let restoreCalls = 0;
    let resolvePurchase!: (result: PurchaseResult) => void;
    let markPurchaseStarted!: () => void;
    const purchaseStarted = new Promise<void>((resolve) => {
      markPurchaseStarted = resolve;
    });
    const purchaseResult = new Promise<PurchaseResult>((resolve) => {
      resolvePurchase = resolve;
    });
    const listenerRef: {
      current: ((hasFullGame: boolean) => void) | null;
    } = { current: null };
    const service: EntitlementService = {
      kind: 'revenuecat',
      initialize: async () => undefined,
      hasFullGame: async () => false,
      getFullGameOffer: async () => null,
      purchaseFullGame: () => {
        purchaseCalls += 1;
        markPurchaseStarted();
        return purchaseResult;
      },
      restorePurchases: async () => {
        restoreCalls += 1;
        return { status: 'not-found' };
      },
      subscribe: (listener) => {
        listenerRef.current = listener;
        return () => {
          listenerRef.current = null;
        };
      },
    };

    await initializeEntitlements(service);

    const firstPurchase = useEntitlementStore.getState().purchaseFullGame();
    const secondPurchase = useEntitlementStore.getState().purchaseFullGame();

    expect(secondPurchase).toBe(firstPurchase);
    await purchaseStarted;
    expect(purchaseCalls).toBe(1);
    expect(useEntitlementStore.getState().status).toBe('purchasing');

    listenerRef.current?.(true);
    expect(useEntitlementStore.getState()).toMatchObject({
      hasFullGame: true,
      cachedHasFullGame: true,
      status: 'purchasing',
      notice: null,
    });

    const thirdPurchase = useEntitlementStore.getState().purchaseFullGame();
    expect(thirdPurchase).toBe(firstPurchase);
    expect(purchaseCalls).toBe(1);
    await expect(
      useEntitlementStore.getState().restorePurchases(),
    ).resolves.toEqual({
      status: 'error',
      message: 'Another Full Atelier store operation is already in progress.',
    });
    expect(restoreCalls).toBe(0);

    // The latest listener snapshot wins even when ownership changed away and
    // back to the operation's starting value before the SDK result arrives.
    listenerRef.current?.(false);
    resolvePurchase({ status: 'purchased' });
    await expect(
      Promise.all([firstPurchase, secondPurchase, thirdPurchase]),
    ).resolves.toEqual([
      { status: 'purchased' },
      { status: 'purchased' },
      { status: 'purchased' },
    ]);
    expect(useEntitlementStore.getState()).toMatchObject({
      hasFullGame: false,
      cachedHasFullGame: false,
      status: 'ready',
      notice: null,
    });

    const laterPurchase = useEntitlementStore.getState().purchaseFullGame();
    expect(laterPurchase).not.toBe(firstPurchase);
    await expect(laterPurchase).resolves.toEqual({ status: 'purchased' });
    expect(purchaseCalls).toBe(2);
  });

  test('coalesces restores and prevents a purchase from overlapping them', async () => {
    let restoreCalls = 0;
    let purchaseCalls = 0;
    let resolveRestore!: (result: RestoreResult) => void;
    let markRestoreStarted!: () => void;
    const restoreStarted = new Promise<void>((resolve) => {
      markRestoreStarted = resolve;
    });
    const restoreResult = new Promise<RestoreResult>((resolve) => {
      resolveRestore = resolve;
    });
    const listenerRef: {
      current: ((hasFullGame: boolean) => void) | null;
    } = { current: null };
    const service: EntitlementService = {
      kind: 'revenuecat',
      initialize: async () => undefined,
      hasFullGame: async () => false,
      getFullGameOffer: async () => null,
      purchaseFullGame: async () => {
        purchaseCalls += 1;
        return { status: 'purchased' };
      },
      restorePurchases: () => {
        restoreCalls += 1;
        markRestoreStarted();
        return restoreResult;
      },
      subscribe: (listener) => {
        listenerRef.current = listener;
        return () => {
          listenerRef.current = null;
        };
      },
    };

    await initializeEntitlements(service);

    const firstRestore = useEntitlementStore.getState().restorePurchases();
    const secondRestore = useEntitlementStore.getState().restorePurchases();
    expect(secondRestore).toBe(firstRestore);
    await restoreStarted;
    expect(restoreCalls).toBe(1);

    await expect(
      useEntitlementStore.getState().purchaseFullGame(),
    ).resolves.toEqual({
      status: 'error',
      message: 'Another Full Atelier store operation is already in progress.',
    });
    expect(purchaseCalls).toBe(0);
    expect(useEntitlementStore.getState().status).toBe('restoring');

    listenerRef.current?.(true);
    expect(useEntitlementStore.getState()).toMatchObject({
      hasFullGame: true,
      status: 'restoring',
      notice: null,
    });

    // The later restore snapshot must not overwrite the newer listener update.
    resolveRestore({ status: 'not-found' });
    await expect(Promise.all([firstRestore, secondRestore])).resolves.toEqual([
      { status: 'not-found' },
      { status: 'not-found' },
    ]);
    expect(useEntitlementStore.getState()).toMatchObject({
      hasFullGame: true,
      status: 'ready',
      notice: null,
    });

    await expect(
      useEntitlementStore.getState().purchaseFullGame(),
    ).resolves.toEqual({ status: 'purchased' });
    expect(purchaseCalls).toBe(1);
  });

  test('ignores a late purchase result from a superseded service', async () => {
    let resolvePurchase!: (result: PurchaseResult) => void;
    let markPurchaseStarted!: () => void;
    const purchaseStarted = new Promise<void>((resolve) => {
      markPurchaseStarted = resolve;
    });
    const purchaseResult = new Promise<PurchaseResult>((resolve) => {
      resolvePurchase = resolve;
    });
    const firstService: EntitlementService = {
      kind: 'revenuecat',
      initialize: async () => undefined,
      hasFullGame: async () => false,
      getFullGameOffer: async () => null,
      purchaseFullGame: () => {
        markPurchaseStarted();
        return purchaseResult;
      },
      restorePurchases: async () => ({ status: 'not-found' }),
      subscribe: () => () => undefined,
    };
    const secondService: EntitlementService = {
      ...firstService,
      purchaseFullGame: async () => ({ status: 'purchased' }),
    };

    await initializeEntitlements(firstService);
    const pendingPurchase = useEntitlementStore
      .getState()
      .purchaseFullGame();
    await purchaseStarted;
    await initializeEntitlements(secondService);

    resolvePurchase({ status: 'purchased' });
    await expect(pendingPurchase).resolves.toEqual({ status: 'purchased' });

    expect(useEntitlementStore.getState()).toMatchObject({
      hasFullGame: false,
      cachedHasFullGame: false,
      cacheSource: 'revenuecat',
      serviceKind: 'revenuecat',
      status: 'ready',
      notice: null,
    });
  });

  test('lets replacement commerce proceed when prior cleanup and purchase are stuck', async () => {
    let resolveFirstPurchase!: (result: PurchaseResult) => void;
    let markFirstPurchaseStarted!: () => void;
    const firstPurchaseStarted = new Promise<void>((resolve) => {
      markFirstPurchaseStarted = resolve;
    });
    const firstPurchaseResult = new Promise<PurchaseResult>((resolve) => {
      resolveFirstPurchase = resolve;
    });
    const firstService: EntitlementService = {
      kind: 'revenuecat',
      initialize: async () => undefined,
      hasFullGame: async () => false,
      getFullGameOffer: async () => null,
      purchaseFullGame: () => {
        markFirstPurchaseStarted();
        return firstPurchaseResult;
      },
      restorePurchases: async () => ({ status: 'not-found' }),
      subscribe: () => () => {
        throw new Error('Native listener cleanup failed');
      },
    };
    let replacementPurchaseCalls = 0;
    const replacementService: EntitlementService = {
      ...firstService,
      purchaseFullGame: async () => {
        replacementPurchaseCalls += 1;
        return { status: 'purchased' };
      },
      subscribe: () => () => undefined,
    };

    await initializeEntitlements(firstService);
    const oldPurchase = useEntitlementStore.getState().purchaseFullGame();
    await firstPurchaseStarted;

    await expect(
      initializeEntitlements(replacementService),
    ).resolves.toBeUndefined();
    await expect(
      useEntitlementStore.getState().purchaseFullGame(),
    ).resolves.toEqual({ status: 'purchased' });
    expect(replacementPurchaseCalls).toBe(1);

    resolveFirstPurchase({ status: 'cancelled' });
    await expect(oldPurchase).resolves.toEqual({ status: 'cancelled' });
    expect(useEntitlementStore.getState()).toMatchObject({
      hasFullGame: true,
      cachedHasFullGame: true,
      status: 'ready',
      notice: {
        kind: 'success',
        message: 'Full Atelier is unlocked on this device.',
      },
    });
  });

  test('fences a reentrant old listener during throwing native cleanup', async () => {
    let firstListener: ((hasFullGame: boolean) => void) | null = null;
    const firstService: EntitlementService = {
      kind: 'revenuecat',
      initialize: async () => undefined,
      hasFullGame: async () => false,
      getFullGameOffer: async () => null,
      purchaseFullGame: async () => ({ status: 'purchased' }),
      restorePurchases: async () => ({ status: 'not-found' }),
      subscribe: (listener) => {
        firstListener = listener;
        return () => {
          firstListener?.(true);
          throw new Error('Native listener cleanup failed');
        };
      },
    };
    let finishReplacement!: () => void;
    const replacementInitialization = new Promise<void>((resolve) => {
      finishReplacement = resolve;
    });
    const replacementService: EntitlementService = {
      ...firstService,
      initialize: () => replacementInitialization,
      subscribe: () => () => undefined,
    };

    await initializeEntitlements(firstService);
    const pendingReplacement = initializeEntitlements(replacementService);

    expect(useEntitlementStore.getState()).toMatchObject({
      hasFullGame: false,
      cachedHasFullGame: false,
      status: 'refreshing',
      serviceKind: 'revenuecat',
    });

    finishReplacement();
    await pendingReplacement;
    expect(useEntitlementStore.getState()).toMatchObject({
      hasFullGame: false,
      cachedHasFullGame: false,
      status: 'ready',
    });
  });

  test('does not migrate commerce waiting on refresh to a replacement service', async () => {
    let entitlementChecks = 0;
    let markRefreshStarted!: () => void;
    let resolveRefresh!: (hasFullGame: boolean) => void;
    const refreshStarted = new Promise<void>((resolve) => {
      markRefreshStarted = resolve;
    });
    const refreshResult = new Promise<boolean>((resolve) => {
      resolveRefresh = resolve;
    });
    const firstService: EntitlementService = {
      kind: 'revenuecat',
      initialize: async () => undefined,
      hasFullGame: () => {
        entitlementChecks += 1;
        if (entitlementChecks === 1) return Promise.resolve(false);
        markRefreshStarted();
        return refreshResult;
      },
      getFullGameOffer: async () => null,
      purchaseFullGame: async () => ({ status: 'purchased' }),
      restorePurchases: async () => ({ status: 'not-found' }),
      subscribe: () => () => undefined,
    };
    let replacementPurchaseCalls = 0;
    const replacementService: EntitlementService = {
      ...firstService,
      hasFullGame: async () => false,
      purchaseFullGame: async () => {
        replacementPurchaseCalls += 1;
        return { status: 'purchased' };
      },
    };

    await initializeEntitlements(firstService);
    const oldRefresh = useEntitlementStore.getState().refreshEntitlement();
    await refreshStarted;
    const oldPurchase = useEntitlementStore.getState().purchaseFullGame();

    await initializeEntitlements(replacementService);
    await expect(
      useEntitlementStore.getState().purchaseFullGame(),
    ).resolves.toEqual({ status: 'purchased' });

    resolveRefresh(false);
    await oldRefresh;
    await expect(oldPurchase).resolves.toEqual({
      status: 'error',
      message: 'Another Full Atelier store operation is already in progress.',
    });
    expect(replacementPurchaseCalls).toBe(1);
    expect(useEntitlementStore.getState()).toMatchObject({
      hasFullGame: true,
      status: 'ready',
      notice: {
        kind: 'success',
        message: 'Full Atelier is unlocked on this device.',
      },
    });
  });

  test('coalesces refreshes and orders commerce after a newer listener snapshot', async () => {
    let entitlementChecks = 0;
    let purchaseCalls = 0;
    let resolveRefresh!: (hasFullGame: boolean) => void;
    let markRefreshStarted!: () => void;
    const refreshStarted = new Promise<void>((resolve) => {
      markRefreshStarted = resolve;
    });
    const refreshResult = new Promise<boolean>((resolve) => {
      resolveRefresh = resolve;
    });
    const listenerRef: {
      current: ((hasFullGame: boolean) => void) | null;
    } = { current: null };
    const service: EntitlementService = {
      kind: 'revenuecat',
      initialize: async () => undefined,
      hasFullGame: () => {
        entitlementChecks += 1;
        if (entitlementChecks === 1) return Promise.resolve(false);
        markRefreshStarted();
        return refreshResult;
      },
      getFullGameOffer: async () => null,
      purchaseFullGame: async () => {
        purchaseCalls += 1;
        return { status: 'purchased' };
      },
      restorePurchases: async () => ({ status: 'not-found' }),
      subscribe: (listener) => {
        listenerRef.current = listener;
        return () => {
          listenerRef.current = null;
        };
      },
    };

    await initializeEntitlements(service);
    const firstRefresh = useEntitlementStore.getState().refreshEntitlement();
    const secondRefresh = useEntitlementStore.getState().refreshEntitlement();
    expect(secondRefresh).toBe(firstRefresh);
    await refreshStarted;

    const purchase = useEntitlementStore.getState().purchaseFullGame();
    expect(purchaseCalls).toBe(0);
    expect(useEntitlementStore.getState().status).toBe('refreshing');

    // Even the same boolean is a newer authoritative snapshot than the
    // outstanding query, so its stale `true` result must not be committed.
    listenerRef.current?.(false);
    resolveRefresh(true);
    await Promise.all([firstRefresh, secondRefresh]);
    await expect(purchase).resolves.toEqual({ status: 'purchased' });

    expect(entitlementChecks).toBe(2);
    expect(purchaseCalls).toBe(1);
    expect(useEntitlementStore.getState()).toMatchObject({
      hasFullGame: true,
      cachedHasFullGame: true,
      status: 'ready',
      notice: {
        kind: 'success',
        message: 'Full Atelier is unlocked on this device.',
      },
    });
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

  test('keeps commerce feedback after a same-value listener snapshot', async () => {
    let listenerRef: ((hasFullGame: boolean) => void) | null = null;
    const service: EntitlementService = {
      kind: 'revenuecat',
      initialize: async () => undefined,
      hasFullGame: async () => false,
      getFullGameOffer: async () => null,
      purchaseFullGame: async () => {
        listenerRef?.(false);
        return { status: 'cancelled' };
      },
      restorePurchases: async () => {
        listenerRef?.(false);
        return { status: 'error', message: 'Restore stayed offline.' };
      },
      subscribe: (listener) => {
        listenerRef = listener;
        return () => {
          listenerRef = null;
        };
      },
    };

    await initializeEntitlements(service);
    await expect(
      useEntitlementStore.getState().purchaseFullGame(),
    ).resolves.toEqual({ status: 'cancelled' });
    expect(useEntitlementStore.getState()).toMatchObject({
      hasFullGame: false,
      status: 'ready',
      notice: {
        kind: 'neutral',
        message: 'Purchase cancelled. Nothing was charged.',
      },
    });

    await expect(
      useEntitlementStore.getState().restorePurchases(),
    ).resolves.toEqual({
      status: 'error',
      message: 'Restore stayed offline.',
    });
    expect(useEntitlementStore.getState()).toMatchObject({
      hasFullGame: false,
      status: 'error',
      notice: { kind: 'error', message: 'Restore stayed offline.' },
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

  test('normalizes stale success and error UI when the listener changes access', async () => {
    const listenerRef: {
      current: ((hasFullGame: boolean) => void) | null;
    } = { current: null };
    const service: EntitlementService = {
      kind: 'revenuecat',
      initialize: async () => undefined,
      hasFullGame: async () => false,
      getFullGameOffer: async () => null,
      purchaseFullGame: async () => ({ status: 'purchased' }),
      restorePurchases: async () => ({ status: 'not-found' }),
      subscribe: (listener) => {
        listenerRef.current = listener;
        return () => {
          listenerRef.current = null;
        };
      },
    };

    await initializeEntitlements(service);

    useEntitlementStore.setState({
      hasFullGame: true,
      cachedHasFullGame: true,
      status: 'ready',
      notice: {
        kind: 'success',
        message: 'Full Atelier purchase restored.',
      },
    });
    listenerRef.current?.(false);
    expect(useEntitlementStore.getState()).toMatchObject({
      hasFullGame: false,
      cachedHasFullGame: false,
      status: 'ready',
      notice: null,
    });

    useEntitlementStore.setState({
      status: 'error',
      notice: { kind: 'error', message: 'Store temporarily unavailable.' },
    });
    listenerRef.current?.(true);
    expect(useEntitlementStore.getState()).toMatchObject({
      hasFullGame: true,
      cachedHasFullGame: true,
      status: 'ready',
      notice: null,
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

  test('retries failed initialization and restores one active listener', async () => {
    let initializeAttempts = 0;
    let subscriptionCount = 0;
    const listenerRef: {
      current: ((hasFullGame: boolean) => void) | null;
    } = { current: null };
    const recoveringService: EntitlementService = {
      kind: 'revenuecat',
      initialize: async () => {
        initializeAttempts += 1;
        if (initializeAttempts === 1) throw new Error('Temporarily offline');
      },
      hasFullGame: async () => true,
      getFullGameOffer: async () => null,
      purchaseFullGame: async () => ({ status: 'purchased' }),
      restorePurchases: async () => ({ status: 'restored' }),
      subscribe: (listener) => {
        subscriptionCount += 1;
        listenerRef.current = listener;
        return () => {
          listenerRef.current = null;
        };
      },
    };

    await initializeEntitlements(recoveringService);
    expect(useEntitlementStore.getState().status).toBe('error');
    expect(subscriptionCount).toBe(0);

    await Promise.all([
      useEntitlementStore.getState().refreshEntitlement(),
      useEntitlementStore.getState().refreshEntitlement(),
    ]);
    expect(useEntitlementStore.getState().status).toBe('ready');
    expect(initializeAttempts).toBe(2);
    expect(subscriptionCount).toBe(1);
    expect(listenerRef.current).not.toBeNull();

    listenerRef.current?.(false);
    expect(useEntitlementStore.getState()).toMatchObject({
      hasFullGame: false,
      cachedHasFullGame: false,
      cacheSource: 'revenuecat',
    });

    await useEntitlementStore.getState().refreshEntitlement();
    expect(subscriptionCount).toBe(1);
  });

  test('retains one listener when entitlement refresh fails after subscribing', async () => {
    let initializeAttempts = 0;
    let entitlementChecks = 0;
    let subscriptionCount = 0;
    const service: EntitlementService = {
      kind: 'revenuecat',
      initialize: async () => {
        initializeAttempts += 1;
      },
      hasFullGame: async () => {
        entitlementChecks += 1;
        if (entitlementChecks === 1) throw new Error('Temporarily offline');
        return false;
      },
      getFullGameOffer: async () => null,
      purchaseFullGame: async () => ({ status: 'purchased' }),
      restorePurchases: async () => ({ status: 'restored' }),
      subscribe: () => {
        subscriptionCount += 1;
        return () => undefined;
      },
    };

    await initializeEntitlements(service);
    expect(useEntitlementStore.getState().status).toBe('error');
    expect(subscriptionCount).toBe(1);

    await Promise.all([
      useEntitlementStore.getState().refreshEntitlement(),
      useEntitlementStore.getState().refreshEntitlement(),
    ]);

    expect(useEntitlementStore.getState().status).toBe('ready');
    expect(initializeAttempts).toBe(1);
    expect(subscriptionCount).toBe(1);
  });

  test('does not report recovery when a full initialization retry also fails', async () => {
    let initializeAttempts = 0;
    let entitlementChecks = 0;
    let subscriptionCount = 0;
    const service: EntitlementService = {
      kind: 'revenuecat',
      initialize: async () => {
        initializeAttempts += 1;
        if (initializeAttempts < 3) throw new Error('Temporarily offline');
      },
      hasFullGame: async () => {
        entitlementChecks += 1;
        return false;
      },
      getFullGameOffer: async () => null,
      purchaseFullGame: async () => ({ status: 'purchased' }),
      restorePurchases: async () => ({ status: 'restored' }),
      subscribe: () => {
        subscriptionCount += 1;
        return () => undefined;
      },
    };

    await initializeEntitlements(service);
    await useEntitlementStore.getState().refreshEntitlement();

    expect(useEntitlementStore.getState().status).toBe('error');
    expect(initializeAttempts).toBe(2);
    expect(entitlementChecks).toBe(0);
    expect(subscriptionCount).toBe(0);

    await useEntitlementStore.getState().refreshEntitlement();

    expect(useEntitlementStore.getState().status).toBe('ready');
    expect(initializeAttempts).toBe(3);
    expect(subscriptionCount).toBe(1);
    expect(entitlementChecks).toBe(2);
  });

  test('does not purchase or restore until initialization installs a listener', async () => {
    let initializeAttempts = 0;
    let purchaseCalls = 0;
    let restoreCalls = 0;
    const service: EntitlementService = {
      kind: 'revenuecat',
      initialize: async () => {
        initializeAttempts += 1;
        throw new Error('Temporarily offline');
      },
      hasFullGame: async () => false,
      getFullGameOffer: async () => null,
      purchaseFullGame: async () => {
        purchaseCalls += 1;
        return { status: 'purchased' };
      },
      restorePurchases: async () => {
        restoreCalls += 1;
        return { status: 'restored' };
      },
      subscribe: () => () => undefined,
    };

    await initializeEntitlements(service);
    await expect(
      useEntitlementStore.getState().purchaseFullGame(),
    ).resolves.toEqual({
      status: 'error',
      message:
        'Full Atelier could not be refreshed. Cached access remains unchanged.',
    });
    await expect(
      useEntitlementStore.getState().restorePurchases(),
    ).resolves.toEqual({
      status: 'error',
      message:
        'Full Atelier could not be refreshed. Cached access remains unchanged.',
    });

    expect(initializeAttempts).toBe(3);
    expect(purchaseCalls).toBe(0);
    expect(restoreCalls).toBe(0);
    expect(useEntitlementStore.getState().status).toBe('error');
  });

  test('does not subscribe a service superseded during initialization', async () => {
    const deferred = () => {
      let resolve!: () => void;
      const promise = new Promise<void>((complete) => {
        resolve = complete;
      });
      return { promise, resolve };
    };
    const firstInitialization = deferred();
    const secondInitialization = deferred();
    let firstSubscriptions = 0;
    let secondInitializeAttempts = 0;
    let secondSubscriptions = 0;
    const firstService: EntitlementService = {
      kind: 'revenuecat',
      initialize: () => firstInitialization.promise,
      hasFullGame: async () => false,
      getFullGameOffer: async () => null,
      purchaseFullGame: async () => ({ status: 'purchased' }),
      restorePurchases: async () => ({ status: 'restored' }),
      subscribe: () => {
        firstSubscriptions += 1;
        return () => undefined;
      },
    };
    const secondService: EntitlementService = {
      kind: 'revenuecat',
      initialize: () => {
        secondInitializeAttempts += 1;
        return secondInitialization.promise;
      },
      hasFullGame: async () => false,
      getFullGameOffer: async () => null,
      purchaseFullGame: async () => ({ status: 'purchased' }),
      restorePurchases: async () => ({ status: 'restored' }),
      subscribe: () => {
        secondSubscriptions += 1;
        return () => undefined;
      },
    };

    const firstPending = initializeEntitlements(firstService);
    const secondPending = initializeEntitlements(secondService);
    firstInitialization.resolve();
    await firstPending;

    const coalescedSecondPending = initializeEntitlements(secondService);
    expect(secondInitializeAttempts).toBe(1);
    secondInitialization.resolve();
    await Promise.all([secondPending, coalescedSecondPending]);

    expect(firstSubscriptions).toBe(0);
    expect(secondSubscriptions).toBe(1);
    expect(useEntitlementStore.getState()).toMatchObject({
      serviceKind: 'revenuecat',
      status: 'ready',
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
