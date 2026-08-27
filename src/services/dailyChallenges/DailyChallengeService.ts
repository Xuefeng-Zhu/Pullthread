import type {
  DailyChallenge,
  DailyLeaderboardEntry,
  DailyRun,
} from '../../game/daily';

export type DailyServiceStatus = 'local' | 'remote' | 'offline';
export type DailySubmissionSyncStatus =
  | 'local'
  | 'remote'
  | 'expired'
  | 'pending'
  | 'volatile';

export interface DailySubmissionResult {
  readonly accepted: boolean;
  readonly isNewBest: boolean;
  readonly personalBest: DailyRun;
  readonly syncStatus: DailySubmissionSyncStatus;
  readonly message: string;
}

export interface DailyChallengeService {
  readonly kind: 'local' | 'firebase';
  readonly status: DailyServiceStatus;
  getTodayChallenge(): Promise<DailyChallenge>;
  submitRun(run: DailyRun): Promise<DailySubmissionResult>;
  getPersonalBest(challengeId: string): Promise<DailyRun | null>;
  getLeaderboard(challengeId: string): Promise<DailyLeaderboardEntry[]>;
}
