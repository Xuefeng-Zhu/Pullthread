import {
  FULL_GAME_PRODUCT_ID,
  type EntitlementListener,
  type EntitlementService,
  type FullGameOffer,
  type PurchaseResult,
  type RestoreResult,
} from './EntitlementService';

export type MockPurchaseOutcome = 'success' | 'cancel' | 'error';
export type MockRestoreOutcome =
  | 'current'
  | 'restored'
  | 'not-found'
  | 'error';

export type MockEntitlementServiceOptions = Readonly<{
  initiallyUnlocked?: boolean;
  offerAvailable?: boolean;
  offer?: FullGameOffer;
  purchaseOutcome?: MockPurchaseOutcome;
  purchaseErrorMessage?: string;
  restoreOutcome?: MockRestoreOutcome;
  restoreErrorMessage?: string;
}>;

export const DEFAULT_MOCK_FULL_GAME_OFFER: FullGameOffer = {
  productId: FULL_GAME_PRODUCT_ID,
  title: 'Full Atelier',
  description: 'Unlock nine additional handcrafted levels.',
  priceString: 'Mock purchase',
};

/**
 * Credential-free entitlement implementation for development and tests.
 *
 * It intentionally starts locked. Every purchase and restore behavior is
 * selected at construction time so cancellation and failure paths are as
 * deterministic as the success path.
 */
export class MockEntitlementService implements EntitlementService {
  readonly kind = 'mock' as const;

  private fullGame: boolean;
  private readonly offer: FullGameOffer | null;
  private readonly purchaseOutcome: MockPurchaseOutcome;
  private readonly purchaseErrorMessage: string;
  private readonly restoreOutcome: MockRestoreOutcome;
  private readonly restoreErrorMessage: string;
  private readonly listeners = new Set<EntitlementListener>();

  constructor(options: MockEntitlementServiceOptions = {}) {
    this.fullGame = options.initiallyUnlocked ?? false;
    this.offer =
      options.offerAvailable === false
        ? null
        : (options.offer ?? DEFAULT_MOCK_FULL_GAME_OFFER);
    this.purchaseOutcome = options.purchaseOutcome ?? 'success';
    this.purchaseErrorMessage =
      options.purchaseErrorMessage ?? 'The mock purchase could not be completed.';
    this.restoreOutcome = options.restoreOutcome ?? 'current';
    this.restoreErrorMessage =
      options.restoreErrorMessage ?? 'The mock restore could not be completed.';
  }

  async initialize(): Promise<void> {}

  async hasFullGame(): Promise<boolean> {
    return this.fullGame;
  }

  async getFullGameOffer(): Promise<FullGameOffer | null> {
    return this.offer;
  }

  async purchaseFullGame(): Promise<PurchaseResult> {
    if (!this.offer) {
      return {
        status: 'error',
        message: 'The Full Atelier offer is currently unavailable.',
      };
    }

    switch (this.purchaseOutcome) {
      case 'success':
        this.setFullGame(true);
        return { status: 'purchased' };
      case 'cancel':
        return { status: 'cancelled' };
      case 'error':
        return { status: 'error', message: this.purchaseErrorMessage };
    }
  }

  async restorePurchases(): Promise<RestoreResult> {
    switch (this.restoreOutcome) {
      case 'current':
        return this.fullGame ? { status: 'restored' } : { status: 'not-found' };
      case 'restored':
        this.setFullGame(true);
        return { status: 'restored' };
      case 'not-found':
        this.setFullGame(false);
        return { status: 'not-found' };
      case 'error':
        return { status: 'error', message: this.restoreErrorMessage };
    }
  }

  subscribe(listener: EntitlementListener): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  debugSetFullGame(hasFullGame: boolean): void {
    this.setFullGame(hasFullGame);
  }

  private setFullGame(hasFullGame: boolean): void {
    if (this.fullGame === hasFullGame) {
      return;
    }

    this.fullGame = hasFullGame;

    for (const listener of this.listeners) {
      listener(hasFullGame);
    }
  }
}
