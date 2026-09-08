import { POINT_PACKS, type CommerceEnvironment, type CommerceWalletSyncResult } from '../../src/commerce/contracts';
import { CommerceError, object, transactionKey, type VerifiedPurchase } from '../../functions/src/commerce/domain';
import { fetchVerifiedPurchases, parsePurchaseWebhook, requireConfiguration, type ProviderConfig, type ProviderFetch } from '../../functions/src/commerce/revenuecat';
import type { D1CommerceWallet } from './wallet';

export type WalletStore = Pick<D1CommerceWallet, 'bindCustomer' | 'getWallet' | 'applyVerifiedPurchase'
  | 'redeemTool' | 'getRedemption' | 'resolveTool' | 'findTransaction' | 'findTransactions' | 'findCustomer'>;

export const MAX_SYNC_CHANGES = 4;
export const MAX_SYNC_TRANSACTIONS = 3000;
export const MAX_PROVIDER_REQUESTS = 35;

/** Reserve headroom for auth and database work before the Free plan's external-fetch ceiling. */
function boundedProvider(fetcher: ProviderFetch = fetch): ProviderFetch {
  let requests = 0;
  return async (url, init) => {
    if (requests >= MAX_PROVIDER_REQUESTS) throw new CommerceError('unavailable', 'Purchase history requires additional reconciliation.');
    requests += 1;
    // Workerd supports manual/follow, not Node's redirect:'error'. A returned
    // redirect has ok=false, so the shared verifier rejects it without following.
    return fetcher(url, { ...init, redirect: 'manual' });
  };
}

function canonicalPurchases(purchases: readonly VerifiedPurchase[]): Map<string, VerifiedPurchase> {
  const result = new Map<string, VerifiedPurchase>();
  for (const purchase of purchases) {
    const key = transactionKey(purchase);
    const prior = result.get(key);
    if (prior && (prior.productId !== purchase.productId || (!prior.refunded && !purchase.refunded && prior.quantity !== purchase.quantity))) {
      throw new CommerceError('permission-denied', 'The store transaction has conflicting purchase identities.');
    }
    // A contradictory provider page cannot place an owned record ahead of its refund.
    if (!prior || (!prior.refunded && purchase.refunded)) result.set(key, purchase);
    if (result.size > MAX_SYNC_TRANSACTIONS) throw new CommerceError('unavailable', 'Purchase history requires additional reconciliation.');
  }
  return result;
}

/** Reconciliation consumes provider-verified store transactions, never client purchase claims. */
export async function syncWallet(wallet: WalletStore, config: ProviderConfig, uid: string,
  selected: CommerceEnvironment, purchaseQuery?: unknown, fetcher?: ProviderFetch): Promise<CommerceWalletSyncResult> {
  requireConfiguration(config, selected);
  let query: { transactionId: string; productId: string } | undefined;
  if (purchaseQuery !== undefined) {
    const input = object(purchaseQuery);
    if (typeof input.transactionId !== 'string' || !input.transactionId || input.transactionId.length > 512
      || !POINT_PACKS.some((pack) => pack.productId === input.productId)) throw new CommerceError('invalid-argument', 'Invalid purchase query.');
    query = { transactionId: input.transactionId, productId: input.productId as string };
  }
  const purchases = canonicalPurchases(await fetchVerifiedPurchases(config, uid, selected, boundedProvider(fetcher)));
  await wallet.bindCustomer(uid);
  const existingTransactions = await wallet.findTransactions([...purchases.keys()]);
  const pending: { key: string; purchase: VerifiedPurchase }[] = [];
  for (const [key, purchase] of purchases) {
    const existing = existingTransactions.get(key);
    // Aliases cannot transfer already spent points or duplicate another account's receipt.
    if (existing && existing.uid !== uid) continue;
    if (existing && (existing.productId !== purchase.productId
      || (!existing.refunded && !purchase.refunded && existing.quantity !== purchase.quantity))) {
      throw new CommerceError('permission-denied', 'The store transaction is already bound to another purchase identity.');
    }
    if (existing?.refunded || (existing && !purchase.refunded)) continue;
    pending.push({ key, purchase });
  }
  const priority = (purchase: VerifiedPurchase) => purchase.refunded ? 0 : query && purchase.transactionId === query.transactionId
    && purchase.productId === query.productId ? 1 : 2;
  pending.sort((a, b) => priority(a.purchase) - priority(b.purchase)
    || a.purchase.purchasedAt - b.purchase.purchasedAt || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  // Every applied change remains durable. Later syncs skip it and continue the backlog.
  for (const { purchase } of pending.slice(0, MAX_SYNC_CHANGES)) await wallet.applyVerifiedPurchase(uid, purchase);
  if (pending.slice(MAX_SYNC_CHANGES).some(({ purchase }) => purchase.refunded)) {
    throw new CommerceError('unavailable', 'Wallet refunds are still reconciling. Retry shortly.');
  }
  let verified = false;
  if (query) {
    const matching = [...purchases.values()].filter((purchase) => purchase.transactionId === query.transactionId
      && purchase.productId === query.productId && !purchase.refunded);
    for (const purchase of matching) {
      const stored = await wallet.findTransaction(transactionKey(purchase));
      if (stored?.uid === uid && stored.productId === query.productId && stored.refunded === false) verified = true;
    }
  }
  return { wallet: await wallet.getWallet(uid, selected), ...(query ? { purchase: { ...query, verified } } : {}) };
}

export async function receivePurchaseWebhook(wallet: WalletStore, config: ProviderConfig,
  body: unknown, fetcher?: ProviderFetch): Promise<void> {
  const event = parsePurchaseWebhook(body, config);
  if (!event) return;
  const existing = await wallet.findTransaction(transactionKey(event.purchase));
  let uid = existing?.uid;
  if (!uid) {
    for (const customerId of event.customerIds) {
      const mapping = await wallet.findCustomer(customerId);
      if (mapping) { uid = mapping.uid; break; }
    }
  }
  if (!uid) throw new CommerceError('unavailable', 'Customer mapping is not ready; retry this event.');
  let purchase = event.purchase;
  if (event.needsQuantityVerification) {
    const purchases = await fetchVerifiedPurchases(config, uid, purchase.environment, boundedProvider(fetcher));
    const verified = purchases.find((item) => item.transactionId === purchase.transactionId
      && item.productId === purchase.productId && item.store === purchase.store);
    if (!verified) throw new CommerceError('unavailable', 'Purchase quantity is not verified yet; retry this event.');
    purchase = verified;
  }
  await wallet.applyVerifiedPurchase(uid, purchase);
}
