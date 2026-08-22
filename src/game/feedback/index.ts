import { ExpoFeedbackService } from './ExpoFeedbackService';

export {
  defaultFeedbackPreferences,
  feedbackCues,
  NoopFeedbackService,
  type FeedbackCue,
  type FeedbackPreferences,
  type FeedbackService,
} from './FeedbackService';
export { ExpoFeedbackService };

/** App-wide lazy-native feedback instance. Importing it has no native side effects. */
export const feedbackService = new ExpoFeedbackService();
