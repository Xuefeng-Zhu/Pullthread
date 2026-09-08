import type { CommerceService, CommerceWalletSyncResult, PointOffer, PurchaseQuery, RedeemToolRequest, ResolveToolAction } from '../../commerce/contracts';
import type { CommerceConfig } from './config';
import { CommerceError, redemptionError } from './errors';
import { readRedemption, readWallet, requirePointPack } from './validation';

export interface NativeCommerceRuntime {
  authenticate(): Promise<string>;
  configure(appUserId: string, apiKey: string): Promise<void>;
  getProducts(): Promise<readonly { productId: string; priceLabel: string }[]>;
  purchase(productId: string): Promise<{ status: 'completed' | 'cancelled' | 'pending'; transactionId?: string }>;
  call(name: string, payload: Record<string, unknown>): Promise<unknown>;
}
export type NativeRuntimeLoader = () => Promise<NativeCommerceRuntime>;

export function createNativeCommerceService(config: CommerceConfig, load: NativeRuntimeLoader): CommerceService {
  const environment = config.environment!;
  let runtime: NativeCommerceRuntime;
  let initialization: Promise<string> | undefined;
  let walletFlight: Promise<CommerceWalletSyncResult> | undefined;
  let pendingPurchase: PurchaseQuery | undefined;
  let purchaseFlight: { productId: string; promise: ReturnType<CommerceService['purchasePoints']> } | undefined;

  const initialize = () => {
    if (!initialization) {
      initialization = (async () => {
        runtime = await load();
        const accountId = await runtime.authenticate();
        if (!accountId) throw new CommerceError('Your guest account is unavailable. Please try again.', 'account');
        return accountId;
      })().catch((error) => { initialization = undefined; throw error; });
    }
    return initialization;
  };
  const sync = (): Promise<CommerceWalletSyncResult> => {
    if (!walletFlight) {
      const query = pendingPurchase;
      walletFlight = (async () => {
        await initialize();
        const result = await runtime.call('commerceSyncWallet', { environment, ...(query ? { purchase: query } : {}) }) as CommerceWalletSyncResult;
        const wallet = readWallet(result?.wallet, environment);
        const purchase = result?.purchase;
        if (query && purchase?.transactionId === query.transactionId && purchase.productId === query.productId
          && typeof purchase.verified === 'boolean') {
          if (purchase.verified && pendingPurchase === query) pendingPurchase = undefined;
          return { wallet, purchase };
        }
        return { wallet };
      })().finally(() => { walletFlight = undefined; });
    }
    return walletFlight;
  };
  const service: CommerceService = {
    mode: 'native', environment,
    getAccountId: async () => {
      const original = await initialize();
      if (await runtime.authenticate() !== original) throw new CommerceError('Your guest account changed. Restart before using points.', 'account');
      return original;
    },
    getWallet: async () => (await sync()).wallet,
    getOffers: async () => {
      await sync(); // Bind this authenticated customer before displaying a purchase sheet.
      await runtime.configure(await initialize(), config.revenueCatKey!);
      const products = await runtime.getProducts();
      const offers = new Map<string, PointOffer>();
      for (const product of products) {
        try {
          const pack = requirePointPack(product.productId);
          if (product.priceLabel.trim()) offers.set(product.productId, { ...pack, priceLabel: product.priceLabel });
        } catch { /* An offering may contain other products; only points packs belong here. */ }
      }
      return [...offers.values()];
    },
    purchasePoints: (productId) => {
      if (purchaseFlight) return purchaseFlight.productId === productId ? purchaseFlight.promise
        : Promise.reject(new CommerceError('Finish the current purchase first.', 'busy'));
      const promise = (async () => {
        requirePointPack(productId);
        const offers = await service.getOffers();
        if (!offers.some((offer) => offer.productId === productId)) throw new CommerceError('This points pack is unavailable.', 'unavailable');
        const baseline = await service.getWallet();
        const purchase = await runtime.purchase(productId);
        if (purchase.status === 'cancelled') return { status: 'cancelled' as const, wallet: baseline };
        if (purchase.status === 'completed' && purchase.transactionId) pendingPurchase = { productId, transactionId: purchase.transactionId };
        // An older in-flight refresh did not query this purchase. Finish it first.
        if (walletFlight) { try { await walletFlight; } catch { /* Reconcile again below. */ } }
        try {
          const reconciled = await sync();
          const verified = purchase.status === 'completed' && !!purchase.transactionId
            && reconciled.purchase?.verified === true
            && reconciled.purchase.transactionId === purchase.transactionId
            && reconciled.purchase.productId === productId;
          return { status: verified ? 'verified' as const : 'pending' as const, wallet: reconciled.wallet };
        } catch {
          // A store callback is not wallet authority. Retain only the earlier verified balance.
          return { status: 'pending' as const, wallet: baseline };
        }
      })().finally(() => { purchaseFlight = undefined; });
      purchaseFlight = { productId, promise };
      return promise;
    },
    redeemTool: async (request: RedeemToolRequest) => {
      await initialize();
      const response = await runtime.call('commerceRedeemTool', { ...request, environment })
        .catch((error) => { throw redemptionError(error, request.operationId); });
      const result = readRedemption(response, environment, request.operationId);
      if (result.receipt.runId !== request.runId || result.receipt.tool !== request.tool
        || result.receipt.contextKey !== request.contextKey || result.receipt.expectedCost !== request.expectedCost) {
        throw new CommerceError('This tool receipt belongs to another action.', 'invalid');
      }
      return result;
    },
    getRedemption: async (operationId: string) => {
      await initialize();
      const result = await runtime.call('commerceGetRedemption', { environment, operationId });
      return result === null ? null : readRedemption(result, environment, operationId);
    },
    resolveTool: async (operationId: string, action: ResolveToolAction) => {
      await initialize();
      return readRedemption(await runtime.call('commerceResolveTool', { environment, operationId, action }), environment, operationId);
    },
  };
  return service;
}
