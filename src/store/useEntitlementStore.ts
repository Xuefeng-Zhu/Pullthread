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

let activeService: EntitlementService | null = null;
let defaultService: EntitlementService | null = null;
let serviceUnsubscribe: (() => void) | null = null;
let initializationPromise: Promise<void> | null = null;
let hydrationPromise: Promise<void> | null = null;

function runtimeService(): EntitlementService {
  if (!defaultService) defaultService = createEntitlementService();
  return defaultService;
}

function commitVerifiedEntitlement(
  service: EntitlementService,
  hasFullGame: boolean,
): void {
  const cacheSource = cacheSourceFor(service);
  if (!cacheSource) return;

  useEntitlementStore.setState({
    hasFullGame,
    cachedHasFullGame: hasFullGame,
    cacheSource,
    verifiedAt: Date.now(),
  });
}

async function refreshOffer(service: EntitlementService): Promise<void> {
  try {
    const offer = await service.getFullGameOffer();
    if (activeService === service) useEntitlementStore.setState({ offer });
  } catch {
    if (activeService === service) useEntitlementStore.setState({ offer: null });
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

  serviceUnsubscribe?.();
  serviceUnsubscribe = null;
  activeService = service;
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
      if (activeService !== service) return;
      serviceUnsubscribe = service.subscribe((hasFullGame) => {
        if (activeService === service) {
          commitVerifiedEntitlement(service, hasFullGame);
        }
      });
      const hasFullGame = await service.hasFullGame();
      if (activeService !== service) return;
      commitVerifiedEntitlement(service, hasFullGame);
      await refreshOffer(service);
      if (activeService === service) {
        useEntitlementStore.setState({ status: 'ready', notice: null });
      }
    } catch {
      if (activeService === service) {
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

      purchaseFullGame: async () => {
        const service = await ensureService();
        if (!service) {
          return unavailableResult(ENTITLEMENT_REFRESH_ERROR_MESSAGE);
        }
        if (service.kind === 'unavailable') {
          const result = unavailableResult(
            'Full Atelier purchases are unavailable in this build.',
          );
          set({ status: 'error', notice: { kind: 'error', message: result.message } });
          return result;
        }

        set({ status: 'purchasing', notice: null });
        const result = await service.purchaseFullGame();
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
      },

      restorePurchases: async () => {
        const service = await ensureService();
        if (!service) {
          return {
            status: 'error',
            message: ENTITLEMENT_REFRESH_ERROR_MESSAGE,
          };
        }
        if (service.kind === 'unavailable') {
          const result: RestoreResult = {
            status: 'error',
            message: 'Restore purchases is unavailable in this build.',
          };
          set({ status: 'error', notice: { kind: 'error', message: result.message } });
          return result;
        }

        set({ status: 'restoring', notice: null });
        const result = await service.restorePurchases();
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
                message: 'No Full Atelier purchase was found for this store account.',
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
      },

      refreshEntitlement: async () => {
        const service = await ensureService();
        if (!service || service.kind === 'unavailable') return;

        set({ status: 'refreshing', notice: null });
        try {
          const hasFullGame = await service.hasFullGame();
          commitVerifiedEntitlement(service, hasFullGame);
          await refreshOffer(service);
          set({ status: 'ready' });
        } catch {
          set({
            status: 'error',
            notice: {
              kind: 'error',
              message: ENTITLEMENT_REFRESH_ERROR_MESSAGE,
            },
          });
        }
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
  serviceUnsubscribe?.();
  serviceUnsubscribe = null;
  activeService = null;
  defaultService = null;
  initializationPromise = null;
  hydrationPromise = null;
  // Tests may replace action functions with spies through setState. Restore the
  // complete initial state so later tests exercise the real store actions.
  useEntitlementStore.setState(useEntitlementStore.getInitialState(), true);
  await AsyncStorage.removeItem(ENTITLEMENT_STORAGE_KEY);
}
