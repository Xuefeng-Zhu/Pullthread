export const feedbackCues = [
  'fabricTouch',
  'threadDraw',
  'threadTick',
  'stitchComplete',
  'travelerRelease',
  'travelerRoll',
  'buttonClick',
  'success',
  'failure',
] as const;

export type FeedbackCue = (typeof feedbackCues)[number];

export type FeedbackPreferences = Readonly<{
  hapticsEnabled: boolean;
  soundEnabled: boolean;
}>;

export const defaultFeedbackPreferences: FeedbackPreferences = {
  hapticsEnabled: true,
  soundEnabled: true,
};

/**
 * Platform-neutral tactile/audio feedback used by gameplay and UI code.
 * Implementations must treat feedback as best effort and never block gameplay.
 */
export interface FeedbackService {
  readonly preferences: FeedbackPreferences;

  setPreferences(preferences: Partial<FeedbackPreferences>): void;
  play(cue: FeedbackCue): Promise<void>;
  dispose(): void;
}

/** Safe fallback for tests and runtimes where native feedback is unavailable. */
export class NoopFeedbackService implements FeedbackService {
  private currentPreferences: FeedbackPreferences;

  constructor(preferences: Partial<FeedbackPreferences> = {}) {
    this.currentPreferences = {
      ...defaultFeedbackPreferences,
      ...preferences,
    };
  }

  get preferences(): FeedbackPreferences {
    return this.currentPreferences;
  }

  setPreferences(preferences: Partial<FeedbackPreferences>): void {
    this.currentPreferences = {
      ...this.currentPreferences,
      ...preferences,
    };
  }

  async play(_cue: FeedbackCue): Promise<void> {}

  dispose(): void {}
}
