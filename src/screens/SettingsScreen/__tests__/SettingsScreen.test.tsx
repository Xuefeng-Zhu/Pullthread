import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import {
  fireEvent,
  render,
  waitFor,
  within,
} from '@testing-library/react-native';

import { MockEntitlementService } from '../../../services/entitlements';
import { CAMPAIGN_LEVELS } from '../../../game/levels/campaignLevels';
import { useCampaignProgressStore } from '../../../store/useCampaignProgressStore';
import {
  initializeEntitlements,
  resetEntitlementStoreForTests,
  selectHasFullGame,
  useEntitlementStore,
} from '../../../store/useEntitlementStore';
import {
  resetPreferencesStoreForTests,
  usePreferencesStore,
} from '../../../store/usePreferencesStore';
import { SettingsScreen } from '../SettingsScreen';

describe('SettingsScreen', () => {
  beforeEach(async () => {
    await resetPreferencesStoreForTests();
    await resetEntitlementStoreForTests();
    useCampaignProgressStore.setState({ progressByLevel: {} });
  });

  test('exposes the saved settings copy and updates every preference', async () => {
    const view = await render(
      <SettingsScreen navigation={{ goBack: jest.fn() }} />,
    );

    expect(view.getByText('Settings')).toBeTruthy();
    expect(view.getByText('Changes save on this device.')).toBeTruthy();

    await fireEvent(view.getByTestId('sound-switch'), 'valueChange', false);
    await fireEvent(view.getByTestId('haptics-switch'), 'valueChange', false);
    await fireEvent(
      view.getByTestId('reduced-motion-switch'),
      'valueChange',
      true,
    );
    await fireEvent(
      view.getByTestId('high-contrast-switch'),
      'valueChange',
      true,
    );
    await fireEvent(
      view.getByTestId('tutorial-hints-switch'),
      'valueChange',
      false,
    );

    expect(usePreferencesStore.getState()).toMatchObject({
      soundEnabled: false,
      hapticsEnabled: false,
      reducedMotionEnabled: true,
      highContrastEnabled: true,
      tutorialHintsEnabled: false,
    });
    expect(
      within(view.getByTestId('reduced-motion-switch-row')).getByText('ON'),
    ).toBeTruthy();
  });

  test('returns through the Done action', async () => {
    const goBack = jest.fn();
    const view = await render(<SettingsScreen navigation={{ goBack }} />);

    await fireEvent.press(view.getByTestId('settings-done-button'));

    expect(goBack).toHaveBeenCalledTimes(1);
  });

  test('restores Full Atelier from the explicit settings action', async () => {
    await initializeEntitlements(
      new MockEntitlementService({ restoreOutcome: 'restored' }),
    );
    const view = await render(
      <SettingsScreen navigation={{ goBack: jest.fn() }} />,
    );

    expect(view.getByTestId('settings-entitlement-status').props.children).toBe(
      'FREE CAMPAIGN — LEVELS 1–6',
    );
    await fireEvent.press(view.getByTestId('settings-restore-button'));

    await waitFor(() => {
      expect(
        useEntitlementStore.getState().hasFullGame,
      ).toBe(true);
      expect(
        view.getByTestId('settings-entitlement-status').props.children,
      ).toBe('FULL ATELIER OWNED — LEVELS 7–15 INCLUDED');
      expect(view.getByText('Full Atelier purchase restored.')).toBeTruthy();
    });
  });

  test('exposes a development-only entitlement override', async () => {
    const view = await render(
      <SettingsScreen navigation={{ goBack: jest.fn() }} />,
    );

    expect(view.getByTestId('entitlement-debug-panel')).toBeTruthy();
    await fireEvent.press(view.getByTestId('debug-entitlement-unlock'));
    expect(selectHasFullGame(useEntitlementStore.getState())).toBe(true);
    expect(
      view.getByText('FULL ATELIER OWNED — LEVELS 7–15 INCLUDED'),
    ).toBeTruthy();

    await fireEvent.press(view.getByTestId('debug-entitlement-lock'));
    expect(selectHasFullGame(useEntitlementStore.getState())).toBe(false);
    expect(view.getByText('FREE CAMPAIGN — LEVELS 1–6')).toBeTruthy();

    await fireEvent.press(
      view.getByTestId('debug-entitlement-follow-service'),
    );
    expect(useEntitlementStore.getState().debugOverride).toBeNull();

    await fireEvent.press(view.getByTestId('debug-complete-free-campaign'));
    expect(
      Object.keys(useCampaignProgressStore.getState().progressByLevel),
    ).toEqual(CAMPAIGN_LEVELS.slice(0, 6).map((level) => level.id));
  });
});
