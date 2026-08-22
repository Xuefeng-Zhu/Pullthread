import { describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, within } from '@testing-library/react-native';

import { PreferenceSwitchRow } from '../PreferenceSwitchRow';

describe('PreferenceSwitchRow', () => {
  test('shows and announces the on state', async () => {
    const onValueChange = jest.fn();
    const view = await render(
      <PreferenceSwitchRow
        testID="sound-switch"
        label="Sound"
        icon="volume-high-outline"
        value
        onValueChange={onValueChange}
      />,
    );

    const row = view.getByTestId('sound-switch-row');
    const toggle = view.getByTestId('sound-switch');
    expect(within(row).getByText('ON')).toBeTruthy();
    expect(toggle.props.accessibilityState).toEqual({ checked: true });

    await fireEvent(toggle, 'valueChange', false);
    expect(onValueChange).toHaveBeenCalledWith(false);
  });

  test('renders an explicit off label', async () => {
    const view = await render(
      <PreferenceSwitchRow
        testID="motion-switch"
        label="Reduced motion"
        icon="ellipse-outline"
        value={false}
        onValueChange={jest.fn()}
      />,
    );

    expect(
      within(view.getByTestId('motion-switch-row')).getByText('OFF'),
    ).toBeTruthy();
  });
});
