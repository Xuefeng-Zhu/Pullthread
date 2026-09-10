/** @jest-environment node */
import { act, fireEvent, render, within } from '@testing-library/react-native';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ComponentProps } from 'react';
import MockReact from 'react';
import { AccessibilityInfo, AppState, type AppStateStatus, View as MockView } from 'react-native';
import type { CommerceService } from '../../../commerce/contracts';
import * as endless from '../../../game/launch/endless';
import { grantFreeTool } from '../../../game/launch/toolInventory';
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

async function mount(width = 390, height = 844): Promise<ScreenView> {
  const view = await render(<EndlessGameScreen {...props()} />);
  await fireEvent(view.getByTestId('launch-play-area'), 'layout', { nativeEvent: { layout: { width, height } } });
  return view;
}

async function selectToolboxTool(view: ScreenView, tool: 'preview' | 'teleport') {
  await fireEvent.press(view.getByTestId('tool-box'));
  await fireEvent.press(view.getByTestId(`toolbox-${tool}`));
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
    await selectToolboxTool(view, 'preview');
    expect(view.getByTestId('tool-confirmation')).toBeTruthy();
    expect(canvas().previewActive).toBe(false);
    await fireEvent.press(view.getByTestId('tool-confirm-cancel'));
    expect(view.queryByTestId('tool-confirmation')).toBeNull();
    expect(canvas().previewActive).toBe(false);
    expect(service.redeemTool).not.toHaveBeenCalled();
  });

  test('confirmed paid Preview delivers once after acknowledgement despite same-frame double taps', async () => {
    const view = await mount();
    await selectToolboxTool(view, 'preview');
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
    await selectToolboxTool(view, 'preview');
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
    await selectToolboxTool(view, 'preview');
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

  test('the single pickup row has no fixed tool shortcuts and the toolbox shows all nine tools', async () => {
    const view = await mount(320, 568);
    for (const kind of ['preview', 'teleport', 'revive']) expect(view.queryByTestId(`tool-${kind}`)).toBeNull();
    for (let slot = 0; slot < 3; slot++) expect(view.getByTestId(`free-tool-slots-${slot}`)).toBeTruthy();
    await fireEvent.press(view.getByTestId('tool-box'));
    expect(view.getByTestId('toolbox-scroll')).toBeTruthy();
    for (const kind of ['preview', 'teleport', 'revive', 'bounce', 'pin', 'velcro', 'sail', 'needle', 'stitch']) expect(view.getByTestId(`toolbox-${kind}`)).toBeTruthy();
    await fireEvent.press(view.getByTestId('toolbox-sail'));
    expect(view.getByTestId('tool-setup-sail')).toBeTruthy();
    expect(view.queryByTestId('launch-hud')).toBeNull();
    expect(view.queryByTestId('launch-tool-tray')).toBeNull();
    expect(canvas().state.toolEffects?.sail).toBeUndefined();
    await fireEvent.press(view.getByTestId('tool-setup-cancel'));
    expect(service.redeemTool).not.toHaveBeenCalled();
    expect(canvas().state.toolEffects?.sail).toBeUndefined();
  });

  test('different paid tools combine with Preview while duplicate preparations are disabled', async () => {
    const view = await mount();
    for (const kind of ['sail', 'needle']) {
      await fireEvent.press(view.getByTestId('tool-box'));
      await fireEvent.press(view.getByTestId(`toolbox-${kind}`));
      await fireEvent.press(view.getByTestId('tool-setup-confirm'));
    }
    expect(canvas().state.toolEffects).toMatchObject({ sail: true, needle: {} });
    expect(service.redeemTool).toHaveBeenCalledTimes(2);
    expect(mockStore.getState().wallet?.points).toBe(70);
    await fireEvent.press(view.getByTestId('tool-box'));
    expect(view.getByTestId('toolbox-sail').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(view.getByTestId('toolbox-close'));
    await selectToolboxTool(view, 'preview');
    await fireEvent.press(view.getByTestId('tool-confirm-buy'));
    expect(canvas().previewActive).toBe(true);
    expect(canvas().state.toolEffects).toMatchObject({ sail: true, needle: {} });
  });

  test('confirmed creative tools consume a free pickup before considering points', async () => {
    const original = endless.createEndlessRun;
    jest.spyOn(endless, 'createEndlessRun').mockImplementationOnce(seed => {
      const run = original(seed);
      grantFreeTool(run, 'preview');
      grantFreeTool(run, 'sail');
      grantFreeTool(run, 'needle');
      return run;
    });
    const view = await mount();
    expect(view.getByTestId('free-tool-slots').props.accessibilityLabel).toBe('Free tools, 3 of 3. Oldest to newest: Preview, Silk Sail, Needle Tip. The next pickup replaces Preview.');
    for (const kind of ['preview', 'sail', 'needle']) expect(view.getByTestId(`tool-${kind}`)).toBeTruthy();
    await fireEvent.press(view.getByTestId('tool-box'));
    expect(view.getByTestId('toolbox-free-slots').props.accessibilityLabel).toContain('Free tools, 3 of 3.');
    expect(view.getByText('Oldest on the left. When full, a pickup replaces your oldest free tool.')).toBeTruthy();
    await fireEvent.press(view.getByTestId('toolbox-close'));
    await fireEvent.press(view.getByTestId('tool-sail'));
    expect(view.getByText('Use free tool')).toBeTruthy();
    await fireEvent.press(view.getByTestId('tool-setup-confirm'));
    expect(canvas().state.toolEffects?.sail).toBe(true);
    expect(service.redeemTool).not.toHaveBeenCalled();
    expect(mockStore.getState().wallet?.points).toBe(100);
    expect(view.getByTestId('free-tool-slots').props.accessibilityLabel).toBe('Free tools, 2 of 3. Oldest to newest: Preview, Needle Tip.');
    expect(view.getByTestId('prepared-tools').props.children.join('')).toBe('Ready: Silk Sail');
    await fireEvent.press(view.getByTestId('tool-box'));
    expect(view.getByTestId('toolbox-sail').props.accessibilityLabel).toContain('0 free');
  });

  test('historical uncapped runs keep their inventory and omit the three-slot rule', async () => {
    const original = endless.createEndlessRun;
    jest.spyOn(endless, 'createEndlessRun').mockImplementationOnce(seed => {
      const run = original(seed, 5);
      for (let charge = 0; charge < 4; charge++) grantFreeTool(run, 'sail');
      return run;
    });
    const view = await mount(320, 568);
    expect(view.getByTestId('free-tool-slots')).toBeTruthy();
    expect(view.getAllByTestId('tool-sail').length).toBeGreaterThan(0);
    await fireEvent.press(view.getByTestId('tool-box'));
    expect(view.queryByTestId('toolbox-free-slots')).toBeNull();
    expect(view.queryByText('Oldest on the left. When full, a pickup replaces your oldest free tool.')).toBeNull();
    expect(view.getByTestId('toolbox-sail').props.accessibilityLabel).toContain('4 free');
  });

  test('bounce adjustment stays a draft until exact position and angle are confirmed', async () => {
    const view = await mount();
    await fireEvent.press(view.getByTestId('tool-box'));
    await fireEvent.press(view.getByTestId('toolbox-bounce'));
    await fireEvent.press(view.getByTestId('tool-valid-position'));
    await fireEvent.press(view.getByTestId('tool-angle-increase'));
    expect(canvas().state.toolEffects?.bounce).toBeUndefined();
    expect(service.redeemTool).not.toHaveBeenCalled();
    await fireEvent.press(view.getByTestId('tool-setup-confirm'));
    expect(canvas().state.toolEffects?.bounce?.angle).toBe(5);
    const request = service.redeemTool.mock.calls[0][0];
    expect(request.tool).toBe('bounce');
    expect(request.contextKey).toContain('"angle":5');
    expect(request.contextKey).toContain('"position":');
    expect(request.expectedCost).toBe(15);
  });

  test('Land requires confirmation before discarding prepared tools', async () => {
    const view = await mount();
    await fireEvent.press(view.getByTestId('tool-box'));
    await fireEvent.press(view.getByTestId('toolbox-sail'));
    await fireEvent.press(view.getByTestId('tool-setup-confirm'));
    await selectToolboxTool(view, 'teleport');
    await fireEvent.press(view.getAllByLabelText(/Land in visible pocket/)[0]);
    expect(view.getByTestId('land-discard-warning')).toBeTruthy();
    expect(canvas().state.toolEffects?.sail).toBe(true);
    await fireEvent.press(view.getByTestId('tool-confirm-cancel'));
    expect(canvas().state.toolEffects?.sail).toBe(true);
    expect(service.redeemTool).toHaveBeenCalledTimes(1);
  });


  test('a creative draft survives the points shop without activation or advancing the frozen run', async () => {
    service.getWallet.mockResolvedValue({ points: 0, revision: 2, environment: 'sandbox' });
    const view = await mount();
    await fireEvent.press(view.getByTestId('tool-box'));
    await fireEvent.press(view.getByTestId('toolbox-bounce'));
    await fireEvent.press(view.getByTestId('tool-valid-position'));
    await fireEvent.press(view.getByTestId('tool-angle-increase'));
    const before = view.getByTestId('tool-placement-draft').props.style;
    const tick = canvas().motion.tick.value;
    await fireEvent.press(view.getByTestId('tool-setup-points'));
    expect(view.queryByTestId('tool-setup-bounce')).toBeNull();
    await fireEvent.press(view.getByTestId('points-shop-close'));
    expect(view.getByTestId('tool-setup-bounce')).toBeTruthy();
    expect(view.getByTestId('tool-placement-draft').props.style).toEqual(before);
    expect(canvas().motion.tick.value).toBe(tick);
    expect(canvas().state.toolEffects?.bounce).toBeUndefined();
    expect(service.redeemTool).not.toHaveBeenCalled();
  });

  test('Preview alone survives Land without a creative-tool discard warning', async () => {
    const view = await mount();
    await selectToolboxTool(view, 'preview');
    await fireEvent.press(view.getByTestId('tool-confirm-buy'));
    await selectToolboxTool(view, 'teleport');
    await fireEvent.press(view.getAllByLabelText(/Land in visible pocket/)[0]);
    expect(view.queryByTestId('land-discard-warning')).toBeNull();
    await fireEvent.press(view.getByTestId('tool-confirm-buy'));
    expect(canvas().previewActive).toBe(true);
  });


  test('a prepared temporary pocket remains selectable for a combined Velcro patch', async () => {
    const view = await mount(320, 568);
    await fireEvent.press(view.getByTestId('tool-box'));
    await fireEvent.press(view.getByTestId('toolbox-stitch'));
    await fireEvent.press(view.getByTestId('tool-valid-position'));
    await fireEvent.press(view.getByTestId('tool-setup-confirm'));
    const pocketId = canvas().state.stitchedPocket!.pocket.id;
    await fireEvent.press(view.getByTestId('tool-box'));
    await fireEvent.press(view.getByTestId('toolbox-velcro'));
    await fireEvent.press(view.getByTestId(`tool-target-${pocketId}`));
    await fireEvent.press(view.getByTestId('tool-setup-confirm'));
    expect(canvas().state.toolEffects?.velcro?.targetId).toBe(pocketId);
    expect(canvas().state.stitchedPocket?.pocket.id).toBe(pocketId);
  });


  test('a compact setup uses space freed by a tall HUD and prepared-tool tray', async () => {
    const view = await mount(320, 568);
    await fireEvent(view.getByTestId('launch-hud'), 'layout', { nativeEvent: { layout: { width: 296, height: 200 } } });
    await fireEvent(view.getByTestId('launch-tool-tray'), 'layout', { nativeEvent: { layout: { width: 296, height: 100 } } });
    await fireEvent.press(view.getByTestId('tool-box'));
    await fireEvent.press(view.getByTestId('toolbox-velcro'));
    expect(view.queryByTestId('launch-hud')).toBeNull();
    await fireEvent.press(view.getByTestId('tool-target-endless-2'));
    expect(view.getByTestId('tool-setup-confirm').props.accessibilityState.disabled).toBe(false);
    await fireEvent.press(view.getByTestId('tool-setup-cancel'));
    expect(view.getByTestId('launch-hud')).toBeTruthy();
    expect(service.redeemTool).not.toHaveBeenCalled();
  });


  test('setup cancellation and the exact purchase cost stay outside scrolling details on a compact screen', async () => {
    const view = await mount(320, 568);
    await fireEvent.press(view.getByTestId('tool-box'));
    await fireEvent.press(view.getByTestId('toolbox-bounce'));
    const details = within(view.getByTestId('tool-setup-details'));
    const footer = within(view.getByTestId('tool-setup-footer'));
    expect(details.queryByTestId('tool-setup-cancel')).toBeNull();
    expect(details.queryByTestId('tool-setup-confirm')).toBeNull();
    expect(footer.getByText('15 points · 100 available')).toBeTruthy();
    expect(footer.getByTestId('tool-setup-confirm')).toBeTruthy();
    await fireEvent.press(footer.getByTestId('tool-setup-cancel'));
    expect(view.queryByTestId('tool-setup-bounce')).toBeNull();
    expect(service.redeemTool).not.toHaveBeenCalled();
  });


  test('backgrounding and resuming a creative setup keeps its frozen selection and never consumes a charge', async () => {
    const listeners = new Set<(state: AppStateStatus) => void>();
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
      listeners.add(listener); return { remove: () => { listeners.delete(listener); } };
    });
    const frames = new Map<number, FrameRequestCallback>();
    let nextId = 0, timestamp = 0;
    jest.mocked(global.requestAnimationFrame).mockImplementation(callback => {
      const id = ++nextId; frames.set(id, callback); return id;
    });
    jest.mocked(global.cancelAnimationFrame).mockImplementation(id => { if (typeof id === 'number') frames.delete(id); });
    const frame = async (elapsed: number) => {
      await act(() => { timestamp += elapsed; const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(timestamp)); });
    };
    const changeState = async (state: AppStateStatus) => {
      await act(() => { AppState.currentState = state; [...listeners].forEach(listener => listener(state)); });
    };
    const view = await mount(320, 568);
    await frame(16);
    await fireEvent.press(view.getByTestId('tool-box'));
    await fireEvent.press(view.getByTestId('toolbox-bounce'));
    await fireEvent.press(view.getByTestId('tool-valid-position'));
    await fireEvent.press(view.getByTestId('tool-angle-increase'));
    const draft = view.getByTestId('tool-placement-draft').props.style;
    const tick = canvas().motion.tick.value;
    await changeState('background');
    await frame(30_000);
    await changeState('active');
    await frame(30_000);
    expect(view.getByTestId('tool-placement-draft').props.style).toEqual(draft);
    expect(canvas().motion.tick.value).toBe(tick);
    expect(canvas().state.toolEffects?.bounce).toBeUndefined();
    expect(service.redeemTool).not.toHaveBeenCalled();
    await fireEvent.press(view.getByTestId('tool-setup-cancel'));
    await frame(30_000);
    expect(canvas().motion.tick.value).toBe(tick);
    await frame(1000 / 60);
    expect(canvas().motion.tick.value).toBe(tick + 2);
    await view.unmount();
  });

});
