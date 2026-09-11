/** @jest-environment node */
import { act, fireEvent, render } from '@testing-library/react-native';
import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CommerceService } from '../../../commerce/contracts';
import { createCommerceStore } from '../../../store/useCommerceStore';
import { PointsShop } from '../PointsShop';

let mockStore: ReturnType<typeof createCommerceStore>;
jest.mock('../../../store/useCommerceStore', () => {
  const actual = jest.requireActual<typeof import('../../../store/useCommerceStore')>('../../../store/useCommerceStore');
  return { ...actual, useCommerceStore: Object.assign(() => mockStore(), { getState: () => mockStore.getState() }) };
});

function provider(): jest.Mocked<CommerceService> {
  return { mode: 'native', environment: 'sandbox',
    getAccountId: jest.fn<CommerceService['getAccountId']>().mockResolvedValue('guest'),
    getWallet: jest.fn<CommerceService['getWallet']>().mockResolvedValue({ points: 25, revision: 1, environment: 'sandbox' }),
    getOffers: jest.fn<CommerceService['getOffers']>().mockResolvedValue([{ productId: 'pullthread_points_100', points: 100, priceLabel: '1,29 €' }]),
    purchasePoints: jest.fn<CommerceService['purchasePoints']>().mockResolvedValue({ status: 'verified', wallet: { points: 125, revision: 2, environment: 'sandbox' } }),
    redeemTool: jest.fn<CommerceService['redeemTool']>(), getRedemption: jest.fn<CommerceService['getRedemption']>(), resolveTool: jest.fn<CommerceService['resolveTool']>(),
  };
}

beforeEach(async () => { jest.clearAllMocks(); await AsyncStorage.clear(); });

async function mount(service = provider(), close = jest.fn()) {
  mockStore = createCommerceStore(service);
  await mockStore.getState().initialize();
  return { view: await render(<PointsShop onClose={close} />), service, close };
}

async function openStore(view: Awaited<ReturnType<typeof render>>) {
  await fireEvent.press(view.getByTestId('points-shop-open-store'));
}

function pressHandler(view: Awaited<ReturnType<typeof render>>, id: string): () => void {
  // Like fireEvent, find the composite handler through RNTL's exposed fiber;
  // invoke it twice inside one act so React cannot render between the taps.
  let fiber = view.getByTestId(id).unstable_fiber;
  while (fiber && typeof fiber.memoizedProps?.onPress !== 'function') fiber = fiber.return;
  if (!fiber) throw new Error('Expected a press handler');
  return fiber.memoizedProps.onPress;
}

function compositeProp(view: Awaited<ReturnType<typeof render>>, id: string, prop: string): unknown {
  let fiber = view.getByTestId(id).unstable_fiber;
  while (fiber && !(prop in (fiber.memoizedProps ?? {}))) fiber = fiber.return;
  return fiber?.memoizedProps?.[prop];
}

describe('rendered points shop', () => {
  test('shows the localized store price and requires durable guest disclosure before checkout', async () => {
    const { view, service } = await mount();
    expect(view.queryByText('1,29 €')).toBeNull();
    await openStore(view);
    expect(view.getByText('1,29 €')).toBeTruthy();
    expect(compositeProp(view, 'points-guest-disclosure', 'aria-checked')).toBe(false);
    await fireEvent.press(view.getByTestId('buy-pullthread_points_100'));
    expect(service.purchasePoints).not.toHaveBeenCalled();
    await fireEvent.press(view.getByTestId('points-guest-disclosure'));
    expect(compositeProp(view, 'points-guest-disclosure', 'aria-checked')).toBe(true);
    let finish!: () => void;
    jest.mocked(AsyncStorage.setItem).mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    await fireEvent.press(view.getByTestId('buy-pullthread_points_100'));
    expect(service.purchasePoints).not.toHaveBeenCalled();
    await act(async () => { finish(); });
    expect(service.purchasePoints).toHaveBeenCalledTimes(1);
    expect(view.getByText('125 points')).toBeTruthy();
    expect(service.redeemTool).not.toHaveBeenCalled();
  });

  test('a disclosure storage failure stops checkout and lets the player retry', async () => {
    const { view, service } = await mount();
    await openStore(view);
    await fireEvent.press(view.getByTestId('points-guest-disclosure'));
    jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('disk full'));
    await fireEvent.press(view.getByTestId('buy-pullthread_points_100'));
    expect(service.purchasePoints).not.toHaveBeenCalled();
    expect(view.getByTestId('points-shop-local-error')).toBeTruthy();
    await fireEvent.press(view.getByTestId('buy-pullthread_points_100'));
    expect(service.purchasePoints).toHaveBeenCalledTimes(1);
  });

  test.each(['cancelled', 'pending'] as const)('%s checkout never adds an unverified pack or spends a tool', async (status) => {
    const service = provider();
    service.purchasePoints.mockResolvedValue({ status, wallet: { points: 25, revision: 1, environment: 'sandbox' } });
    const { view } = await mount(service);
    await openStore(view);
    await fireEvent.press(view.getByTestId('points-guest-disclosure'));
    await fireEvent.press(view.getByTestId('buy-pullthread_points_100'));
    expect(view.getByText('25 points')).toBeTruthy();
    expect(mockStore.getState().purchaseStatus).toBe(status);
    expect(service.redeemTool).not.toHaveBeenCalled();
  });

  test('the disclosure-to-checkout interval blocks duplicate taps and closing the shop', async () => {
    const { view, service, close } = await mount();
    await openStore(view);
    await fireEvent.press(view.getByTestId('points-guest-disclosure'));
    let finish!: () => void;
    jest.mocked(AsyncStorage.setItem).mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const onPress = pressHandler(view, 'buy-pullthread_points_100');
    await act(() => { onPress(); onPress(); });
    await fireEvent.press(view.getByTestId('points-shop-close'));
    expect(close).not.toHaveBeenCalled();
    expect(service.purchasePoints).not.toHaveBeenCalled();
    await act(async () => { finish(); });
    expect(service.purchasePoints).toHaveBeenCalledTimes(1);
  });

  test('refresh recovers temporarily unavailable prices and the verified balance', async () => {
    const service = provider();
    service.getOffers.mockRejectedValueOnce(new Error('store offline'));
    const { view } = await mount(service);
    await openStore(view);
    expect(view.queryByTestId('buy-pullthread_points_100')).toBeNull();
    service.getWallet.mockResolvedValue({ points: 125, revision: 2, environment: 'sandbox' });
    await fireEvent.press(view.getByTestId('points-shop-refresh'));
    expect(view.getByText('125 points')).toBeTruthy();
    expect(view.getByText('1,29 €')).toBeTruthy();
  });

  test('refresh clears a local checkout-start error', async () => {
    const service = provider();
    service.purchasePoints.mockRejectedValueOnce(new Error('checkout closed unexpectedly'));
    const { view } = await mount(service);
    await openStore(view);
    await fireEvent.press(view.getByTestId('points-guest-disclosure'));
    await fireEvent.press(view.getByTestId('buy-pullthread_points_100'));
    expect(view.getByTestId('points-shop-local-error')).toBeTruthy();
    await fireEvent.press(view.getByTestId('points-shop-refresh'));
    expect(view.queryByTestId('points-shop-local-error')).toBeNull();
  });

  test('keeps customization and the weekly leaderboard inside Points & tools', async () => {
    const customize = jest.fn();
    const leaderboard = jest.fn();
    mockStore = createCommerceStore(provider());
    await mockStore.getState().initialize();
    const view = await render(<PointsShop onClose={jest.fn()} onCustomize={customize} onLeaderboard={leaderboard} />);

    expect(view.getByText('PLAY & PERSONALIZE')).toBeTruthy();
    await fireEvent.press(view.getByTestId('points-button-studio'));
    await fireEvent.press(view.getByTestId('points-weekly-leaderboard'));

    expect(customize).toHaveBeenCalledTimes(1);
    expect(leaderboard).toHaveBeenCalledTimes(1);
  });

  test('keeps checkout in a dedicated Point Shop view with a way back to the hub', async () => {
    const { view } = await mount();

    expect(view.getByText('Points & tools')).toBeTruthy();
    expect(view.queryByTestId('points-guest-disclosure')).toBeNull();
    await openStore(view);
    expect(view.getByText('Point Shop')).toBeTruthy();
    expect(view.getByTestId('points-guest-disclosure')).toBeTruthy();
    expect(view.queryByText('PLAY & PERSONALIZE')).toBeNull();

    await fireEvent.press(view.getByTestId('points-shop-back'));
    expect(view.getByText('Points & tools')).toBeTruthy();
    expect(view.queryByTestId('points-guest-disclosure')).toBeNull();
  });
});
