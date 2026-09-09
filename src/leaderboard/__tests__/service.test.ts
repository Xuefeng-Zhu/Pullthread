/** @jest-environment node */
import { beforeEach, expect, jest, test } from '@jest/globals';
import { createLeaderboardService } from '../service';
import { RULESET } from '../contracts';
import type { NativeCommerceRuntime } from '../../services/commerce/nativeService';

jest.mock('../../services/commerce/config', () => ({
  readCommerceConfig: () => ({ platform: 'ios', environment: 'sandbox', firebase: { apiKey: 'test-public-key' } }),
  resolveCommerceBackend: () => ({ provider: 'workers' }),
}));

const ranked = { id: 'ranked-run', uid: 'player', seed: 42, week: 0, deadline: 1000, ruleset: RULESET, environment: 'sandbox' };
const call = jest.fn<NativeCommerceRuntime['call']>();
beforeEach(() => {
  call.mockReset().mockResolvedValue(ranked);
});
const service = () => createLeaderboardService(async () => ({ authenticate: async () => 'player', call } as unknown as NativeCommerceRuntime));

test('new clients request their exact replay ruleset at registration', async () => {
  expect(await service().register('register-request')).toEqual(ranked);
  expect(call).toHaveBeenCalledWith('weeklyRegister', { environment: 'sandbox', requestId: 'register-request', ruleset: RULESET });
});

test.each(['stitched-v4-weekly-3', 'stitched-v5-weekly-1'])('a returned %s run cannot silently use the current engine', async ruleset => {
  call.mockResolvedValue({ ...ranked, ruleset });
  await expect(service().register('prior-request')).rejects.toThrow('Invalid ranked run response');
});
