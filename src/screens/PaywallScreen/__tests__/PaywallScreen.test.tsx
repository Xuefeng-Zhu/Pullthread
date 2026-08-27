import {
  act,
  fireEvent,
  render,
  waitFor,
} from '@testing-library/react-native';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { AccessibilityInfo } from 'react-native';

import type { EntitlementService } from '../../../services/entitlements';
import { MockEntitlementService } from '../../../services/entitlements';
import {
  initializeEntitlements,
  resetEntitlementStoreForTests,
  useEntitlementStore,
} from '../../../store/useEntitlementStore';
import { PaywallScreen } from '../PaywallScreen';

jest.mock('../../../services/entitlements/createEntitlementService', () => ({
  createEntitlementService: jest.fn(),
}));

const offer = {
  productId: 'pullthread_full_game',
  title: 'Full Atelier',
  description: 'The complete campaign',
  priceString: '$6.99',
} as const;

type NoticeCase = readonly [
  kind: 'success' | 'neutral' | 'error',
  message: string,
];

const noticeCases: readonly NoticeCase[] = [
  ['success', 'Full Atelier is unlocked on this device.'],
  ['neutral', 'Purchase cancelled. Nothing was charged.'],
  ['error', 'The store could not complete this purchase.'],
  [
    'neutral',
    'No Full Atelier purchase was found for this store account.',
  ],
];

describe('PaywallScreen', () => {
  beforeEach(async () => {
    await resetEntitlementStoreForTests();
  });

  it('presents the one-time offer and all Full Atelier benefits', async () => {
    useEntitlementStore.setState({ status: 'ready', offer });

    const view = await render(
      <PaywallScreen navigation={{ goBack: jest.fn() }} />,
    );

    expect(view.getByTestId('paywall-screen')).toBeTruthy();
    expect(view.getByText('Full Atelier')).toBeTruthy();
    expect(view.getByText('ONE-TIME UNLOCK · NO SUBSCRIPTION')).toBeTruthy();
    expect(view.getByText('Nine additional handcrafted levels')).toBeTruthy();
    expect(view.getByText('Additional fabric mechanics')).toBeTruthy();
    expect(view.getByText('Pocket stitch levels')).toBeTruthy();
    expect(view.getByText('Unlimited campaign replay')).toBeTruthy();
    expect(
      view.getByText('UNLOCK FULL ATELIER · $6.99'),
    ).toBeTruthy();
    expect(
      view.getByText(/No subscription, consumable currency, or recurring charge/),
    ).toBeTruthy();
  });

  it('runs purchase, restore, and close actions', async () => {
    const purchaseFullGame = jest.fn(async () => ({
      status: 'purchased' as const,
    }));
    const restorePurchases = jest.fn(async () => ({
      status: 'restored' as const,
    }));
    const goBack = jest.fn();
    useEntitlementStore.setState({
      status: 'ready',
      offer,
      purchaseFullGame,
      restorePurchases,
    });
    const view = await render(<PaywallScreen navigation={{ goBack }} />);

    await fireEvent.press(view.getByTestId('paywall-purchase-button'));
    await fireEvent.press(view.getByTestId('paywall-restore-button'));
    await fireEvent.press(view.getByTestId('paywall-close-button'));

    expect(purchaseFullGame).toHaveBeenCalledTimes(1);
    expect(restorePurchases).toHaveBeenCalledTimes(1);
    expect(goBack).toHaveBeenCalledTimes(1);
  });

  it('disables store actions while busy but keeps close available', async () => {
    const purchaseFullGame = jest.fn(async () => ({
      status: 'purchased' as const,
    }));
    const restorePurchases = jest.fn(async () => ({
      status: 'restored' as const,
    }));
    const goBack = jest.fn();
    useEntitlementStore.setState({
      status: 'refreshing',
      offer,
      purchaseFullGame,
      restorePurchases,
    });
    const view = await render(<PaywallScreen navigation={{ goBack }} />);

    await fireEvent.press(view.getByTestId('paywall-purchase-button'));
    await fireEvent.press(view.getByTestId('paywall-restore-button'));
    expect(purchaseFullGame).not.toHaveBeenCalled();
    expect(restorePurchases).not.toHaveBeenCalled();

    await act(async () => {
      useEntitlementStore.setState({ status: 'purchasing' });
    });
    await fireEvent.press(view.getByTestId('paywall-close-button'));
    expect(view.getByText('PURCHASING…')).toBeTruthy();
    expect(goBack).toHaveBeenCalledTimes(1);
  });

  it('connects the purchase button to a successful mock unlock', async () => {
    await initializeEntitlements(new MockEntitlementService());
    const view = await render(
      <PaywallScreen navigation={{ goBack: jest.fn() }} />,
    );

    await fireEvent.press(view.getByTestId('paywall-purchase-button'));

    await waitFor(() => {
      expect(useEntitlementStore.getState().hasFullGame).toBe(true);
      expect(view.getByText('FULL ATELIER UNLOCKED')).toBeTruthy();
      expect(
        view.getByText('Full Atelier is unlocked on this device.'),
      ).toBeTruthy();
    });
  });

  it('connects cancellation to neutral UI feedback and an iOS announcement', async () => {
    const announce = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation(() => undefined);
    await initializeEntitlements(
      new MockEntitlementService({ purchaseOutcome: 'cancel' }),
    );
    const view = await render(
      <PaywallScreen navigation={{ goBack: jest.fn() }} />,
    );

    await fireEvent.press(view.getByTestId('paywall-purchase-button'));

    await waitFor(() => {
      expect(useEntitlementStore.getState().hasFullGame).toBe(false);
      expect(view.getByText('Purchase cancelled. Nothing was charged.')).toBeTruthy();
      expect(announce).toHaveBeenCalledWith(
        'Purchase cancelled. Nothing was charged.',
      );
    });
    announce.mockRestore();
  });

  it('connects restore to both restored and not-found mock outcomes', async () => {
    await initializeEntitlements(
      new MockEntitlementService({ restoreOutcome: 'restored' }),
    );
    const restoredView = await render(
      <PaywallScreen navigation={{ goBack: jest.fn() }} />,
    );

    await fireEvent.press(restoredView.getByTestId('paywall-restore-button'));
    await waitFor(() => {
      expect(restoredView.getByText('Full Atelier purchase restored.')).toBeTruthy();
      expect(useEntitlementStore.getState().hasFullGame).toBe(true);
    });

    restoredView.unmount();
    await resetEntitlementStoreForTests();
    await initializeEntitlements(new MockEntitlementService());
    const notFoundView = await render(
      <PaywallScreen navigation={{ goBack: jest.fn() }} />,
    );

    await fireEvent.press(notFoundView.getByTestId('paywall-restore-button'));
    await waitFor(() => {
      expect(
        notFoundView.getByText(
          'No Full Atelier purchase was found for this store account.',
        ),
      ).toBeTruthy();
      expect(useEntitlementStore.getState().hasFullGame).toBe(false);
    });
  });

  it('retries a transient RevenueCat offer failure when the paywall opens', async () => {
    let offerRequests = 0;
    const service: EntitlementService = {
      kind: 'revenuecat',
      initialize: async () => undefined,
      hasFullGame: async () => false,
      getFullGameOffer: async () => {
        offerRequests += 1;
        if (offerRequests === 1) throw new Error('Offline');
        return offer;
      },
      purchaseFullGame: async () => ({ status: 'purchased' }),
      restorePurchases: async () => ({ status: 'not-found' }),
      subscribe: () => () => undefined,
    };
    await initializeEntitlements(service);
    expect(useEntitlementStore.getState().offer).toBeNull();

    const view = await render(
      <PaywallScreen navigation={{ goBack: jest.fn() }} />,
    );

    await waitFor(() => {
      expect(offerRequests).toBe(2);
      expect(view.getByText('UNLOCK FULL ATELIER · $6.99')).toBeTruthy();
    });
  });

  it('disables purchase when the offer is unavailable but allows restore', async () => {
    const purchaseFullGame = jest.fn(async () => ({
      status: 'purchased' as const,
    }));
    const restorePurchases = jest.fn(async () => ({
      status: 'not-found' as const,
    }));
    useEntitlementStore.setState({
      status: 'ready',
      offer: null,
      purchaseFullGame,
      restorePurchases,
    });
    const view = await render(
      <PaywallScreen navigation={{ goBack: jest.fn() }} />,
    );

    await fireEvent.press(view.getByTestId('paywall-purchase-button'));
    await fireEvent.press(view.getByTestId('paywall-restore-button'));

    expect(purchaseFullGame).not.toHaveBeenCalled();
    expect(restorePurchases).toHaveBeenCalledTimes(1);
    expect(view.getByText('FULL ATELIER UNAVAILABLE')).toBeTruthy();
  });

  it.each(noticeCases)(
    'renders the %s store notice',
    async (kind, message) => {
      useEntitlementStore.setState({
        status: kind === 'error' ? 'error' : 'ready',
        offer,
        notice: { kind, message },
      });

      const view = await render(
        <PaywallScreen navigation={{ goBack: jest.fn() }} />,
      );

      expect(view.getByTestId('paywall-status')).toBeTruthy();
      expect(view.getByText(message)).toBeTruthy();
    },
  );
});
