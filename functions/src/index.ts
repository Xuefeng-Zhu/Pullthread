import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { validateDailyRunSubmission } from './domain';
import {
  ClientRunIdConflictError,
  persistBestDailyRun,
  SubmissionRateLimitError,
} from './persistence';

const app = initializeApp();
const database = getFirestore(app);

export const submitDailyRun = onCall<unknown>(
  {
    region: 'us-west1',
    memory: '256MiB',
    timeoutSeconds: 30,
    maxInstances: 5,
    enforceAppCheck: false,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError(
        'unauthenticated',
        'Sign in as a guest before submitting a Daily Scrap run.',
      );
    }

    if (!request.app) {
      logger.warn('Accepted an unattested private-beta Daily Scrap request.', {
        uid,
      });
    }

    let validated: ReturnType<typeof validateDailyRunSubmission>;
    try {
      validated = validateDailyRunSubmission(request.data);
    } catch (error) {
      logger.warn('Rejected invalid Daily Scrap submission.', {
        uid,
        reason: error instanceof Error ? error.message : 'unknown validation error',
      });
      throw new HttpsError(
        'invalid-argument',
        'The Daily Scrap replay is invalid or does not match its challenge.',
      );
    }

    try {
      const result = await persistBestDailyRun(
        database,
        uid,
        validated.challenge,
        validated.run,
      );

      return Object.freeze({
        accepted: true,
        isNewBest: result.isNewBest,
        personalBest: result.personalBest,
        syncStatus: 'remote' as const,
        message: result.isNewBest
          ? 'New Daily Scrap best synced.'
          : 'Run synced; your existing best still leads.',
      });
    } catch (error) {
      if (error instanceof ClientRunIdConflictError) {
        throw new HttpsError('already-exists', error.message);
      }

      if (error instanceof SubmissionRateLimitError) {
        throw new HttpsError('resource-exhausted', error.message, {
          retryAfterSeconds: error.retryAfterSeconds,
        });
      }

      logger.error('Could not persist Daily Scrap submission.', {
        uid,
        challengeId: validated.challenge.id,
        error,
      });
      throw new HttpsError(
        'internal',
        'The Daily Scrap run could not be saved. Try again later.',
      );
    }
  },
);
