import type { Firestore } from 'firebase-admin/firestore';
import { POINT_PACKS, type CommerceEnvironment, type CommerceWalletSyncResult } from '../../../src/commerce/contracts';
import { CommerceError, hash, object, transactionKey } from './domain';
import { fetchVerifiedPurchases, parsePurchaseWebhook, requireConfiguration, type ProviderConfig, type ProviderFetch } from './revenuecat';
import { applyVerifiedPurchase, bindCustomer, getWallet } from './wallet';

export async function syncWallet(database: Firestore, config: ProviderConfig, uid: string, selected: CommerceEnvironment, purchaseQuery?: unknown, fetcher?: ProviderFetch): Promise<CommerceWalletSyncResult> {
  requireConfiguration(config, selected);
  let query: { transactionId: string; productId: string } | undefined;
  if (purchaseQuery !== undefined) {
    const input = object(purchaseQuery);
    if (typeof input.transactionId !== 'string' || !input.transactionId || input.transactionId.length > 512
      || !POINT_PACKS.some((pack) => pack.productId === input.productId)) throw new CommerceError('invalid-argument', 'Invalid purchase query.');
    query = { transactionId: input.transactionId, productId: input.productId as string };
  }
  await bindCustomer(database, uid);
  const purchases = await fetchVerifiedPurchases(config, uid, selected, fetcher);
  for (const purchase of purchases) {
    // A RevenueCat alias/transfer does not transfer spent points or grant the same receipt again.
    const existing = await database.collection('commerce_transactions').doc(transactionKey(purchase)).get();
    if (existing.exists && existing.get('uid') !== uid) continue;
    await applyVerifiedPurchase(database, uid, purchase);
  }
  let verified = false;
  if (query) {
    const matching = purchases.filter((purchase) => purchase.transactionId === query.transactionId && purchase.productId === query.productId && !purchase.refunded);
    for (const purchase of matching) {
      const stored = await database.collection('commerce_transactions').doc(transactionKey(purchase)).get();
      if (stored.get('uid') === uid && stored.get('productId') === query.productId && stored.get('refunded') === false) verified = true;
    }
  }
  return { wallet: await getWallet(database, uid, selected), ...(query ? { purchase: { ...query, verified } } : {}) };
}
export async function receivePurchaseWebhook(database: Firestore, config: ProviderConfig, body: unknown, fetcher?: ProviderFetch): Promise<void> {
  const event = parsePurchaseWebhook(body, config);
  if (!event) return;
  const existing = await database.collection('commerce_transactions').doc(transactionKey(event.purchase)).get();
  let uid = existing.get('uid') as string | undefined;
  if (!uid) {
    const refs = event.customerIds.map((id) => database.collection('commerce_customers').doc(hash(id)));
    const mappings = refs.length ? await database.getAll(...refs) : [];
    uid = mappings.find((mapping) => mapping.exists)?.get('uid') as string | undefined;
  }
  if (!uid) throw new CommerceError('unavailable', 'Customer mapping is not ready; retry this event.');
  let purchase = event.purchase;
  if (event.needsQuantityVerification) {
    // RevenueCat only includes quantity in some projects' webhook payloads.
    // Never bind an assumed single unit: resolve the exact store purchase first.
    const purchases = await fetchVerifiedPurchases(config, uid, purchase.environment, fetcher);
    const verified = purchases.find((item) => item.transactionId === purchase.transactionId
      && item.productId === purchase.productId && item.store === purchase.store);
    if (!verified) throw new CommerceError('unavailable', 'Purchase quantity is not verified yet; retry this event.');
    purchase = verified;
  }
  await applyVerifiedPurchase(database, uid, purchase);
}
