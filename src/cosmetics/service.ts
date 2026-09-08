import { readCommerceConfig, resolveCommerceBackend } from '../services/commerce/config';
import { readWallet } from '../services/commerce/validation';
import { partById, type CosmeticAccount, type CosmeticService } from './catalog';

export function createCosmeticService(): CosmeticService {
  const config = readCommerceConfig();
  const runtime = async () => {
    if (config.mock || !['ios', 'android'].includes(config.platform) || !config.environment || !config.firebase.apiKey || resolveCommerceBackend(config).provider !== 'workers') throw new Error('Purchases are available in the connected mobile app.');
    return (await import('../services/commerce/nativeRuntime')).loadNativeRuntime(config, 'cosmetics');
  };
  const call = async (endpoint: string, payload: Record<string, unknown>): Promise<CosmeticAccount> => {
    const native = await runtime();
    const uid = await native.authenticate();
    const result = await native.call(endpoint, { ...payload, environment: config.environment }) as CosmeticAccount;
    if (!result || result.uid !== uid || result.environment !== config.environment || !Array.isArray(result.owned)
      || result.owned.some(id => typeof id !== 'string' || !partById(id)?.price) || new Set(result.owned).size !== result.owned.length) throw new Error('Could not verify your button collection.');
    readWallet(result.wallet, config.environment!);
    return result;
  };
  return {
    identity: async () => ({ uid: await (await runtime()).authenticate(), environment: config.environment! }),
    account: () => call('cosmeticAccount', {}),
    purchase: request => call('cosmeticPurchase', { ...request }),
  };
}
export const cosmeticService = createCosmeticService();
