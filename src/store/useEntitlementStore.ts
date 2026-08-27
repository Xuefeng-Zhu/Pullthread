import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import {
  createJSONStorage,
  persist,
  type StateStorage,
} from 'zustand/middleware';

import {
  createEntitlementService,
} from '../services/entitlements/createEntitlementService';
import type {
  EntitlementService,
  EntitlementServiceKind,
  FullGameOffer,
  PurchaseResult,
  RestoreResult,
} from '../services/entitlements/EntitlementService';

export const ENTITLEMENT_STORAGE_KEY = 'pullthread.entitlement';
export const ENTITLEMENT_STORAGE_VERSION = 1;

const ENTITLEMENT_REFRESH_ERROR_MESSAGE =
  'Full Atelier could not be refreshed. Cached access remains unchanged.';

export type EntitlementCacheSource = 'mock' | 'revenuecat';
export type EntitlementStatus =
  | 'idle'
  | 'refreshing'
  | 'ready'
  | 'purchasing'
  | 'restoring'
  | 'error';

export interface EntitlementNotice {
  readonly kind: 'success' | 'neutral' | 'error';
  readonly message: string;
}

export interface PersistedEntitlementState {
  readonly cachedHasFullGame: boolean;
  readonly cacheSource: EntitlementCacheSource | null;
  readonly verifiedAt: number | null;
}

export interface EntitlementStore extends PersistedEntitlementState {
  /** Last entitlement value accepted for the active runtime service. */
  readonly hasFullGame: boolean;
  readonly serviceKind: EntitlementServiceKind | null;
  readonly status: EntitlementStatus;
  readonly offer: FullGameOffer | null;
  readonly notice: EntitlementNotice | null;
  /** Development-only access override. It is deliberately not persisted. */
  readonly debugOverride: boolean | null;
  readonly purchaseFullGame: () => Promise<PurchaseResult>;
  readonly restorePurchases: () => Promise<RestoreResult>;
  readonly refreshEntitlement: () => Promise<void>;
  readonly setDebugEntitlement: (hasFullGame: boolean | null) => void;
  readonly clearNotice: () => void;
}

export const defaultPersistedEntitlementState: PersistedEntitlementState = {
  cachedHasFullGame: false,
  cacheSource: null,
  verifiedAt: null,
};

const failSoftEntitlementStorage: StateStorage = {
  getItem: async (name) => {
    try {
      return await AsyncStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: async (name, value) => {
    try {
      await AsyncStorage.setItem(name, value);
    } catch {
      // The verified entitlement remains active in memory for this session.
    }
  },
  removeItem: async (name) => {
    try {
      await AsyncStorage.removeItem(name);
    } catch {
      // Clearing the local cache is best-effort outside test cleanup.
    }
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function sanitizeEntitlementState(
  value: unknown,
): PersistedEntitlementState {
  const source = isRecord(value) ? value : {};
  const parsedCacheSource =
    source.cacheSource === 'mock' || source.cacheSource === 'revenuecat'
      ? source.cacheSource
      : null;
  const parsedVerifiedAt =
    typeof source.verifiedAt === 'number' &&
    Number.isSafeInteger(source.verifiedAt) &&
    source.verifiedAt >= 0
      ? source.verifiedAt
      : null;
  const cacheSource =
    parsedCacheSource !== null && parsedVerifiedAt !== null
      ? parsedCacheSource
      : null;
  const verifiedAt = cacheSource === null ? null : parsedVerifiedAt;
  const cachedHasFullGame =
    cacheSource !== null && source.cachedHasFullGame === true;

  return { cachedHasFullGame, cacheSource, verifiedAt };
}

function persistedEntitlementState(
  state: EntitlementStore,
): PersistedEntitlementState {
  return {
    cachedHasFullGame: state.cachedHasFullGame,
    cacheSource: state.cacheSource,
    verifiedAt: state.verifiedAt,
  };
}

function cacheSourceFor(
  service: EntitlementService,
): EntitlementCacheSource | null {
  return service.kind === 'mock' || service.kind === 'revenuecat'
    ? service.kind
    : null;
}

function unavailableResult(
  message: string,
): Extract<PurchaseResult, { readonly status: 'error' }> {
  return { status: 'error', message };
}

type CommerceOperation =
  | Readonly<{
      kind: 'purchase';
      token: symbol;
      promise: Promise<PurchaseResult>;
    }>
  | Readonly<{
      kind: 'restore';
      token: symbol;
      promise: Promise<RestoreResult>;
    }>;

const STORE_OPERATION_BUSY_MESSAGE =
  'Another Full Atelier store operation is already in progress.';
const PURCHASE_ERROR_MESSAGE =
  'Full Atelier could not be purchased. Please try again.';
const RESTORE_ERROR_MESSAGE =
  'Full Atelier purchases could not be restored. Please try again.';

let activeService: EntitlementService | null = null;
let defaultService: EntitlementService | null = null;
let serviceUnsubscribe: (() => void) | null = null;
let initializationPromise: Promise<void> | null = null;
let hydrationPromise: Promise<void> | null = null;
let commerceOperation: CommerceOperation | null = null;
let refreshPromise: Promise<void> | null = null;
let activeServiceGeneration = 0;
let entitlementRevision = 0;

function runtimeService(): EntitlementService {
  if (!defaultService) defaultService = createEntitlementService();
  return defaultService;
}

function isActiveService(
  service: EntitlementService,
  generation: number,
): boolean {
  return activeService === service && activeServiceGeneration === generation;
}

function isTransientStatus(status: EntitlementStatus): boolean {
  return (
    status === 'refreshing' ||
    status === 'purchasing' ||
    status === 'restoring'
  );
}

function commitVerifiedEntitlement(
  service: EntitlementService,
  hasFullGame: boolean,
): void {
  const cacheSource = cacheSourceFor(service);
  if (!cacheSource) return;

  const current = useEntitlementStore.getState();
  if (cacheSource === 'mock' && current.cacheSource === 'revenuecat') {
    // A development fallback is weaker evidence than a persisted store
    // verification. Keep the RevenueCat cache intact, and never let a locked
    // mock revoke purchased access while store configuration is unavailable.
    useEntitlementStore.setState({
      hasFullGame: current.cachedHasFullGame || hasFullGame,
    });
    return;
  }

  useEntitlementStore.setState({
    hasFullGame,
    cachedHasFullGame: hasFullGame,
    cacheSource,
    verifiedAt: Date.now(),
  });
}

async function refreshOffer(
  service: EntitlementService,
  generation: number,
): Promise<void> {
  try {
    const offer = await service.getFullGameOffer();
    if (isActiveService(service, generation)) {
      useEntitlementStore.setState({ offer });
    }
  } catch {
    if (isActiveService(service, generation)) {
      useEntitlementStore.setState({ offer: null });
    }
  }
}

export async function initializeEntitlements(
  service: EntitlementService = runtimeService(),
): Promise<void> {
  if (activeService === service && initializationPromise) {
    return initializationPromise;
  }
  if (activeService === service) {
    const status = useEntitlementStore.getState().status;
    const needsFullRetry =
      service.kind !== 'unavailable' &&
      status === 'error' &&
      serviceUnsubscribe === null;
    if (status !== 'idle' && !needsFullRetry) return;
  }

  const replacingService = activeService !== null && activeService !== service;
  if (replacingService) {
    // An operation belongs to the service generation that started it. Its
    // eventual completion is ignored by generation checks and must not block
    // commerce or refreshes on the replacement service.
    commerceOperation = null;
    refreshPromise = null;
  }

  const previousUnsubscribe = serviceUnsubscribe;
  serviceUnsubscribe = null;
  activeService = service;
  const serviceGeneration = ++activeServiceGeneration;
  try {
    previousUnsubscribe?.();
  } catch {
    // A native listener cleanup failure must not strand service replacement.
    // The old callback is also fenced by service identity and generation.
  }
  useEntitlementStore.setState({
    serviceKind: service.kind,
    status: 'refreshing',
    notice: null,
  });

  const pendingInitialization = (async () => {
    const state = useEntitlementStore.getState();
    if (
      service.kind === 'mock' &&
      state.cacheSource === 'mock' &&
      service.debugSetFullGame
    ) {
      service.debugSetFullGame(state.cachedHasFullGame);
    }

    if (service.kind === 'unavailable') {
      useEntitlementStore.setState({
        status: 'ready',
        offer: null,
        notice: {
          kind: 'neutral',
          message:
            'Purchases are unavailable in this build. Previously verified access remains available offline.',
        },
      });
      return;
    }

    try {
      await service.initialize();
      if (!isActiveService(service, serviceGeneration)) return;
      const verificationRevision = entitlementRevision;
      serviceUnsubscribe = service.subscribe((hasFullGame) => {
        if (isActiveService(service, serviceGeneration)) {
          const previous = useEntitlementStore.getState();
          commitVerifiedEntitlement(service, hasFullGame);
          const accepted = useEntitlementStore.getState();
          const accessChanged = previous.hasFullGame !== accepted.hasFullGame;
          // Every accepted callback is a newer authoritative snapshot, even
          // when it repeats the current boolean value.
          entitlementRevision += 1;

          // A listener is authoritative for access, but it must not make a
          // still-running purchase/restore/refresh appear finished. Stable
          // stale success/error UI is normalized immediately.
          if (
            !isTransientStatus(previous.status) &&
            (accessChanged || previous.status === 'error')
          ) {
            useEntitlementStore.setState({ status: 'ready', notice: null });
          }
        }
      });
      const hasFullGame = await service.hasFullGame();
      if (!isActiveService(service, serviceGeneration)) return;
      if (entitlementRevision === verificationRevision) {
        commitVerifiedEntitlement(service, hasFullGame);
      }
      await refreshOffer(service, serviceGeneration);
      if (isActiveService(service, serviceGeneration)) {
        useEntitlementStore.setState({ status: 'ready', notice: null });
      }
    } catch {
      if (isActiveService(service, serviceGeneration)) {
        useEntitlementStore.setState({
          status: 'error',
          notice: {
            kind: 'error',
            message: ENTITLEMENT_REFRESH_ERROR_MESSAGE,
          },
        });
      }
    }
  })().finally(() => {
    // An older service can finish after a replacement starts. It must not
    // clear the replacement's in-flight initialization guard.
    if (initializationPromise === pendingInitialization) {
      initializationPromise = null;
    }
  });

  initializationPromise = pendingInitialization;

  return initializationPromise;
}

async function ensureService(): Promise<EntitlementService | null> {
  const service = activeService ?? runtimeService();
  await initializeEntitlements(service);

  if (service.kind === 'unavailable') return service;
  return activeService === service && serviceUnsubscribe !== null
    ? service
    : null;
}

export const useEntitlementStore = create<EntitlementStore>()(
  persist<EntitlementStore, [], [], PersistedEntitlementState>(
    (set) => ({
      ...defaultPersistedEntitlementState,
      hasFullGame: false,
      serviceKind: null,
      status: 'idle',
      offer: null,
      notice: null,
      debugOverride: null,

      purchaseFullGame: () => {
        if (commerceOperation?.kind === 'purchase') {
          return commerceOperation.promise;
        }
        if (commerceOperation) {
          return Promise.resolve(
            unavailableResult(STORE_OPERATION_BUSY_MESSAGE),
          );
        }

        const operationToken = Symbol('purchase');
        const purchase = (async (): Promise<PurchaseResult> => {
          // Yield once so the operation record below is installed before any
          // token check, while still claiming the action synchronously for the
          // caller and any rapid follow-up tap.
          await Promise.resolve();
          const pendingRefresh = refreshPromise;
          if (pendingRefresh) await pendingRefresh;
          if (
            commerceOperation?.kind !== 'purchase' ||
            commerceOperation.token !== operationToken
          ) {
            return unavailableResult(STORE_OPERATION_BUSY_MESSAGE);
          }
          const service = await ensureService();
          if (!service) {
            return unavailableResult(ENTITLEMENT_REFRESH_ERROR_MESSAGE);
          }
          if (
            commerceOperation?.kind !== 'purchase' ||
            commerceOperation.token !== operationToken
          ) {
            return unavailableResult(STORE_OPERATION_BUSY_MESSAGE);
          }
          const serviceGeneration = activeServiceGeneration;
          if (service.kind === 'unavailable') {
            const result = unavailableResult(
              'Full Atelier purchases are unavailable in this build.',
            );
            if (isActiveService(service, serviceGeneration)) {
              set({
                status: 'error',
                notice: { kind: 'error', message: result.message },
              });
            }
            return result;
          }

          set({ status: 'purchasing', notice: null });
          const operationRevision = entitlementRevision;
          const operationStartAccess = useEntitlementStore.getState().hasFullGame;
          let result: PurchaseResult;
          try {
            result = await service.purchaseFullGame();
          } catch {
            result = unavailableResult(PURCHASE_ERROR_MESSAGE);
          }
          if (!isActiveService(service, serviceGeneration)) return result;
          const expectedAccess = result.status === 'purchased' ? true : null;
          const currentAccess = useEntitlementStore.getState().hasFullGame;
          if (
            entitlementRevision !== operationRevision &&
            (expectedAccess === null
              ? currentAccess !== operationStartAccess
              : currentAccess !== expectedAccess)
          ) {
            set({ status: 'ready', notice: null });
            return result;
          }

          switch (result.status) {
            case 'purchased':
              commitVerifiedEntitlement(service, true);
              set({
                status: 'ready',
                notice: {
                  kind: 'success',
                  message: 'Full Atelier is unlocked on this device.',
                },
              });
              break;
            case 'cancelled':
              set({
                status: 'ready',
                notice: {
                  kind: 'neutral',
                  message: 'Purchase cancelled. Nothing was charged.',
                },
              });
              break;
            case 'error':
              set({
                status: 'error',
                notice: { kind: 'error', message: result.message },
              });
              break;
          }
          return result;
        });

        const pendingPurchase = purchase().finally(() => {
          if (
            commerceOperation?.kind === 'purchase' &&
            commerceOperation.promise === pendingPurchase
          ) {
            commerceOperation = null;
          }
        });

        commerceOperation = {
          kind: 'purchase',
          token: operationToken,
          promise: pendingPurchase,
        };
        return pendingPurchase;
      },

      restorePurchases: () => {
        if (commerceOperation?.kind === 'restore') {
          return commerceOperation.promise;
        }
        if (commerceOperation) {
          return Promise.resolve({
            status: 'error',
            message: STORE_OPERATION_BUSY_MESSAGE,
          });
        }

        const operationToken = Symbol('restore');
        const restore = (async (): Promise<RestoreResult> => {
          await Promise.resolve();
          const pendingRefresh = refreshPromise;
          if (pendingRefresh) await pendingRefresh;
          if (
            commerceOperation?.kind !== 'restore' ||
            commerceOperation.token !== operationToken
          ) {
            return {
              status: 'error',
              message: STORE_OPERATION_BUSY_MESSAGE,
            };
          }
          const service = await ensureService();
          if (!service) {
            return {
              status: 'error',
              message: ENTITLEMENT_REFRESH_ERROR_MESSAGE,
            };
          }
          if (
            commerceOperation?.kind !== 'restore' ||
            commerceOperation.token !== operationToken
          ) {
            return {
              status: 'error',
              message: STORE_OPERATION_BUSY_MESSAGE,
            };
          }
          const serviceGeneration = activeServiceGeneration;
          if (service.kind === 'unavailable') {
            const result: RestoreResult = {
              status: 'error',
              message: 'Restore purchases is unavailable in this build.',
            };
            if (isActiveService(service, serviceGeneration)) {
              set({
                status: 'error',
                notice: { kind: 'error', message: result.message },
              });
            }
            return result;
          }

          set({ status: 'restoring', notice: null });
          const operationRevision = entitlementRevision;
          const operationStartAccess = useEntitlementStore.getState().hasFullGame;
          let result: RestoreResult;
          try {
            result = await service.restorePurchases();
          } catch {
            result = { status: 'error', message: RESTORE_ERROR_MESSAGE };
          }
          if (!isActiveService(service, serviceGeneration)) return result;
          const expectedAccess =
            result.status === 'restored'
              ? true
                : result.status === 'not-found'
                ? false
                : null;
          const currentAccess = useEntitlementStore.getState().hasFullGame;
          if (
            entitlementRevision !== operationRevision &&
            (expectedAccess === null
              ? currentAccess !== operationStartAccess
              : currentAccess !== expectedAccess)
          ) {
            set({ status: 'ready', notice: null });
            return result;
          }

          switch (result.status) {
            case 'restored':
              commitVerifiedEntitlement(service, true);
              set({
                status: 'ready',
                notice: {
                  kind: 'success',
                  message: 'Full Atelier purchase restored.',
                },
              });
              break;
            case 'not-found':
              commitVerifiedEntitlement(service, false);
              set({
                status: 'ready',
                notice: {
                  kind: 'neutral',
                  message:
                    'No Full Atelier purchase was found for this store account.',
                },
              });
              break;
            case 'error':
              set({
                status: 'error',
                notice: { kind: 'error', message: result.message },
              });
              break;
          }
          return result;
        });

        const pendingRestore = restore().finally(() => {
          if (
            commerceOperation?.kind === 'restore' &&
            commerceOperation.promise === pendingRestore
          ) {
            commerceOperation = null;
          }
        });

        commerceOperation = {
          kind: 'restore',
          token: operationToken,
          promise: pendingRestore,
        };
        return pendingRestore;
      },

      refreshEntitlement: () => {
        if (refreshPromise) return refreshPromise;
        if (commerceOperation) return Promise.resolve();

        const refresh = async (): Promise<void> => {
          const service = await ensureService();
          if (!service || service.kind === 'unavailable') return;
          const serviceGeneration = activeServiceGeneration;
          if (!isActiveService(service, serviceGeneration)) return;
          const verificationRevision = entitlementRevision;

          set({ status: 'refreshing', notice: null });
          try {
            const hasFullGame = await service.hasFullGame();
            if (!isActiveService(service, serviceGeneration)) return;
            if (entitlementRevision === verificationRevision) {
              commitVerifiedEntitlement(service, hasFullGame);
            }
            await refreshOffer(service, serviceGeneration);
            if (isActiveService(service, serviceGeneration)) {
              set({ status: 'ready' });
            }
          } catch {
            if (isActiveService(service, serviceGeneration)) {
              set({
                status: 'error',
                notice: {
                  kind: 'error',
                  message: ENTITLEMENT_REFRESH_ERROR_MESSAGE,
                },
              });
            }
          }
        };

        const pendingRefresh = refresh().finally(() => {
          if (refreshPromise === pendingRefresh) refreshPromise = null;
        });
        refreshPromise = pendingRefresh;
        return pendingRefresh;
      },

      setDebugEntitlement: (hasFullGame) => {
        if (!__DEV__) return;
        set({
          debugOverride: hasFullGame,
          notice:
            hasFullGame === null
              ? null
              : {
                  kind: 'neutral',
                  message: `Development entitlement forced ${
                    hasFullGame ? 'unlocked' : 'locked'
                  }.`,
                },
        });
      },

      clearNotice: () => set({ notice: null }),
    }),
    {
      name: ENTITLEMENT_STORAGE_KEY,
      version: ENTITLEMENT_STORAGE_VERSION,
      storage: createJSONStorage(() => failSoftEntitlementStorage),
      partialize: persistedEntitlementState,
      migrate: (value) => sanitizeEntitlementState(value),
      merge: (persisted, current) => {
        const cached = sanitizeEntitlementState(persisted);
        return {
          ...current,
          ...cached,
          // Only a RevenueCat-verified cache is authoritative before runtime
          // initialization. Mock state is seeded after explicit mock selection.
          hasFullGame:
            cached.cacheSource === 'revenuecat'
              ? cached.cachedHasFullGame
              : false,
        };
      },
      skipHydration: true,
    },
  ),
);

export function selectHasFullGame(state: EntitlementStore): boolean {
  return state.debugOverride ?? state.hasFullGame;
}

export function hydrateEntitlements(): Promise<void> {
  if (useEntitlementStore.persist.hasHydrated()) return Promise.resolve();
  if (!hydrationPromise) {
    hydrationPromise = Promise.resolve(useEntitlementStore.persist.rehydrate())
      .then(() => undefined)
      .finally(() => {
        hydrationPromise = null;
      });
  }
  return hydrationPromise;
}

/** Test-only reset for the module-owned service, listener, and durable cache. */
export async function resetEntitlementStoreForTests(): Promise<void> {
  try {
    serviceUnsubscribe?.();
  } catch {
    // Match production replacement semantics for a faulty native cleanup.
  }
  serviceUnsubscribe = null;
  activeService = null;
  defaultService = null;
  initializationPromise = null;
  hydrationPromise = null;
  commerceOperation = null;
  refreshPromise = null;
  activeServiceGeneration += 1;
  entitlementRevision += 1;
  // Tests may replace action functions with spies through setState. Restore the
  // complete initial state so later tests exercise the real store actions.
  useEntitlementStore.setState(useEntitlementStore.getInitialState(), true);
  await AsyncStorage.removeItem(ENTITLEMENT_STORAGE_KEY);
}
