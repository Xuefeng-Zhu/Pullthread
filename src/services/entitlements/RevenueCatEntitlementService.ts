import type {
  CustomerInfoUpdateListener,
  PurchasesPackage,
} from 'react-native-purchases';

import {
  FULL_ATELIER_ENTITLEMENT_ID,
  FULL_GAME_PRODUCT_ID,
  type EntitlementListener,
  type EntitlementService,
  type FullGameOffer,
  type PurchaseResult,
  type RestoreResult,
} from './EntitlementService';

type RevenueCatEntitlement = Readonly<{
  isActive?: boolean;
}>;

export type RevenueCatCustomerInfo = Readonly<{
  entitlements: Readonly<{
    active: Readonly<Record<string, RevenueCatEntitlement>>;
  }>;
}>;

export type RevenueCatPackage = Readonly<{
  product: Readonly<{
    identifier: string;
    title: string;
    description: string;
    priceString: string;
    productCategory: 'NON_SUBSCRIPTION' | 'SUBSCRIPTION' | 'UNKNOWN' | null;
    productType:
      | 'CONSUMABLE'
      | 'NON_CONSUMABLE'
      | 'NON_RENEWABLE_SUBSCRIPTION'
      | 'AUTO_RENEWABLE_SUBSCRIPTION'
      | 'PREPAID_SUBSCRIPTION'
      | 'UNKNOWN';
  }>;
}>;

export type RevenueCatOfferings = Readonly<{
  current: Readonly<{
    availablePackages: readonly RevenueCatPackage[];
  }> | null;
}>;

export type RevenueCatCustomerInfoListener = (
  customerInfo: RevenueCatCustomerInfo,
) => void;

export type RevenueCatNativePlatform = 'ios' | 'android';

/**
 * Narrow seam around RevenueCat's process-wide singleton. Production delegates
 * to `react-native-purchases`; tests can supply a deterministic client without
 * loading store state or native purchase UI.
 */
export interface PurchasesClient {
  isConfigured(): Promise<boolean>;
  configure(configuration: Readonly<{ apiKey: string }>): Promise<void> | void;
  getCustomerInfo(): Promise<RevenueCatCustomerInfo>;
  getOfferings(): Promise<RevenueCatOfferings>;
  purchasePackage(
    aPackage: RevenueCatPackage,
  ): Promise<Readonly<{ customerInfo: RevenueCatCustomerInfo }>>;
  restorePurchases(): Promise<RevenueCatCustomerInfo>;
  addCustomerInfoUpdateListener(
    listener: RevenueCatCustomerInfoListener,
  ): void;
  removeCustomerInfoUpdateListener(
    listener: RevenueCatCustomerInfoListener,
  ): boolean;
}

type PurchasesSdk = typeof import('react-native-purchases')['default'];

let loadedPurchasesSdk: PurchasesSdk | null = null;

const loadPurchasesSdk = async (): Promise<PurchasesSdk> => {
  if (!loadedPurchasesSdk) {
    loadedPurchasesSdk = (await import('react-native-purchases')).default;
  }

  return loadedPurchasesSdk;
};

const getLoadedPurchasesSdk = (): PurchasesSdk => {
  if (!loadedPurchasesSdk) {
    throw new Error('RevenueCat must be initialized before subscribing.');
  }

  return loadedPurchasesSdk;
};

const purchasesClient: PurchasesClient = {
  isConfigured: async () => (await loadPurchasesSdk()).isConfigured(),
  configure: async ({ apiKey }) =>
    (await loadPurchasesSdk()).configure({ apiKey }),
  getCustomerInfo: async () =>
    (await loadPurchasesSdk()).getCustomerInfo(),
  getOfferings: async () => (await loadPurchasesSdk()).getOfferings(),
  purchasePackage: async (aPackage) =>
    (await loadPurchasesSdk()).purchasePackage(
      aPackage as PurchasesPackage,
    ),
  restorePurchases: async () =>
    (await loadPurchasesSdk()).restorePurchases(),
  addCustomerInfoUpdateListener: (listener) =>
    getLoadedPurchasesSdk().addCustomerInfoUpdateListener(
      listener as CustomerInfoUpdateListener,
    ),
  removeCustomerInfoUpdateListener: (listener) =>
    getLoadedPurchasesSdk().removeCustomerInfoUpdateListener(
      listener as CustomerInfoUpdateListener,
    ),
};

const hasFullAtelier = (customerInfo: RevenueCatCustomerInfo): boolean =>
  customerInfo.entitlements.active[FULL_ATELIER_ENTITLEMENT_ID]?.isActive ===
  true;

const isSubscriptionProductType = (
  productType: RevenueCatPackage['product']['productType'],
): boolean =>
  productType === 'NON_RENEWABLE_SUBSCRIPTION' ||
  productType === 'AUTO_RENEWABLE_SUBSCRIPTION' ||
  productType === 'PREPAID_SUBSCRIPTION';

const isOneTimeUnlockProduct = (
  aPackage: RevenueCatPackage,
  platform: RevenueCatNativePlatform,
): boolean => {
  const { productCategory, productType } = aPackage.product;

  // A category-less package is accepted only when its specific type is an
  // explicit non-consumable, as some SDK/store combinations omit the category.
  if (productCategory === null) return productType === 'NON_CONSUMABLE';
  if (
    productCategory !== 'NON_SUBSCRIPTION' ||
    isSubscriptionProductType(productType)
  ) {
    return false;
  }

  // Hybrid Common 18.32.1 maps every Google Play INAPP product to
  // NON_SUBSCRIPTION + CONSUMABLE. Actual repeat-purchase behavior is selected
  // by the product's non-consumable setting in the RevenueCat dashboard.
  if (platform === 'android') return true;

  // Apple exposes the real consumability distinction, so a consumable must not
  // back Pullthread's permanent Full Atelier entitlement.
  return productType === 'NON_CONSUMABLE' || productType === 'UNKNOWN';
};

const errorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string' &&
    error.message.trim().length > 0
  ) {
    return error.message;
  }

  return fallback;
};

const isUserCancellation = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const candidate = error as { code?: unknown; userCancelled?: unknown };

  return (
    candidate.userCancelled === true ||
    // RevenueCat's public PURCHASE_CANCELLED_ERROR code is stable at "1".
    candidate.code === '1'
  );
};

/** RevenueCat-backed Full Atelier entitlement boundary for native builds. */
export class RevenueCatEntitlementService implements EntitlementService {
  readonly kind = 'revenuecat' as const;

  private readonly apiKey: string;
  private initialization: Promise<void> | null = null;

  constructor(
    apiKey: string,
    private readonly client: PurchasesClient = purchasesClient,
    private readonly platform: RevenueCatNativePlatform = 'ios',
  ) {
    this.apiKey = apiKey.trim();

    if (this.apiKey.length === 0) {
      throw new Error('A RevenueCat public SDK key is required.');
    }
  }

  initialize(): Promise<void> {
    if (!this.initialization) {
      this.initialization = this.configureClient().catch((error: unknown) => {
        this.initialization = null;
        throw error;
      });
    }

    return this.initialization;
  }

  async hasFullGame(): Promise<boolean> {
    await this.initialize();
    return hasFullAtelier(await this.client.getCustomerInfo());
  }

  async getFullGameOffer(): Promise<FullGameOffer | null> {
    await this.initialize();
    const aPackage = await this.getFullGamePackage();

    if (!aPackage) {
      return null;
    }

    return {
      productId: aPackage.product.identifier,
      title: aPackage.product.title,
      description: aPackage.product.description,
      priceString: aPackage.product.priceString,
    };
  }

  async purchaseFullGame(): Promise<PurchaseResult> {
    try {
      await this.initialize();
      const aPackage = await this.getFullGamePackage();

      if (!aPackage) {
        return {
          status: 'error',
          message: 'The Full Atelier offer is currently unavailable.',
        };
      }

      const { customerInfo } = await this.client.purchasePackage(aPackage);

      if (!hasFullAtelier(customerInfo)) {
        return {
          status: 'error',
          message:
            'The purchase completed, but Full Atelier access is not active.',
        };
      }

      return { status: 'purchased' };
    } catch (error: unknown) {
      if (isUserCancellation(error)) {
        return { status: 'cancelled' };
      }

      return {
        status: 'error',
        message: errorMessage(error, 'The purchase could not be completed.'),
      };
    }
  }

  async restorePurchases(): Promise<RestoreResult> {
    try {
      await this.initialize();
      const customerInfo = await this.client.restorePurchases();

      return hasFullAtelier(customerInfo)
        ? { status: 'restored' }
        : { status: 'not-found' };
    } catch (error: unknown) {
      return {
        status: 'error',
        message: errorMessage(error, 'Purchases could not be restored.'),
      };
    }
  }

  subscribe(listener: EntitlementListener): () => void {
    let registered = false;
    let unsubscribed = false;
    const customerInfoListener: RevenueCatCustomerInfoListener = (
      customerInfo,
    ) => {
      listener(hasFullAtelier(customerInfo));
    };

    void this.initialize()
      .then(() => {
        if (unsubscribed) {
          return;
        }

        this.client.addCustomerInfoUpdateListener(customerInfoListener);
        registered = true;
      })
      .catch(() => {
        // `initialize` is explicitly surfaced to the caller. A subscription
        // cannot report asynchronous setup errors through its callback.
      });

    return () => {
      if (unsubscribed) {
        return;
      }

      unsubscribed = true;

      if (registered) {
        this.client.removeCustomerInfoUpdateListener(customerInfoListener);
      }
    };
  }

  private async configureClient(): Promise<void> {
    if (!(await this.client.isConfigured())) {
      await this.client.configure({ apiKey: this.apiKey });
    }
  }

  private async getFullGamePackage(): Promise<RevenueCatPackage | null> {
    const offerings = await this.client.getOfferings();

    return (
      offerings.current?.availablePackages.find(
        (aPackage) =>
          aPackage.product.identifier === FULL_GAME_PRODUCT_ID &&
          isOneTimeUnlockProduct(aPackage, this.platform),
      ) ?? null
    );
  }
}
