import { describe, expect, test } from '@jest/globals';

import {
  INITIAL_TUTORIAL_FLOW,
  createTutorialFlowState,
  getTutorialStep,
  tutorialFlowReducer,
} from '../tutorialFlow';

describe('tutorial flow', () => {
  test('exposes the three accepted tutorial presentations verbatim', () => {
    expect(getTutorialStep('pull')).toEqual({
      id: 'pull',
      title: 'Pull the cloth',
      detail: 'Drag a long stitch beside the button.',
      number: 1,
      count: 3,
      progressLabel: '1 of 3',
    });
    expect(getTutorialStep('route')).toEqual({
      id: 'route',
      title: 'Read the route',
      detail: 'The dotted path shows where the button will roll.',
      number: 2,
      count: 3,
      progressLabel: '2 of 3',
    });
    expect(getTutorialStep('release')).toEqual({
      id: 'release',
      title: 'Let gravity work',
      detail: 'Tap Release and watch the cloth solve it.',
      number: 3,
      count: 3,
      progressLabel: '3 of 3',
    });
  });

  test('advances through commit, successful route, and Release events', () => {
    const route = tutorialFlowReducer(INITIAL_TUTORIAL_FLOW, {
      type: 'stitchCommitted',
    });
    const release = tutorialFlowReducer(route, { type: 'routeSucceeded' });
    const completed = tutorialFlowReducer(release, { type: 'released' });

    expect(route).toEqual({ step: 'route', completed: false });
    expect(release).toEqual({ step: 'release', completed: false });
    expect(completed).toEqual({ step: 'release', completed: true });
  });

  test('does not let events without a stitch turn the guide into a gameplay gate', () => {
    expect(
      tutorialFlowReducer(INITIAL_TUTORIAL_FLOW, { type: 'released' }),
    ).toBe(INITIAL_TUTORIAL_FLOW);
    expect(
      tutorialFlowReducer(INITIAL_TUTORIAL_FLOW, { type: 'routeSucceeded' }),
    ).toBe(INITIAL_TUTORIAL_FLOW);

    const route = tutorialFlowReducer(INITIAL_TUTORIAL_FLOW, {
      type: 'stitchCommitted',
    });
    expect(tutorialFlowReducer(route, { type: 'released' })).toEqual({
      step: 'release',
      completed: true,
    });
  });

  test('returns to the first hint when all stitches are cleared', () => {
    const route = tutorialFlowReducer(INITIAL_TUTORIAL_FLOW, {
      type: 'stitchCommitted',
    });

    expect(
      tutorialFlowReducer(route, { type: 'stitchesCleared' }),
    ).toBe(INITIAL_TUTORIAL_FLOW);
  });

  test('returns to route guidance when an edited preview stops succeeding', () => {
    const route = tutorialFlowReducer(INITIAL_TUTORIAL_FLOW, {
      type: 'stitchCommitted',
    });
    const release = tutorialFlowReducer(route, { type: 'routeSucceeded' });

    expect(tutorialFlowReducer(release, { type: 'routeFailed' })).toEqual({
      step: 'route',
      completed: false,
    });
  });

  test('skips from any step and never reopens a completed guide', () => {
    const skipped = tutorialFlowReducer(INITIAL_TUTORIAL_FLOW, {
      type: 'skipped',
    });

    expect(skipped).toEqual({ step: 'pull', completed: true });
    expect(
      tutorialFlowReducer(skipped, { type: 'stitchCommitted' }),
    ).toBe(skipped);
    expect(
      tutorialFlowReducer(skipped, { type: 'stitchesCleared' }),
    ).toBe(skipped);
  });

  test('creates a closed flow from a persisted completion preference', () => {
    expect(createTutorialFlowState()).toBe(INITIAL_TUTORIAL_FLOW);
    expect(createTutorialFlowState(true)).toEqual({
      step: 'release',
      completed: true,
    });
  });
});
