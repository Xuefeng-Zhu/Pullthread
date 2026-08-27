import { describe, expect, it, jest } from '@jest/globals';

import {
  DEFAULT_MOCK_FULL_GAME_OFFER,
  FULL_ATELIER_ENTITLEMENT_ID,
  FULL_GAME_PRODUCT_ID,
  MockEntitlementService,
} from '..';

describe('MockEntitlementService', () => {
  it('starts locked with the canonical Full Atelier offer', async () => {
    const service = new MockEntitlementService();

    await expect(service.initialize()).resolves.toBeUndefined();
    await expect(service.hasFullGame()).resolves.toBe(false);
    await expect(service.getFullGameOffer()).resolves.toEqual(
      DEFAULT_MOCK_FULL_GAME_OFFER,
    );
    expect(service.kind).toBe('mock');
    expect(FULL_ATELIER_ENTITLEMENT_ID).toBe('full_atelier');
    expect(FULL_GAME_PRODUCT_ID).toBe('pullthread_full_game');
  });

  it('unlocks on purchase success and publishes one state change', async () => {
    const service = new MockEntitlementService();
    const listener = jest.fn();
    service.subscribe(listener);

    await expect(service.purchaseFullGame()).resolves.toEqual({
      status: 'purchased',
    });
    await expect(service.hasFullGame()).resolves.toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(true);

    await service.purchaseFullGame();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('restores a purchase made by the default mock without revoking it', async () => {
    const service = new MockEntitlementService();

    await expect(service.restorePurchases()).resolves.toEqual({
      status: 'not-found',
    });
    await expect(service.purchaseFullGame()).resolves.toEqual({
      status: 'purchased',
    });
    await expect(service.restorePurchases()).resolves.toEqual({
      status: 'restored',
    });
    await expect(service.hasFullGame()).resolves.toBe(true);
  });

  it('keeps the entitlement locked when purchase is cancelled', async () => {
    const service = new MockEntitlementService({
      purchaseOutcome: 'cancel',
    });
    const listener = jest.fn();
    service.subscribe(listener);

    await expect(service.purchaseFullGame()).resolves.toEqual({
      status: 'cancelled',
    });
    await expect(service.hasFullGame()).resolves.toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it('returns a configured purchase error without changing state', async () => {
    const service = new MockEntitlementService({
      purchaseOutcome: 'error',
      purchaseErrorMessage: 'Store unavailable',
    });

    await expect(service.purchaseFullGame()).resolves.toEqual({
      status: 'error',
      message: 'Store unavailable',
    });
    await expect(service.hasFullGame()).resolves.toBe(false);
  });

  it('reports an unavailable offer and prevents a mock purchase', async () => {
    const service = new MockEntitlementService({ offerAvailable: false });

    await expect(service.getFullGameOffer()).resolves.toBeNull();
    await expect(service.purchaseFullGame()).resolves.toEqual({
      status: 'error',
      message: 'The Full Atelier offer is currently unavailable.',
    });
    await expect(service.hasFullGame()).resolves.toBe(false);
  });

  it('restores an entitlement and publishes the unlocked state', async () => {
    const service = new MockEntitlementService({
      restoreOutcome: 'restored',
    });
    const listener = jest.fn();
    service.subscribe(listener);

    await expect(service.restorePurchases()).resolves.toEqual({
      status: 'restored',
    });
    await expect(service.hasFullGame()).resolves.toBe(true);
    expect(listener).toHaveBeenCalledWith(true);
  });

  it('locks a stale local entitlement when restore finds no purchase', async () => {
    const service = new MockEntitlementService({
      initiallyUnlocked: true,
      restoreOutcome: 'not-found',
    });
    const listener = jest.fn();
    service.subscribe(listener);

    await expect(service.restorePurchases()).resolves.toEqual({
      status: 'not-found',
    });
    await expect(service.hasFullGame()).resolves.toBe(false);
    expect(listener).toHaveBeenCalledWith(false);
  });

  it('preserves state when restore fails', async () => {
    const service = new MockEntitlementService({
      initiallyUnlocked: true,
      restoreOutcome: 'error',
      restoreErrorMessage: 'Offline',
    });

    await expect(service.restorePurchases()).resolves.toEqual({
      status: 'error',
      message: 'Offline',
    });
    await expect(service.hasFullGame()).resolves.toBe(true);
  });

  it('supports debug overrides and listener unsubscription', async () => {
    const service = new MockEntitlementService();
    const listener = jest.fn();
    const unsubscribe = service.subscribe(listener);

    service.debugSetFullGame(true);
    unsubscribe();
    service.debugSetFullGame(false);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(true);
    await expect(service.hasFullGame()).resolves.toBe(false);
  });
});
