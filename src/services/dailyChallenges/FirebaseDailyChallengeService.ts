import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import {
  compareDailyMetrics,
  DAILY_SUBMISSION_MIN_INTERVAL_MS,
  getTodayDailyChallenge,
  parseDailyChallenge,
  parseDailyReplay,
  parseDailyRun,
  selectDailyBest,
  utcChallengeDate,
  type DailyChallenge,
  type DailyLeaderboardEntry,
  type DailyRun,
} from '../../game/daily';
import type {
  DailyChallengeService,
  DailyServiceStatus,
  DailySubmissionResult,
} from './DailyChallengeService';
import { LocalDailyChallengeService } from './LocalDailyChallengeService';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

interface FirebasePublicConfig {
  readonly apiKey: string;
  readonly authDomain: string;
  readonly projectId: string;
  readonly appId: string;
}

function firebasePublicConfig(): FirebasePublicConfig | null {
  const apiKey = process.env.EXPO_PUBLIC_FIREBASE_API_KEY?.trim();
  const authDomain = process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN?.trim();
  const projectId = process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID?.trim();
  const appId = process.env.EXPO_PUBLIC_FIREBASE_APP_ID?.trim();
  return apiKey && authDomain && projectId && appId
    ? { apiKey, authDomain, projectId, appId }
    : null;
}

export function isFirebaseDailyConfigured(): boolean {
  return (
    process.env.EXPO_PUBLIC_DAILY_SERVICE === 'firebase' &&
    firebasePublicConfig() !== null
  );
}

type Auth = import('firebase/auth').Auth;
type Persistence = import('firebase/auth').Persistence;
type ReactNativeAsyncStorage = import('firebase/auth').ReactNativeAsyncStorage;
type Firestore = import('firebase/firestore').Firestore;
type Functions = import('firebase/functions').Functions;

interface FirebaseClients {
  readonly auth: Auth;
  readonly db: Firestore;
  readonly functions: Functions;
}

let clientsPromise: Promise<FirebaseClients> | null = null;
let anonymousSignIns = new WeakMap<Auth, Promise<string>>();

async function getFirebaseClients(): Promise<FirebaseClients> {
  if (!clientsPromise) {
    clientsPromise = (async () => {
      const config = firebasePublicConfig();
      if (!config) throw new Error('Firebase Daily Scrap is not configured.');
      const appModule = await import('firebase/app');
      const authModule = (await import('firebase/auth')) as unknown as typeof import('firebase/auth') & {
          getReactNativePersistence: (
            storage: ReactNativeAsyncStorage,
          ) => Persistence;
        };
      const firestoreModule = await import('firebase/firestore');
      const functionsModule = await import('firebase/functions');
      const existing = appModule
        .getApps()
        .find((candidate) => candidate.name === 'pullthread-daily');
      const app = existing ?? appModule.initializeApp(config, 'pullthread-daily');
      let auth: Auth;
      try {
        if (
          Platform.OS === 'web' ||
          typeof authModule.getReactNativePersistence !== 'function'
        ) {
          throw new Error('Use the platform-default Firebase Auth persistence.');
        }
        auth = authModule.initializeAuth(app, {
          persistence: authModule.getReactNativePersistence(AsyncStorage),
        });
      } catch {
        auth = authModule.getAuth(app);
      }
      return {
        auth,
        db: firestoreModule.getFirestore(app),
        functions: functionsModule.getFunctions(app, 'us-west1'),
      };
    })();
  }
  return clientsPromise;
}

type AnonymousSignIn = (
  auth: Auth,
) => Promise<{ readonly user: { readonly uid: string } }>;

export async function ensureAnonymousUser(
  auth: Auth,
  signIn?: AnonymousSignIn,
): Promise<string> {
  if (auth.currentUser) return auth.currentUser.uid;
  const activeSignIn = anonymousSignIns.get(auth);
  if (activeSignIn) return activeSignIn;

  const pendingSignIn = (async () => {
    const signInUser =
      signIn ?? (await import('firebase/auth')).signInAnonymously;
    return (await signInUser(auth)).user.uid;
  })();
  anonymousSignIns.set(auth, pendingSignIn);
  try {
    return await pendingSignIn;
  } finally {
    if (anonymousSignIns.get(auth) === pendingSignIn) {
      anonymousSignIns.delete(auth);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseRemoteRun(
  value: unknown,
  challenge: DailyChallenge,
): DailyRun {
  if (!isRecord(value) || !isRecord(value.metrics)) {
    throw new TypeError('Firebase Daily Scrap run is malformed.');
  }
  return parseDailyRun({
    clientRunId: value.clientRunId,
    challengeId: challenge.id,
    challengeDate: challenge.challengeDate,
    metrics: value.metrics,
    replay: value.replay,
    createdAt: value.createdAt,
  });
}

export interface FirebaseDailyRemoteSubmission {
  readonly isNewBest: boolean;
  readonly personalBest: DailyRun;
}

export function parseFirebaseDailySubmissionResponse(
  value: unknown,
  submittedInput: DailyRun,
): FirebaseDailyRemoteSubmission {
  const submitted = parseDailyRun(submittedInput);
  if (
    !isRecord(value) ||
    value.accepted !== true ||
    typeof value.isNewBest !== 'boolean'
  ) {
    throw new TypeError('Firebase submission returned an invalid response.');
  }
  const personalBest = parseDailyRun(value.personalBest);
  if (
    personalBest.challengeId !== submitted.challengeId ||
    personalBest.challengeDate !== submitted.challengeDate ||
    compareDailyMetrics(personalBest.metrics, submitted.metrics) > 0 ||
    (value.isNewBest && personalBest.clientRunId !== submitted.clientRunId)
  ) {
    throw new RangeError(
      'Firebase submission returned an invalid authoritative best.',
    );
  }
  return Object.freeze({
    isNewBest: value.isNewBest,
    personalBest,
  });
}

function parseRemoteEntry(
  id: string,
  rank: number,
  value: unknown,
  challenge: DailyChallenge,
  uid: string,
): DailyLeaderboardEntry {
  if (!isRecord(value)) {
    throw new TypeError('Firebase Daily Scrap entry is malformed.');
  }
  const run = parseRemoteRun(value, challenge);
  const displayName =
    typeof value.displayName === 'string' && value.displayName.trim().length > 0
      ? value.displayName.trim().slice(0, 24)
      : 'Guest Quilter';
  return Object.freeze({
    id,
    rank,
    displayName,
    metrics: run.metrics,
    replay: parseDailyReplay(run.replay, challenge),
    isCurrentPlayer: value.userId === uid,
  });
}

export interface FirebaseDailyRemoteGateway {
  checkChallenge(challenge: DailyChallenge): Promise<void>;
  ensureGuest(): Promise<void>;
  submitRun(run: DailyRun): Promise<FirebaseDailyRemoteSubmission>;
  getPersonalBest(challenge: DailyChallenge): Promise<DailyRun | null>;
  getLeaderboard(challenge: DailyChallenge): Promise<DailyLeaderboardEntry[]>;
}

class SdkFirebaseDailyRemoteGateway implements FirebaseDailyRemoteGateway {
  async checkChallenge(challenge: DailyChallenge): Promise<void> {
    const { db } = await getFirebaseClients();
    const { doc, getDoc } = await import('firebase/firestore');
    const snapshot = await getDoc(doc(db, 'daily_challenges', challenge.id));
    if (snapshot.exists()) parseDailyChallenge(snapshot.data());
  }

  async ensureGuest(): Promise<void> {
    const { auth } = await getFirebaseClients();
    await ensureAnonymousUser(auth);
  }

  async submitRun(run: DailyRun): Promise<FirebaseDailyRemoteSubmission> {
    const { auth, functions } = await getFirebaseClients();
    await ensureAnonymousUser(auth);
    const { httpsCallable } = await import('firebase/functions');
    const submit = httpsCallable(functions, 'submitDailyRun');
    const response = await submit({
      clientRunId: run.clientRunId,
      challengeId: run.challengeId,
      challengeDate: run.challengeDate,
      replay: run.replay,
      createdAt: run.createdAt,
    });
    return parseFirebaseDailySubmissionResponse(response.data, run);
  }

  async getPersonalBest(challenge: DailyChallenge): Promise<DailyRun | null> {
    const { auth, db } = await getFirebaseClients();
    const uid = await ensureAnonymousUser(auth);
    const { doc, getDoc } = await import('firebase/firestore');
    const snapshot = await getDoc(
      doc(db, 'daily_challenges', challenge.id, 'runs', uid),
    );
    return snapshot.exists()
      ? parseRemoteRun(snapshot.data(), challenge)
      : null;
  }

  async getLeaderboard(
    challenge: DailyChallenge,
  ): Promise<DailyLeaderboardEntry[]> {
    const { auth, db } = await getFirebaseClients();
    const uid = await ensureAnonymousUser(auth);
    const { collection, getDocs, limit, orderBy, query } = await import(
      'firebase/firestore'
    );
    const snapshot = await getDocs(
      query(
        collection(db, 'daily_challenges', challenge.id, 'runs'),
        orderBy('metrics.threadUsed', 'asc'),
        orderBy('metrics.stitchesUsed', 'asc'),
        orderBy('metrics.completionMs', 'asc'),
        orderBy('createdAt', 'asc'),
        limit(50),
      ),
    );
    const entries: DailyLeaderboardEntry[] = [];
    let displayedRank = 0;
    let previous: DailyLeaderboardEntry | null = null;
    for (const document of snapshot.docs) {
      const positionalRank = entries.length + 1;
      const parsed = parseRemoteEntry(
        document.id,
        positionalRank,
        document.data(),
        challenge,
        uid,
      );
      if (!previous || compareDailyMetrics(parsed.metrics, previous.metrics) !== 0) {
        displayedRank = positionalRank;
      }
      const ranked = Object.freeze({ ...parsed, rank: displayedRank });
      entries.push(ranked);
      previous = ranked;
    }
    return entries;
  }
}

interface ReconciledRemoteSubmission extends FirebaseDailyRemoteSubmission {
  readonly localPersisted: boolean;
}

interface PendingFlushOutcome {
  readonly synced: boolean;
  readonly submissions: ReadonlyMap<string, ReconciledRemoteSubmission>;
  readonly expiredRunIds: ReadonlySet<string>;
}

type PendingSyncResult =
  | { readonly kind: 'remote'; readonly submission: ReconciledRemoteSubmission }
  | { readonly kind: 'expired' }
  | { readonly kind: 'failed' };

type DailyDelay = (milliseconds: number) => Promise<void>;

function defaultDailyDelay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Local-first Firebase decorator. Every successful run is saved locally first. */
export class FirebaseDailyChallengeService implements DailyChallengeService {
  readonly kind = 'firebase' as const;
  private connectionStatus: DailyServiceStatus = 'remote';
  private pendingFlush: Promise<PendingFlushOutcome> | null = null;
  private lastSuccessfulUploadAt: number | null = null;

  constructor(
    private readonly local = new LocalDailyChallengeService(),
    private readonly clock: () => Date = () => new Date(),
    private readonly remote: FirebaseDailyRemoteGateway =
      new SdkFirebaseDailyRemoteGateway(),
    private readonly delay: DailyDelay = defaultDailyDelay,
  ) {}

  get status(): DailyServiceStatus {
    return this.connectionStatus;
  }

  async getTodayChallenge(): Promise<DailyChallenge> {
    const localChallenge = getTodayDailyChallenge(this.clock);
    void this.checkRemoteChallenge(localChallenge);
    return localChallenge;
  }

  private async checkRemoteChallenge(
    localChallenge: DailyChallenge,
  ): Promise<void> {
    try {
      await this.remote.checkChallenge(localChallenge);
      this.connectionStatus = 'remote';
      void this.flushPendingRuns();
    } catch {
      this.connectionStatus = 'offline';
    }
  }

  async submitRun(run: DailyRun): Promise<DailySubmissionResult> {
    const validated = parseDailyRun(run);
    const localResult = await this.local.submitRun(validated);
    if (this.isUploadExpired(validated)) {
      await this.clearPendingChallenge(validated.challengeId);
      return this.expiredSubmissionResult(localResult);
    }
    try {
      const pending = (await this.local.getPendingRuns()).find(
        (candidate) => candidate.challengeId === validated.challengeId,
      );
      let remoteSubmission: ReconciledRemoteSubmission | null = null;
      let currentRunProcessedRemotely = false;
      if (pending) {
        const pendingSync = await this.syncPendingRun(pending);
        if (pendingSync.kind === 'expired') {
          return this.expiredSubmissionResult(localResult);
        }
        if (pendingSync.kind === 'failed') {
          throw new Error('The pending Daily Scrap run did not sync.');
        }
        remoteSubmission = pendingSync.submission;
        currentRunProcessedRemotely =
          pending.clientRunId === validated.clientRunId;
      } else {
        await this.remote.ensureGuest();
      }
      this.connectionStatus = 'remote';
      const personalBest = remoteSubmission
        ? selectDailyBest(
            localResult.personalBest,
            remoteSubmission.personalBest,
          )
        : localResult.personalBest;
      const isNewBest = currentRunProcessedRemotely && remoteSubmission
        ? remoteSubmission.isNewBest
        : localResult.isNewBest;
      const savedOnDevice = remoteSubmission
        ? remoteSubmission.localPersisted ||
          (localResult.accepted &&
            localResult.personalBest.clientRunId === personalBest.clientRunId)
        : localResult.accepted;
      const accepted =
        savedOnDevice || Boolean(remoteSubmission) || currentRunProcessedRemotely;
      if (!accepted) {
        return Object.freeze({
          ...localResult,
          isNewBest,
          personalBest,
          syncStatus: 'volatile',
          message:
            'Kept for this session only. Device storage is unavailable.',
        });
      }
      return Object.freeze({
        ...localResult,
        accepted: true,
        isNewBest,
        personalBest,
        syncStatus: 'remote',
        message: savedOnDevice
          ? isNewBest
            ? 'Saved on this device and shared as a new best.'
            : 'Saved on this device. Your shared best still leads this attempt.'
          : isNewBest
            ? 'Shared as a new best, but device storage is unavailable.'
            : 'Shared best is up to date, but device storage is unavailable.',
      });
    } catch {
      this.connectionStatus = 'offline';
      if (!localResult.accepted) {
        return Object.freeze({
          ...localResult,
          syncStatus: 'volatile',
          message:
            'Kept for this session only. Device storage and the shared board are unavailable.',
        });
      }
      return Object.freeze({
        ...localResult,
        syncStatus: 'pending',
        message: 'Saved on this device. Shared board will retry when online.',
      });
    }
  }

  async getPersonalBest(challengeId: string): Promise<DailyRun | null> {
    const challenge = getTodayDailyChallenge(this.clock);
    if (challengeId !== challenge.id) {
      return this.local.getPersonalBest(challengeId);
    }
    await this.flushPendingRuns();
    const localBest = await this.local.getPersonalBest(challengeId);
    try {
      const remoteBest = await this.remote.getPersonalBest(challenge);
      if (!remoteBest) return localBest;
      await this.local.reconcileRemoteBest(remoteBest);
      return (await this.local.getPersonalBest(challengeId)) ?? remoteBest;
    } catch {
      return localBest;
    }
  }

  async getLeaderboard(challengeId: string): Promise<DailyLeaderboardEntry[]> {
    const challenge = getTodayDailyChallenge(this.clock);
    if (challengeId !== challenge.id) return this.local.getLeaderboard(challengeId);
    try {
      const pendingFlush = await this.flushPendingRuns();
      const entries = await this.remote.getLeaderboard(challenge);
      this.connectionStatus = pendingFlush.synced ? 'remote' : 'offline';
      return entries.length > 0
        ? entries
        : this.local.getLeaderboard(challengeId);
    } catch {
      this.connectionStatus = 'offline';
      return this.local.getLeaderboard(challengeId);
    }
  }

  private async uploadRun(
    run: DailyRun,
  ): Promise<FirebaseDailyRemoteSubmission> {
    if (this.lastSuccessfulUploadAt !== null) {
      const elapsedSinceUpload = Math.max(
        0,
        this.clock().getTime() - this.lastSuccessfulUploadAt,
      );
      const remainingCooldown =
        DAILY_SUBMISSION_MIN_INTERVAL_MS - elapsedSinceUpload;
      if (remainingCooldown > 0) await this.delay(remainingCooldown);
    }
    if (this.isUploadExpired(run)) {
      throw new RangeError('Daily Scrap run expired before upload.');
    }
    const submission = await this.remote.submitRun(run);
    this.lastSuccessfulUploadAt = this.clock().getTime();
    return submission;
  }

  private async syncPendingRun(
    pending: DailyRun,
  ): Promise<PendingSyncResult> {
    while (true) {
      const outcome = await this.flushPendingRuns();
      const submission = outcome.submissions.get(pending.clientRunId);
      if (submission) return { kind: 'remote', submission };
      if (outcome.expiredRunIds.has(pending.clientRunId)) {
        return { kind: 'expired' };
      }
      if (this.isUploadExpired(pending)) {
        await this.clearPendingChallenge(pending.challengeId);
        return { kind: 'expired' };
      }
      const stillPending = (await this.local.getPendingRuns()).some(
        (candidate) => candidate.clientRunId === pending.clientRunId,
      );
      if (!stillPending || !outcome.synced) return { kind: 'failed' };
      // The run was added or replaced after the active flush took its snapshot.
      // Start the next serialized cycle instead of uploading in parallel.
    }
  }

  private flushPendingRuns(): Promise<PendingFlushOutcome> {
    if (this.pendingFlush) return this.pendingFlush;
    const pendingFlush = (async () => {
      try {
        return await this.flushPendingRunsOnce();
      } finally {
        this.pendingFlush = null;
      }
    })();
    this.pendingFlush = pendingFlush;
    return pendingFlush;
  }

  private async flushPendingRunsOnce(): Promise<PendingFlushOutcome> {
    const submissions = new Map<string, ReconciledRemoteSubmission>();
    const expiredRunIds = new Set<string>();
    try {
      for (const pending of await this.local.getPendingRuns()) {
        if (this.isUploadExpired(pending)) {
          // The callable deliberately accepts only today and yesterday. Drop a
          // permanently expired local queue item so it cannot head-of-line
          // block newer offline work forever.
          await this.local.markRunSynced(pending);
          expiredRunIds.add(pending.clientRunId);
          continue;
        }
        let remoteSubmission: FirebaseDailyRemoteSubmission;
        try {
          remoteSubmission = await this.uploadRun(pending);
        } catch (error) {
          if (this.isUploadExpired(pending)) {
            await this.local.markRunSynced(pending);
            expiredRunIds.add(pending.clientRunId);
            continue;
          }
          throw error;
        }
        const localPersisted = await this.local.reconcileRemoteBest(
          remoteSubmission.personalBest,
          pending,
        );
        submissions.set(
          pending.clientRunId,
          Object.freeze({ ...remoteSubmission, localPersisted }),
        );
      }
      this.connectionStatus = 'remote';
      return Object.freeze({ synced: true, submissions, expiredRunIds });
    } catch {
      this.connectionStatus = 'offline';
      return Object.freeze({ synced: false, submissions, expiredRunIds });
    }
  }

  private isUploadExpired(run: DailyRun): boolean {
    const oldestUploadDate = utcChallengeDate(
      new Date(this.clock().getTime() - ONE_DAY_MS),
    );
    return run.challengeDate < oldestUploadDate;
  }

  private async clearPendingChallenge(challengeId: string): Promise<void> {
    const pending = (await this.local.getPendingRuns()).find(
      (candidate) => candidate.challengeId === challengeId,
    );
    if (pending) await this.local.markRunSynced(pending);
  }

  private expiredSubmissionResult(
    localResult: DailySubmissionResult,
  ): DailySubmissionResult {
    return Object.freeze({
      ...localResult,
      syncStatus: localResult.accepted ? 'expired' : 'volatile',
      message: localResult.accepted
        ? 'Saved on this device. This Daily Scrap is too old to share.'
        : 'Kept for this session only. This Daily Scrap is too old to share.',
    });
  }
}

export function createDailyChallengeService(): DailyChallengeService {
  return isFirebaseDailyConfigured()
    ? new FirebaseDailyChallengeService()
    : new LocalDailyChallengeService();
}

export function resetFirebaseDailyClientsForTests(): void {
  clientsPromise = null;
  anonymousSignIns = new WeakMap<Auth, Promise<string>>();
}
