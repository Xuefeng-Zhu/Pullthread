import type { CommerceEnvironment, CommerceWallet, ToolKind } from '../commerce/contracts';
export const WEEK_MS = 7 * 86400000;
export const RULESET = 'stitched-v4-weekly-3';
export const MAX_BATCH_TICKS = 240;
export const MAX_BATCH_COMMANDS = 64;
export const PRIZES = [100, 50, 25] as const;
export function weekStart(now: number): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - (date.getUTCDay() + 6) % 7);
}
export type ReplayAction = { type: 'aim' } | { type: 'cancel' } | { type: 'launch'; x: number; y: number }
  | { type: 'tool'; tool: ToolKind; pocketId?: string; operationId?: string };
export type ReplayCommand = ReplayAction & { at: number };
export interface ReplayBatch { sequence: number; from: number; to: number; commands: ReplayCommand[] }
export interface RankedRun { id: string; seed: number; week: number; deadline: number; ruleset: string; uid: string; environment: CommerceEnvironment }
export interface Standing { alias: string; score: number; rank: number }
export interface Award { week: number; rank: number; points: number }
export interface Standings {
  uid: string; week: number; deadline: number; serverTime: number; prizesEnabled: boolean;
  leaders: Standing[]; own: Standing | null; previous: Standing[]; awards: Award[]; wallet: CommerceWallet;
}
export interface LeaderboardService {
  getAccountId(): Promise<string>;
  register(requestId: string): Promise<RankedRun>;
  upload(runId: string, batch: ReplayBatch): Promise<{ sequence: number; score: number }>;
  standings(): Promise<Standings>;
}
