import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import {
  compareDailyMetrics,
  getTodayDailyChallenge,
  parseDailyChallenge,
  parseDailyReplay,
  parseDailyRun,
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

async function ensureAnonymousUser(auth: Auth): Promise<string> {
  if (auth.currentUser) return auth.currentUser.uid;
  const { signInAnonymously } = await import('firebase/auth');
  return (await signInAnonymously(auth)).user.uid;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseRemoteEntry(
  id: string,
  rank: number,
  value: unknown,
  challenge: DailyChallenge,
  uid: string,
): DailyLeaderboardEntry {
  if (!isRecord(value) || !isRecord(value.metrics)) {
    throw new TypeError('Firebase Daily Scrap entry is malformed.');
  }
  const run = parseDailyRun({
    clientRunId: value.clientRunId,
    challengeId: challenge.id,
    challengeDate: challenge.challengeDate,
    metrics: value.metrics,
    replay: value.replay,
    createdAt: value.createdAt,
  });
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
  submitRun(run: DailyRun): Promise<boolean>;
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

  async submitRun(run: DailyRun): Promise<boolean> {
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
    if (!isRecord(response.data) || typeof response.data.isNewBest !== 'boolean') {
      throw new TypeError('Firebase submission returned an invalid response.');
    }
    return response.data.isNewBest;
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

/** Local-first Firebase decorator. Every successful run is saved locally first. */
export class FirebaseDailyChallengeService implements DailyChallengeService {
  readonly kind = 'firebase' as const;
  private connectionStatus: DailyServiceStatus = 'remote';
  private pendingFlush: Promise<boolean> | null = null;

  constructor(
    private readonly local = new LocalDailyChallengeService(),
    private readonly clock: () => Date = () => new Date(),
    private readonly remote: FirebaseDailyRemoteGateway =
      new SdkFirebaseDailyRemoteGateway(),
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
    try {
      const pending = (await this.local.getPendingRuns()).find(
        (candidate) => candidate.challengeId === validated.challengeId,
      );
      let currentRunProcessedRemotely = false;
      let localPersistenceRecovered = false;
      if (pending) {
        await this.uploadRun(pending);
        currentRunProcessedRemotely =
          pending.clientRunId === validated.clientRunId;
        localPersistenceRecovered = await this.local.markRunSynced(pending);
      } else {
        await this.remote.ensureGuest();
      }
      this.connectionStatus = 'remote';
      const savedOnDevice = localResult.accepted || localPersistenceRecovered;
      if (!savedOnDevice && !currentRunProcessedRemotely) {
        return Object.freeze({
          ...localResult,
          syncStatus: 'volatile',
          message:
            'Kept for this session only. Device storage is unavailable.',
        });
      }
      return Object.freeze({
        ...localResult,
        accepted: true,
        syncStatus: 'remote',
        message: savedOnDevice
          ? localResult.isNewBest
            ? 'Saved on this device and shared as a new best.'
            : 'Saved on this device. Your shared best still leads this attempt.'
          : 'Shared successfully, but device storage is unavailable.',
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

  async getLeaderboard(challengeId: string): Promise<DailyLeaderboardEntry[]> {
    const challenge = getTodayDailyChallenge(this.clock);
    if (challengeId !== challenge.id) return this.local.getLeaderboard(challengeId);
    try {
      const pendingSynced = await this.flushPendingRuns();
      const entries = await this.remote.getLeaderboard(challenge);
      this.connectionStatus = pendingSynced ? 'remote' : 'offline';
      return entries.length > 0
        ? entries
        : this.local.getLeaderboard(challengeId);
    } catch {
      this.connectionStatus = 'offline';
      return this.local.getLeaderboard(challengeId);
    }
  }

  private async uploadRun(run: DailyRun): Promise<boolean> {
    return this.remote.submitRun(run);
  }

  private async flushPendingRuns(): Promise<boolean> {
    if (this.pendingFlush) return this.pendingFlush;

    const pendingFlush = this.flushPendingRunsOnce();
    this.pendingFlush = pendingFlush;
    try {
      return await pendingFlush;
    } finally {
      if (this.pendingFlush === pendingFlush) this.pendingFlush = null;
    }
  }

  private async flushPendingRunsOnce(): Promise<boolean> {
    try {
      const oldestUploadDate = utcChallengeDate(
        new Date(this.clock().getTime() - ONE_DAY_MS),
      );
      for (const pending of await this.local.getPendingRuns()) {
        if (pending.challengeDate < oldestUploadDate) {
          // The callable deliberately accepts only today and yesterday. Drop a
          // permanently expired local queue item so it cannot head-of-line
          // block newer offline work forever.
          await this.local.markRunSynced(pending);
          continue;
        }
        await this.uploadRun(pending);
        await this.local.markRunSynced(pending);
      }
      this.connectionStatus = 'remote';
      return true;
    } catch {
      this.connectionStatus = 'offline';
      return false;
    }
  }
}

export function createDailyChallengeService(): DailyChallengeService {
  return isFirebaseDailyConfigured()
    ? new FirebaseDailyChallengeService()
    : new LocalDailyChallengeService();
}

export function resetFirebaseDailyClientsForTests(): void {
  clientsPromise = null;
}
