import { Platform } from 'react-native';

import {
  type EntitlementListener,
  type EntitlementService,
  type PurchaseResult,
  type RestoreResult,
} from './EntitlementService';
import {
  MockEntitlementService,
  type MockEntitlementServiceOptions,
} from './MockEntitlementService';
import {
  RevenueCatEntitlementService,
  type PurchasesClient,
} from './RevenueCatEntitlementService';

export type EntitlementMode = 'auto' | 'mock' | 'revenuecat';

export type CreateEntitlementServiceOptions = Readonly<{
  platform?: string;
  isDevelopment?: boolean;
  mode?: string;
  iosApiKey?: string;
  androidApiKey?: string;
  purchasesClient?: PurchasesClient;
  mock?: MockEntitlementServiceOptions;
}>;

const UNAVAILABLE_MESSAGE = 'Purchases are unavailable in this build.';

class UnavailableEntitlementService implements EntitlementService {
  readonly kind = 'unavailable' as const;

  async initialize(): Promise<void> {}

  async hasFullGame(): Promise<boolean> {
    return false;
  }

  async getFullGameOffer(): Promise<null> {
    return null;
  }

  async purchaseFullGame(): Promise<PurchaseResult> {
    return { status: 'error', message: UNAVAILABLE_MESSAGE };
  }

  async restorePurchases(): Promise<RestoreResult> {
    return { status: 'error', message: UNAVAILABLE_MESSAGE };
  }

  subscribe(_listener: EntitlementListener): () => void {
    return () => {};
  }
}

const parseMode = (value: string | undefined): EntitlementMode => {
  const mode = value?.trim().toLowerCase();

  if (mode === 'mock' || mode === 'revenuecat') {
    return mode;
  }

  return 'auto';
};

const valueOrUndefined = (value: string | undefined): string | undefined => {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
};

/**
 * Selects the entitlement implementation without ever placing secret keys in
 * source. RevenueCat SDK keys are platform-specific public client values.
 */
export const createEntitlementService = (
  options: CreateEntitlementServiceOptions = {},
): EntitlementService => {
  const platform = options.platform ?? Platform.OS;
  const isDevelopment = options.isDevelopment ?? __DEV__;
  const mode = parseMode(
    options.mode ?? process.env.EXPO_PUBLIC_ENTITLEMENT_MODE,
  );
  const iosApiKey = valueOrUndefined(
    options.iosApiKey ?? process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY,
  );
  const androidApiKey = valueOrUndefined(
    options.androidApiKey ??
      process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY,
  );

  if (mode === 'mock') {
    return isDevelopment
      ? new MockEntitlementService(options.mock)
      : new UnavailableEntitlementService();
  }

  if (platform !== 'ios' && platform !== 'android') {
    return new UnavailableEntitlementService();
  }

  const apiKey = platform === 'ios' ? iosApiKey : androidApiKey;

  if (apiKey) {
    return new RevenueCatEntitlementService(apiKey, options.purchasesClient);
  }

  if (mode === 'auto' && isDevelopment) {
    return new MockEntitlementService(options.mock);
  }

  return new UnavailableEntitlementService();
};
