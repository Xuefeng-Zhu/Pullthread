/** @jest-environment node */
import { act, fireEvent, render } from '@testing-library/react-native';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ComponentProps } from 'react';
import MockReact from 'react';
import { AccessibilityInfo, AppState, View as MockView } from 'react-native';
import type { CommerceService } from '../../../commerce/contracts';
import { LaunchCanvas } from '../../../game/launch/LaunchCanvas';
import * as commerceService from '../../../services/commerce';
import { createMockCommerceService } from '../../../services/commerce/mockService';
import { createCommerceStore } from '../../../store/useCommerceStore';
import { defaultPreferences, usePreferencesStore } from '../../../store/usePreferencesStore';
import { EndlessGameScreen } from '../EndlessGameScreen';

let mockStore: ReturnType<typeof createCommerceStore>;
jest.mock('../../../store/useCommerceStore', () => {
  const actual = jest.requireActual<typeof import('../../../store/useCommerceStore')>('../../../store/useCommerceStore');
  const hook = Object.assign(() => mockStore(), { getState: () => mockStore.getState() });
  return { ...actual, useCommerceStore: hook };
});
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual<typeof import('@react-navigation/native')>('@react-navigation/native'), useIsFocused: () => true,
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock('../../../game/launch/LaunchCanvas', () => ({
  LaunchCanvas: jest.fn(() => MockReact.createElement(MockView, { testID: 'mock-launch-canvas' })),
}));
jest.mock('../../../components/ToolIcon', () => ({
  ToolIcon: () => MockReact.createElement(MockView),
}));
jest.mock('../../../game/feedback', () => ({
  ExpoFeedbackService: jest.fn(() => ({ setPreferences: jest.fn(), play: jest.fn(async () => undefined), dispose: jest.fn() })),
}));

type ScreenProps = ComponentProps<typeof EndlessGameScreen>;
type ScreenView = Awaited<ReturnType<typeof render>>;
const props = () => ({ navigation: { navigate: jest.fn() } as unknown as ScreenProps['navigation'],
  route: { key: 'paid-tools', name: 'EndlessGame' } as ScreenProps['route'] });
const canvas = () => jest.mocked(LaunchCanvas).mock.calls.at(-1)![0];
let service: jest.Mocked<CommerceService>;
const initialAppState = AppState.currentState;

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  AppState.currentState = 'active';
  usePreferencesStore.setState(defaultPreferences);
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  jest.spyOn(global, 'requestAnimationFrame').mockReturnValue(1);
  jest.spyOn(global, 'cancelAnimationFrame').mockImplementation(() => undefined);
  const base = createMockCommerceService();
  await base.purchasePoints('pullthread_points_100');
  service = { ...base, getAccountId: jest.fn(base.getAccountId), getOffers: jest.fn(base.getOffers), getWallet: jest.fn(base.getWallet),
    purchasePoints: jest.fn(base.purchasePoints), redeemTool: jest.fn(base.redeemTool),
    getRedemption: jest.fn(base.getRedemption), resolveTool: jest.fn(base.resolveTool) };
  mockStore = createCommerceStore(service);
  jest.spyOn(commerceService, 'getCommerceService').mockReturnValue(service);
});
afterEach(() => { AppState.currentState = initialAppState; jest.restoreAllMocks(); });

async function mount(): Promise<ScreenView> {
  const view = await render(<EndlessGameScreen {...props()} />);
  await fireEvent(view.getByTestId('launch-play-area'), 'layout', { nativeEvent: { layout: { width: 390, height: 844 } } });
  return view;
}

function pressHandler(view: ScreenView, id: string): () => void {
  // Match fireEvent's handler lookup but batch both taps before a rerender.
  let fiber = view.getByTestId(id).unstable_fiber;
  while (fiber && typeof fiber.memoizedProps?.onPress !== 'function') fiber = fiber.return;
  if (!fiber) throw new Error('Expected a press handler');
  return fiber.memoizedProps.onPress;
}

describe('paid tools in the playable screen', () => {
  test('Preview confirmation can be cancelled without debiting or arming the tool', async () => {
    const view = await mount();
    await fireEvent.press(view.getByTestId('tool-preview'));
    expect(view.getByTestId('tool-confirmation')).toBeTruthy();
    expect(canvas().previewActive).toBe(false);
    await fireEvent.press(view.getByTestId('tool-confirm-cancel'));
    expect(view.queryByTestId('tool-confirmation')).toBeNull();
    expect(canvas().previewActive).toBe(false);
    expect(service.redeemTool).not.toHaveBeenCalled();
  });

  test('confirmed paid Preview delivers once after acknowledgement despite same-frame double taps', async () => {
    const view = await mount();
    await fireEvent.press(view.getByTestId('tool-preview'));
    const press = pressHandler(view, 'tool-confirm-buy');
    await act(async () => { press(); press(); });
    expect(service.redeemTool).toHaveBeenCalledTimes(1);
    expect(service.resolveTool).toHaveBeenCalledTimes(1);
    expect(mockStore.getState().wallet?.points).toBe(90);
    expect(canvas().previewActive).toBe(true);
    expect(view.queryByTestId('tool-confirmation')).toBeNull();
    expect(canvas().state.launches).toBe(0);
  });

  test('Get points buys only a points pack and closing the shop never activates the pending tool', async () => {
    // A newer verified wallet may have spent the previously displayed points.
    service.getWallet.mockResolvedValue({ points: 0, revision: 2, environment: 'sandbox' });
    const view = await mount();
    await fireEvent.press(view.getByTestId('tool-preview'));
    await fireEvent.press(view.getByTestId('tool-get-points'));
    await fireEvent.press(view.getByTestId('points-guest-disclosure'));
    await fireEvent.press(view.getByTestId('buy-pullthread_points_100'));
    expect(service.purchasePoints).toHaveBeenCalledTimes(1);
    expect(service.redeemTool).not.toHaveBeenCalled();
    expect(canvas().previewActive).toBe(false);
    await fireEvent.press(view.getByTestId('points-shop-close'));
    expect(service.redeemTool).not.toHaveBeenCalled();
    expect(canvas().previewActive).toBe(false);
  });

  test('reconnecting an interrupted debit restores its tool once and cannot overwrite a newer wallet revision', async () => {
    const original = service.redeemTool.getMockImplementation()!;
    service.redeemTool.mockImplementationOnce(async (input) => { await original(input); throw new Error('connection lost'); });
    const view = await mount();
    await fireEvent.press(view.getByTestId('tool-preview'));
    await fireEvent.press(view.getByTestId('tool-confirm-buy'));
    expect(view.getByTestId('tool-recovery')).toBeTruthy();
    expect(canvas().previewActive).toBe(false);
    await act(() => mockStore.getState().acceptWallet({ points: 75, revision: 10, environment: 'sandbox' }));
    await fireEvent.press(view.getByTestId('tool-recovery-retry'));
    expect(view.queryByTestId('tool-recovery')).toBeNull();
    expect(canvas().previewActive).toBe(true);
    expect(service.redeemTool).toHaveBeenCalledTimes(1);
    expect(service.getRedemption).toHaveBeenCalledTimes(1);
    expect(mockStore.getState().wallet).toEqual({ points: 75, revision: 10, environment: 'sandbox' });
  });
});
