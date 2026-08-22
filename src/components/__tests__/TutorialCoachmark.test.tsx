import { describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';

import { TutorialCoachmark } from '../TutorialCoachmark';

describe('TutorialCoachmark', () => {
  test('renders the accepted first-step copy and progress', async () => {
    const view = await render(
      <TutorialCoachmark step="pull" onSkip={jest.fn()} />,
    );

    expect(view.getByTestId('tutorial-coachmark')).toBeTruthy();
    expect(view.getByTestId('tutorial-step-title').props.children).toBe(
      'Pull the cloth',
    );
    expect(view.getByTestId('tutorial-step-detail').props.children).toBe(
      'Drag a long stitch beside the button.',
    );
    expect(view.getByTestId('tutorial-progress').props.children).toBe('1 of 3');
  });

  test.each([
    [
      'route' as const,
      'Read the route',
      'The dotted path shows where the button will roll.',
      '2 of 3',
    ],
    [
      'release' as const,
      'Let gravity work',
      'Tap Release and watch the cloth solve it.',
      '3 of 3',
    ],
  ])('renders the %s presentation', async (step, title, detail, progress) => {
    const view = await render(
      <TutorialCoachmark step={step} onSkip={jest.fn()} />,
    );

    expect(view.getByText(title)).toBeTruthy();
    expect(view.getByText(detail)).toBeTruthy();
    expect(view.getByTestId('tutorial-progress').props.children).toBe(progress);
  });

  test('exposes a reachable, labelled Skip action', async () => {
    const onSkip = jest.fn();
    const view = await render(
      <TutorialCoachmark step="route" onSkip={onSkip} />,
    );
    const skip = view.getByTestId('tutorial-skip-button');

    expect(skip.props.accessibilityRole).toBe('button');
    expect(skip.props.accessibilityLabel).toBe('Skip tutorial hints');
    expect(view.getByTestId('tutorial-progress').props.accessibilityLabel).toBe(
      'Tutorial step 2 of 3',
    );

    await fireEvent.press(skip);
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  test('offers a reachable route acknowledgement when provided', async () => {
    const onNext = jest.fn();
    const view = await render(
      <TutorialCoachmark
        step="route"
        onSkip={jest.fn()}
        onNext={onNext}
      />,
    );
    const next = view.getByTestId('tutorial-next-button');

    expect(next.props.accessibilityState).toEqual({ disabled: false });
    await fireEvent.press(next);
    expect(onNext).toHaveBeenCalledTimes(1);
  });
});
