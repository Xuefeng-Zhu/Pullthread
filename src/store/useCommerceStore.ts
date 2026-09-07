import { create } from 'zustand';
import type { CommerceEnvironment, CommerceService, CommerceWallet, PointOffer, RedeemToolRequest, RedemptionResult, ResolveToolAction } from '../commerce/contracts';
import { getCommerceService } from '../services/commerce';
import { CommerceError, commerceErrorMessage } from '../services/commerce/errors';
import { readWallet } from '../services/commerce/validation';

type PurchaseResult = Awaited<ReturnType<CommerceService['purchasePoints']>>;
export interface CommerceStore {
  readonly status: 'loading' | 'ready' | 'unavailable' | 'error';
  readonly mode: CommerceService['mode'];
  readonly environment: CommerceEnvironment;
  readonly wallet: CommerceWallet | null;
  readonly offers: readonly PointOffer[];
  readonly busy: boolean;
  readonly error: string | null;
  readonly notice: string | null;
  readonly purchaseStatus: PurchaseResult['status'] | null;
  acceptWallet(wallet: CommerceWallet): CommerceWallet;
  initialize(): Promise<void>;
  refreshWallet(): Promise<CommerceWallet>;
  purchasePoints(productId: string): Promise<PurchaseResult>;
  redeemTool(request: RedeemToolRequest): Promise<RedemptionResult>;
  getRedemption(operationId: string): Promise<RedemptionResult | null>;
  resolveTool(operationId: string, action: ResolveToolAction): Promise<RedemptionResult>;
}

/** Wallet values are a display snapshot; every purchase/debit remains server-authorized. */
export function createCommerceStore(service: CommerceService = getCommerceService()) {
  let initialization: Promise<void> | undefined;
  let refreshing: Promise<CommerceWallet> | undefined;
  let mutation: { key: string; promise: Promise<unknown> } | undefined;
  const demoNotice = service.mode === 'mock' ? 'Demo wallet · no real purchases' : null;
  return create<CommerceStore>((set, get) => {
    const acceptWallet = (value: CommerceWallet) => {
      const wallet = readWallet(value, service.environment);
      const previous = get().wallet;
      // A slower response must not resurrect points spent by a newer server revision.
      if (!previous || wallet.revision >= previous.revision) set({ wallet });
      return wallet;
    };
    const failure = (error: unknown) => set({
      status: error instanceof CommerceError && error.code === 'unavailable' ? 'unavailable' : 'error',
      error: commerceErrorMessage(error),
    });
    const mutate = <T,>(key: string, operation: () => Promise<T>): Promise<T> => {
      if (mutation) return mutation.key === key ? mutation.promise as Promise<T>
        : Promise.reject(new CommerceError('Finish the current points action first.', 'busy'));
      set({ busy: true, error: null });
      const promise = operation().catch((error) => { failure(error); throw error; })
        .finally(() => { mutation = undefined; set({ busy: false }); });
      mutation = { key, promise };
      return promise;
    };
    return {
      status: service.mode === 'unavailable' ? 'unavailable' : 'loading',
      mode: service.mode, environment: service.environment,
      wallet: null, offers: [], busy: false,
      error: service.unavailableReason ?? null, notice: demoNotice, purchaseStatus: null,
      acceptWallet,
      initialize: () => {
        if (initialization) return initialization;
        if (service.mode === 'unavailable') return Promise.resolve();
        set({ status: 'loading', error: null });
        initialization = (async () => {
          const [wallet, offers] = await Promise.allSettled([service.getWallet(), service.getOffers()]);
          if (wallet.status === 'rejected') throw wallet.reason;
          acceptWallet(wallet.value);
          set({ status: 'ready', offers: offers.status === 'fulfilled' ? offers.value : [],
            error: offers.status === 'rejected' ? 'Store prices are unavailable. Refresh to try again.' : null });
        })().catch(failure).finally(() => { initialization = undefined; });
        return initialization;
      },
      refreshWallet: () => {
        if (!refreshing) refreshing = service.getWallet().then((wallet) => {
          acceptWallet(wallet);
          set({ status: 'ready', error: null });
          return wallet;
        }).catch((error) => { failure(error); throw error; }).finally(() => { refreshing = undefined; });
        return refreshing;
      },
      purchasePoints: (productId) => mutate(`purchase:${productId}`, async () => {
        set({ purchaseStatus: null });
        const result = await service.purchasePoints(productId);
        acceptWallet(result.wallet);
        set({ status: 'ready', purchaseStatus: result.status, notice: demoNotice ?? (
          result.status === 'verified' ? 'Points added to your verified balance.'
            : result.status === 'pending' ? 'Your purchase is processing. Refresh your balance shortly.'
              : 'Purchase cancelled.'
        ) });
        return result;
      }),
      redeemTool: (request) => mutate(`redeem:${JSON.stringify(request)}`, async () => {
        const result = await service.redeemTool(request);
        acceptWallet(result.wallet);
        set({ status: 'ready' });
        return result;
      }),
      getRedemption: async (operationId) => {
        try {
          const result = await service.getRedemption(operationId);
          if (result) acceptWallet(result.wallet);
          set({ status: 'ready', error: null });
          return result;
        } catch (error) { failure(error); throw error; }
      },
      resolveTool: (operationId, action) => mutate(`resolve:${operationId}:${action}`, async () => {
        const result = await service.resolveTool(operationId, action);
        acceptWallet(result.wallet);
        set({ status: 'ready' });
        return result;
      }),
    };
  });
}

export const useCommerceStore = createCommerceStore();
