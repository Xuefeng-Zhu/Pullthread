/** @jest-environment node */
import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, within } from '@testing-library/react-native';

import { resetPreferencesStoreForTests, usePreferencesStore } from '../../../store/usePreferencesStore';
import { SettingsScreen } from '../SettingsScreen';

describe('SettingsScreen', () => {
  beforeEach(async () => { await resetPreferencesStoreForTests(); });

  test('contains the five game preferences and updates each saved value', async () => {
    const view = await render(<SettingsScreen navigation={{ goBack: jest.fn() }} />);
    expect(view.getByText('Settings')).toBeTruthy();
    expect(view.getByText('Changes save on this device.')).toBeTruthy();
    expect(view.getAllByRole('switch')).toHaveLength(5);
    await fireEvent(view.getByTestId('sound-switch'), 'valueChange', false);
    await fireEvent(view.getByTestId('haptics-switch'), 'valueChange', false);
    await fireEvent(view.getByTestId('reduced-motion-switch'), 'valueChange', true);
    await fireEvent(view.getByTestId('high-contrast-switch'), 'valueChange', true);
    await fireEvent(view.getByTestId('tutorial-hints-switch'), 'valueChange', false);
    expect(usePreferencesStore.getState()).toMatchObject({
      soundEnabled: false, hapticsEnabled: false, reducedMotionEnabled: true,
      highContrastEnabled: true, tutorialHintsEnabled: false,
    });
    expect(within(view.getByTestId('reduced-motion-switch-row')).getByText('ON')).toBeTruthy();
    await view.unmount();
  });

  test('Done is the only navigation action and returns to the current run', async () => {
    const goBack = jest.fn();
    const view = await render(<SettingsScreen navigation={{ goBack }} />);
    expect(view.getAllByRole('button')).toHaveLength(1);
    expect(view.queryByText('Full Atelier')).toBeNull();
    expect(view.queryByTestId('settings-classic-button')).toBeNull();
    expect(view.queryByTestId('settings-restore-button')).toBeNull();
    expect(view.queryByTestId('entitlement-debug-panel')).toBeNull();
    await fireEvent.press(view.getByTestId('settings-done-button'));
    expect(goBack).toHaveBeenCalledTimes(1);
    await view.unmount();
  });
});
