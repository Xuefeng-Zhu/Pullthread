export const FULL_ATELIER_ENTITLEMENT_ID = 'full_atelier';
export const FULL_GAME_PRODUCT_ID = 'pullthread_full_game';

export type EntitlementServiceKind =
  | 'mock'
  | 'revenuecat'
  | 'unavailable';

export type FullGameOffer = Readonly<{
  productId: string;
  title: string;
  description: string;
  priceString: string;
}>;

export type PurchaseResult =
  | Readonly<{ status: 'purchased' }>
  | Readonly<{ status: 'cancelled' }>
  | Readonly<{ status: 'error'; message: string }>;

export type RestoreResult =
  | Readonly<{ status: 'restored' }>
  | Readonly<{ status: 'not-found' }>
  | Readonly<{ status: 'error'; message: string }>;

export type EntitlementListener = (hasFullGame: boolean) => void;
export type EntitlementUnsubscribe = () => void;

/**
 * Platform-neutral boundary for the one-time Full Atelier unlock.
 *
 * Implementations own SDK-specific state and report entitlement changes through
 * `subscribe`. Callers remain responsible for persisting the last known value
 * so a previously verified purchase can continue to work offline.
 */
export interface EntitlementService {
  readonly kind: EntitlementServiceKind;

  initialize(): Promise<void>;
  hasFullGame(): Promise<boolean>;
  getFullGameOffer(): Promise<FullGameOffer | null>;
  purchaseFullGame(): Promise<PurchaseResult>;
  restorePurchases(): Promise<RestoreResult>;
  subscribe(listener: EntitlementListener): EntitlementUnsubscribe;
  debugSetFullGame?(hasFullGame: boolean): void;
}
