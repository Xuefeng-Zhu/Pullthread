import { readCommerceConfig, resolveCommerceBackend } from '../services/commerce/config';
import type { LeaderboardService, RankedRun, Standings } from './contracts';
import { RULESET } from './contracts';
import { readWallet } from '../services/commerce/validation';
export function createLeaderboardService(): LeaderboardService {
  const config = readCommerceConfig();
  const call = async (name: string, payload: Record<string, unknown>) => {
    if (!['ios', 'android'].includes(config.platform) || !config.environment || !config.firebase.apiKey
      || resolveCommerceBackend(config).provider !== 'workers') throw new Error('Weekly competition is available in the connected mobile app.');
    const runtime = await (await import('../services/commerce/nativeRuntime')).loadNativeRuntime(config, true);
    const uid = await runtime.authenticate();
    return { uid, result: await runtime.call(name, { environment: config.environment, ...payload }) };
  };
  return {
    getAccountId: async () => {
      const runtime = await (await import('../services/commerce/nativeRuntime')).loadNativeRuntime(config, true);
      return runtime.authenticate();
    },
    register: async (requestId) => {
      const { uid, result } = await call('weeklyRegister', { requestId });
      const run = result as RankedRun;
      if (!run || run.uid !== uid || run.environment !== config.environment || run.ruleset !== RULESET
        || typeof run.id !== 'string' || !Number.isInteger(run.seed) || !Number.isSafeInteger(run.deadline)) throw new Error('Invalid ranked run response.');
      return run;
    },
    upload: async (runId, batch) => {
      const { result } = await call('weeklyUpload', { runId, batch });
      const response = result as { sequence: number; score: number };
      if (response?.sequence !== batch.sequence || !Number.isSafeInteger(response.score) || response.score < 0) throw new Error('Invalid score response.');
      return response;
    },
    standings: async () => {
      const { uid, result } = await call('weeklyStandings', {});
      const board = result as Standings;
      if (!board || board.uid !== uid || !Array.isArray(board.leaders) || !Array.isArray(board.previous) || !Array.isArray(board.awards)
        || !Number.isSafeInteger(board.deadline) || !Number.isSafeInteger(board.serverTime) || typeof board.prizesEnabled !== 'boolean') throw new Error('Invalid leaderboard response.');
      readWallet(board.wallet, config.environment!);
      return board;
    },
  };
}
export const leaderboardService = createLeaderboardService();
