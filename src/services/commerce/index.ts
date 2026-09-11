import type { CommerceService } from '../../commerce/contracts';
import { readCommerceConfig, resolveCommerceBackend, type CommerceConfig } from './config';
import { CommerceError } from './errors';
import { createMockCommerceService } from './mockService';
import { createNativeCommerceService, type NativeRuntimeLoader } from './nativeService';

function unavailable(config: CommerceConfig, reason: string): CommerceService {
  const reject = async (): Promise<never> => { throw new CommerceError(reason, 'unavailable'); };
  return { mode: 'unavailable', environment: config.environment ?? 'sandbox', unavailableReason: reason,
    getAccountId: reject, getOffers: reject, getWallet: reject, purchasePoints: reject,
    redeemTool: reject, getRedemption: reject, resolveTool: reject };
}

export function createCommerceService(config = readCommerceConfig(), loader?: NativeRuntimeLoader): CommerceService {
  if (!config.enabled) return unavailable(config, 'Points purchases are not available in this build.');
  if (config.mock) return config.development && config.environment === 'sandbox' ? createMockCommerceService()
    : unavailable(config, 'Demo purchases require a development sandbox.');
  if (!['ios', 'android', 'web'].includes(config.platform)) return unavailable(config, 'Points purchases are unavailable on this platform.');
  if (!config.environment || !config.revenueCatKey?.trim()
    || !config.firebase.apiKey || !config.firebase.projectId || !config.firebase.appId) {
    return unavailable(config, 'Points purchases are not configured for this build.');
  }
  const expectedKeyPrefix = config.platform === 'ios' ? 'appl_' : config.platform === 'android' ? 'goog_' : 'rcb_';
  const testStore = config.environment === 'sandbox' && config.revenueCatKey.startsWith('test_');
  if (!testStore && !config.revenueCatKey.startsWith(expectedKeyPrefix)) {
    return unavailable(config, 'Points purchases are not configured for this platform.');
  }
  try { resolveCommerceBackend(config); }
  catch (error) { return unavailable(config, error instanceof CommerceError ? error.message : 'The points backend is unavailable.'); }
  return createNativeCommerceService(config, loader ?? (async () => (await import('./nativeRuntime')).loadNativeRuntime(config)),
    config.platform === 'web' ? 'web' : 'native');
}

let singleton: CommerceService | undefined;
export function getCommerceService(): CommerceService { return singleton ??= createCommerceService(); }
