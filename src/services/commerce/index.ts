import type { CommerceService } from '../../commerce/contracts';
import { readCommerceConfig, type CommerceConfig } from './config';
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
  if (config.platform !== 'ios' && config.platform !== 'android') return unavailable(config, 'Points purchases are available in the iPhone and Android apps.');
  if (!config.environment || !config.revenueCatKey?.trim()
    || !config.firebase.apiKey || !config.firebase.projectId || !config.firebase.appId) {
    return unavailable(config, 'Points purchases are not configured for this build.');
  }
  if (!config.revenueCatKey.startsWith(config.platform === 'ios' ? 'appl_' : 'goog_')) {
    return unavailable(config, 'Points purchases are not configured for this platform.');
  }
  return createNativeCommerceService(config, loader ?? (async () => (await import('./nativeRuntime')).loadNativeRuntime(config)));
}

let singleton: CommerceService | undefined;
export function getCommerceService(): CommerceService { return singleton ??= createCommerceService(); }
