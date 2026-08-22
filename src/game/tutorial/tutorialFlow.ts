export const TUTORIAL_STEPS = [
  {
    id: 'pull',
    title: 'Pull the cloth',
    detail: 'Drag a long stitch beside the button.',
  },
  {
    id: 'route',
    title: 'Read the route',
    detail: 'The dotted path shows where the button will roll.',
  },
  {
    id: 'release',
    title: 'Let gravity work',
    detail: 'Tap Release and watch the cloth solve it.',
  },
] as const;

export type TutorialStepId = (typeof TUTORIAL_STEPS)[number]['id'];

export interface TutorialStepPresentation {
  readonly id: TutorialStepId;
  readonly title: string;
  readonly detail: string;
  readonly number: number;
  readonly count: number;
  readonly progressLabel: string;
}

export interface TutorialFlowState {
  readonly step: TutorialStepId;
  readonly completed: boolean;
}

export type TutorialFlowEvent =
  | { readonly type: 'stitchCommitted' }
  | { readonly type: 'routeSucceeded' }
  | { readonly type: 'routeFailed' }
  | { readonly type: 'released' }
  | { readonly type: 'stitchesCleared' }
  | { readonly type: 'skipped' };

export const INITIAL_TUTORIAL_FLOW: TutorialFlowState = {
  step: 'pull',
  completed: false,
};

export function createTutorialFlowState(
  completed = false,
): TutorialFlowState {
  return completed
    ? { step: 'release', completed: true }
    : INITIAL_TUTORIAL_FLOW;
}

export function getTutorialStep(
  step: TutorialStepId,
): TutorialStepPresentation {
  const index = TUTORIAL_STEPS.findIndex((candidate) => candidate.id === step);
  const presentation = TUTORIAL_STEPS[index];
  const number = index + 1;

  return {
    ...presentation,
    number,
    count: TUTORIAL_STEPS.length,
    progressLabel: `${number} of ${TUTORIAL_STEPS.length}`,
  };
}

/**
 * Pure tutorial progression. Gameplay stays fully available when an event does
 * not match the current hint, so early Release and extra stitch events are
 * harmless instead of becoming tutorial gates.
 */
export function tutorialFlowReducer(
  state: TutorialFlowState,
  event: TutorialFlowEvent,
): TutorialFlowState {
  if (state.completed) return state;

  switch (event.type) {
    case 'stitchCommitted':
      return state.step === 'pull' ? { ...state, step: 'route' } : state;
    case 'routeSucceeded':
      return state.step === 'route' ? { ...state, step: 'release' } : state;
    case 'routeFailed':
      return state.step === 'release' ? { ...state, step: 'route' } : state;
    case 'released':
      return state.step === 'route' || state.step === 'release'
        ? { step: 'release', completed: true }
        : state;
    case 'stitchesCleared':
      return state.step === 'pull' ? state : INITIAL_TUTORIAL_FLOW;
    case 'skipped':
      return { ...state, completed: true };
  }
}
