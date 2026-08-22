import { describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';

import { GameControls } from '../GameControls';

describe('GameControls', () => {
  test('wires reachable planning controls', async () => {
    const onUndo = jest.fn();
    const onReset = jest.fn();
    const onRelease = jest.fn();
    const onRetry = jest.fn();
    const view = await render(
      <GameControls
        phase="planning"
        canUndo
        onUndo={onUndo}
        onReset={onReset}
        onRelease={onRelease}
        onRetry={onRetry}
      />,
    );

    await fireEvent.press(view.getByTestId('undo-button'));
    await fireEvent.press(view.getByTestId('reset-button'));
    await fireEvent.press(view.getByTestId('release-button'));

    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onRelease).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  test('exposes a retry action after a terminal run', async () => {
    const onRetry = jest.fn();
    const view = await render(
      <GameControls
        phase="failed"
        canUndo
        onUndo={jest.fn()}
        onReset={jest.fn()}
        onRelease={jest.fn()}
        onRetry={onRetry}
      />,
    );

    await fireEvent.press(view.getByTestId('retry-button'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(view.getByTestId('undo-button').props.accessibilityState).toEqual({
      disabled: true,
    });
  });
});
