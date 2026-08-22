import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, within } from '@testing-library/react-native';

import {
  resetPreferencesStoreForTests,
  usePreferencesStore,
} from '../../../store/usePreferencesStore';
import { SettingsScreen } from '../SettingsScreen';

describe('SettingsScreen', () => {
  beforeEach(resetPreferencesStoreForTests);

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
});
