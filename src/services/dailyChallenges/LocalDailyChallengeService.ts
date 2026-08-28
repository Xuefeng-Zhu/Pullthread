import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  getTodayDailyChallenge,
  compareDailyMetrics,
  parseDailyRun,
  selectDailyBest,
  type DailyChallenge,
  type DailyLeaderboardEntry,
  type DailyRun,
} from '../../game/daily';
import type {
  DailyChallengeService,
  DailySubmissionResult,
} from './DailyChallengeService';

export const DAILY_SCRAP_STORAGE_KEY = 'pullthread.daily-scrap';
export const DAILY_SCRAP_STORAGE_VERSION = 1 as const;

export interface DailyKeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface LocalGuestProfile {
  readonly id: string;
  readonly displayName: string;
}

interface PersistedDailyScrapState {
  readonly version: typeof DAILY_SCRAP_STORAGE_VERSION;
  readonly profile: LocalGuestProfile;
  readonly bestRunsByChallenge: Readonly<Record<string, DailyRun>>;
  readonly pendingRunsByChallenge: Readonly<Record<string, DailyRun>>;
  readonly attemptsByChallenge: Readonly<Record<string, number>>;
}

const PROFILE_ID_PATTERN = /^local-[a-z0-9-]{8,80}$/;
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizedDisplayName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized.length >= 1 && normalized.length <= 24 ? normalized : null;
}

function createLocalGuestProfile(now = new Date()): LocalGuestProfile {
  const timestamp = Number.isFinite(now.getTime()) ? now.getTime() : Date.now();
  const random = Math.floor(Math.random() * 0x100000000)
    .toString(36)
    .padStart(7, '0');
  const id = `local-${timestamp.toString(36)}-${random}`;
  const label = (timestamp % 10_000).toString().padStart(4, '0');
  return Object.freeze({ id, displayName: `Quilter ${label}` });
}

function sanitizeProfile(value: unknown): LocalGuestProfile | null {
  if (!isRecord(value) || typeof value.id !== 'string') return null;
  const displayName = sanitizedDisplayName(value.displayName);
  if (!PROFILE_ID_PATTERN.test(value.id) || !displayName) return null;
  return Object.freeze({ id: value.id, displayName });
}

function sanitizeRunMap(value: unknown): Record<string, DailyRun> {
  if (!isRecord(value)) return {};
  const sanitized: Record<string, DailyRun> = {};
  for (const [challengeId, rawRun] of Object.entries(value)) {
    try {
      const run = parseDailyRun(rawRun);
      if (run.challengeId === challengeId) sanitized[challengeId] = run;
    } catch {
      // Drop only the malformed challenge record; other local bests survive.
    }
  }
  return sanitized;
}

function sanitizeAttempts(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  const sanitized: Record<string, number> = {};
  for (const [challengeId, count] of Object.entries(value)) {
    if (Number.isSafeInteger(count) && (count as number) >= 0) {
      sanitized[challengeId] = count as number;
    }
  }
  return sanitized;
}

function defaultState(): PersistedDailyScrapState {
  return {
    version: DAILY_SCRAP_STORAGE_VERSION,
    profile: createLocalGuestProfile(),
    bestRunsByChallenge: {},
    pendingRunsByChallenge: {},
    attemptsByChallenge: {},
  };
}

/** Treats the entire AsyncStorage payload as untrusted and salvages valid days. */
export function sanitizePersistedDailyScrapState(
  value: unknown,
): PersistedDailyScrapState {
  if (!isRecord(value)) return defaultState();
  return {
    version: DAILY_SCRAP_STORAGE_VERSION,
    profile: sanitizeProfile(value.profile) ?? createLocalGuestProfile(),
    bestRunsByChallenge: sanitizeRunMap(value.bestRunsByChallenge),
    pendingRunsByChallenge: sanitizeRunMap(value.pendingRunsByChallenge),
    attemptsByChallenge: sanitizeAttempts(value.attemptsByChallenge),
  };
}

export class LocalDailyChallengeService implements DailyChallengeService {
  readonly kind = 'local' as const;
  readonly status = 'local' as const;
  private statePromise: Promise<PersistedDailyScrapState> | null = null;
  private mutationQueue: Promise<void> = Promise.resolve();
  private storageBaseline: 'unknown' | 'verified' | 'unavailable' = 'unknown';

  constructor(
    private readonly storage: DailyKeyValueStorage = AsyncStorage,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async getTodayChallenge(): Promise<DailyChallenge> {
    return getTodayDailyChallenge(this.clock);
  }

  async submitRun(run: DailyRun): Promise<DailySubmissionResult> {
    const candidate = parseDailyRun(run);
    let isNewBest = false;
    let personalBest = candidate;

    const persisted = await this.mutate((state) => {
      const incumbent = state.bestRunsByChallenge[candidate.challengeId] ?? null;
      if (
        incumbent?.clientRunId === candidate.clientRunId &&
        JSON.stringify(incumbent) !== JSON.stringify(candidate)
      ) {
        throw new RangeError('Daily client run id was reused with different replay data.');
      }
      isNewBest =
        !incumbent || compareDailyMetrics(candidate.metrics, incumbent.metrics) < 0;
      personalBest = selectDailyBest(candidate, incumbent);
      const pendingIncumbent =
        state.pendingRunsByChallenge[candidate.challengeId] ?? null;
      const pendingBest = isNewBest
        ? selectDailyBest(candidate, pendingIncumbent)
        : pendingIncumbent;
      const attempts = state.attemptsByChallenge[candidate.challengeId] ?? 0;

      return {
        ...state,
        bestRunsByChallenge: {
          ...state.bestRunsByChallenge,
          [candidate.challengeId]: personalBest,
        },
        pendingRunsByChallenge: pendingBest
          ? {
              ...state.pendingRunsByChallenge,
              [candidate.challengeId]: pendingBest,
            }
          : state.pendingRunsByChallenge,
        attemptsByChallenge: {
          ...state.attemptsByChallenge,
          [candidate.challengeId]: attempts + 1,
        },
      };
    });

    return Object.freeze({
      accepted: persisted,
      isNewBest,
      personalBest,
      syncStatus: persisted ? 'local' : 'volatile',
      message: persisted
        ? 'Saved on this device.'
        : 'Kept for this session only. Device storage is unavailable.',
    });
  }

  async getLeaderboard(challengeId: string): Promise<DailyLeaderboardEntry[]> {
    await this.mutationQueue;
    const state = await this.loadState();
    const best = state.bestRunsByChallenge[challengeId];
    if (!best) return [];

    return [
      Object.freeze({
        id: best.clientRunId,
        rank: 1,
        displayName: state.profile.displayName,
        metrics: best.metrics,
        replay: best.replay,
        isCurrentPlayer: true,
      }),
    ];
  }

  async getPersonalBest(challengeId: string): Promise<DailyRun | null> {
    await this.mutationQueue;
    return (await this.loadState()).bestRunsByChallenge[challengeId] ?? null;
  }

  async getProfile(): Promise<LocalGuestProfile> {
    await this.mutationQueue;
    return (await this.loadState()).profile;
  }

  async getPendingRuns(): Promise<readonly DailyRun[]> {
    await this.mutationQueue;
    const state = await this.loadState();
    return Object.values(state.pendingRunsByChallenge);
  }

  async markRunSynced(run: DailyRun): Promise<boolean> {
    const validated = parseDailyRun(run);
    return this.mutate((state) => {
      const pending = state.pendingRunsByChallenge[validated.challengeId];
      if (!pending || pending.clientRunId !== validated.clientRunId) return state;
      const nextPending = { ...state.pendingRunsByChallenge };
      delete nextPending[validated.challengeId];
      return { ...state, pendingRunsByChallenge: nextPending };
    });
  }

  /**
   * Applies the server-authoritative incumbent without losing a newer local
   * pending best. When `syncedRun` is supplied, clearing that exact queue item
   * and reconciling the best happen in one AsyncStorage write.
   */
  async reconcileRemoteBest(
    authoritativeInput: DailyRun,
    syncedInput: DailyRun | null = null,
  ): Promise<boolean> {
    const authoritative = parseDailyRun(authoritativeInput);
    const syncedRun = syncedInput ? parseDailyRun(syncedInput) : null;
    if (
      syncedRun &&
      syncedRun.challengeId !== authoritative.challengeId
    ) {
      throw new RangeError(
        'Synced Daily run and authoritative best must share a challenge.',
      );
    }

    return this.mutate((state) => {
      const incumbent =
        state.bestRunsByChallenge[authoritative.challengeId] ?? null;
      // The remote run is the tie-stable incumbent. A strictly better offline
      // run still wins and remains queued for its own upload.
      const personalBest = incumbent
        ? selectDailyBest(incumbent, authoritative)
        : authoritative;
      const pending =
        state.pendingRunsByChallenge[authoritative.challengeId] ?? null;
      const shouldClearPending =
        Boolean(syncedRun) &&
        pending?.clientRunId === syncedRun?.clientRunId;
      const bestUnchanged =
        incumbent?.clientRunId === personalBest.clientRunId;
      if (!shouldClearPending && bestUnchanged) return state;

      const nextPending: Record<string, DailyRun> = {
        ...state.pendingRunsByChallenge,
      };
      if (shouldClearPending) delete nextPending[authoritative.challengeId];
      return {
        ...state,
        bestRunsByChallenge: {
          ...state.bestRunsByChallenge,
          [authoritative.challengeId]: personalBest,
        },
        pendingRunsByChallenge: nextPending,
      };
    });
  }

  async attemptsForChallenge(challengeId: string): Promise<number> {
    await this.mutationQueue;
    return (await this.loadState()).attemptsByChallenge[challengeId] ?? 0;
  }

  private async loadState(): Promise<PersistedDailyScrapState> {
    if (!this.statePromise) {
      this.statePromise = (async () => {
        let serialized: string | null;
        try {
          serialized = await this.storage.getItem(DAILY_SCRAP_STORAGE_KEY);
          this.storageBaseline = 'verified';
        } catch {
          // An I/O failure is not evidence that storage was empty. Keep a
          // volatile session state, but quarantine writes for this service
          // instance so an unknown existing payload cannot be overwritten.
          this.storageBaseline = 'unavailable';
          return defaultState();
        }
        if (!serialized) return defaultState();
        try {
          return sanitizePersistedDailyScrapState(
            JSON.parse(serialized) as unknown,
          );
        } catch {
          // A successful read establishes a safe baseline even when its JSON
          // is malformed; the invalid payload may be replaced on the next save.
          return defaultState();
        }
      })();
    }
    return this.statePromise;
  }

  private async saveState(state: PersistedDailyScrapState): Promise<boolean> {
    this.statePromise = Promise.resolve(state);
    if (this.storageBaseline === 'unavailable') return false;
    try {
      await this.storage.setItem(DAILY_SCRAP_STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch {
      // Keep the in-memory state usable, but let the caller report that it is
      // volatile rather than claiming the run was saved on the device.
      return false;
    }
  }

  private async mutate(
    updater: (state: PersistedDailyScrapState) => PersistedDailyScrapState,
  ): Promise<boolean> {
    const operation = this.mutationQueue.then(async () => {
      const current = await this.loadState();
      const updated = updater(current);
      return updated === current
        ? this.storageBaseline !== 'unavailable'
        : this.saveState(updated);
    });
    this.mutationQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }
}
