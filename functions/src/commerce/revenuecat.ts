import { timingSafeEqual } from 'node:crypto';
import { POINT_PACKS, type CommerceEnvironment } from '../../../src/commerce/contracts';
import { CommerceError, environment, object, packPoints, type VerifiedPurchase } from './domain';

export interface ProviderConfig {
  apiKey: string;
  projectId: string;
  appIds: readonly string[];
  enabledEnvironments: readonly CommerceEnvironment[];
}
export function requireConfiguration(config: ProviderConfig, selected: CommerceEnvironment): void {
  if (!config.apiKey || !/^[A-Za-z0-9_-]+$/.test(config.projectId) || !config.appIds.length || !config.enabledEnvironments.includes(selected)) {
    throw new CommerceError('unavailable', 'Point purchases are not configured for this environment.');
  }
}
export function validWebhookAuthorization(actual: unknown, expected: string): boolean {
  if (typeof actual !== 'string' || !expected || expected.length < 24) return false;
  const supplied = Buffer.from(actual);
  const configured = Buffer.from(expected);
  return supplied.length === configured.length && timingSafeEqual(supplied, configured);
}
export interface PurchaseWebhook { customerIds: string[]; purchase: VerifiedPurchase; needsQuantityVerification: boolean }
const stores = {
  APP_STORE: 'app_store', PLAY_STORE: 'play_store', RC_BILLING: 'rc_billing', STRIPE: 'stripe', PADDLE: 'paddle',
} as const satisfies Readonly<Record<string, VerifiedPurchase['store']>>;

export function parsePurchaseWebhook(body: unknown, config: ProviderConfig): PurchaseWebhook | null {
  const envelope = object(body);
  if (envelope.api_version !== '1.0') throw new CommerceError('invalid-argument', 'Unsupported webhook version.');
  const event = object(envelope.event);
  if (event.type !== 'NON_RENEWING_PURCHASE' && event.type !== 'CANCELLATION') return null;
  if (!POINT_PACKS.some((pack) => pack.productId === event.product_id)) return null;
  if (!config.appIds.includes(String(event.app_id))) throw new CommerceError('permission-denied', 'Unknown RevenueCat app.');
  const selected = environment(event.environment === 'SANDBOX' ? 'sandbox' : event.environment === 'PRODUCTION' ? 'production' : event.environment);
  requireConfiguration(config, selected);
  if (event.is_family_share === true || !Object.hasOwn(stores, String(event.store))) return null;
  if (typeof event.id !== 'string' || !event.id || !Number.isSafeInteger(event.event_timestamp_ms)) throw new CommerceError('invalid-argument', 'Malformed purchase event.');
  const purchase: VerifiedPurchase = {
    transactionId: event.transaction_id as string,
    productId: event.product_id as string,
    store: stores[event.store as keyof typeof stores],
    environment: selected,
    purchasedAt: event.purchased_at_ms as number,
    quantity: (event.quantity ?? 1) as number,
    refunded: event.type === 'CANCELLATION',
  };
  packPoints(purchase);
  const customerIds = [event.original_app_user_id, event.app_user_id, ...(Array.isArray(event.aliases) ? event.aliases : [])]
    .filter((value): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128);
  return { customerIds: [...new Set(customerIds)], purchase, needsQuantityVerification: event.type === 'NON_RENEWING_PURCHASE' && event.quantity === undefined };
}

export type ProviderFetch = (url: string, init: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;
/** Only authenticated server requests to RevenueCat may construct verified purchases. */
export async function fetchVerifiedPurchases(config: ProviderConfig, uid: string, selected: CommerceEnvironment, fetcher: ProviderFetch = fetch): Promise<VerifiedPurchase[]> {
  requireConfiguration(config, selected);
  const base = `https://api.revenuecat.com/v2/projects/${encodeURIComponent(config.projectId)}`;
  const purchasePath = `${new URL(base).pathname}/customers/${encodeURIComponent(uid)}/purchases`;
  const products = new Map<string, string | null>();
  const verified: VerifiedPurchase[] = [];
  const read = async (url: string, missingCustomer = false): Promise<Record<string, unknown>> => {
    let response;
    try { response = await fetcher(url, { headers: { Authorization: `Bearer ${config.apiKey}`, Accept: 'application/json' }, signal: AbortSignal.timeout(12_000), redirect: 'error' }); }
    catch { throw new CommerceError('unavailable', 'Purchase verification is temporarily unavailable.'); }
    if (missingCustomer && response.status === 404) return { items: [], next_page: null };
    if (!response.ok) throw new CommerceError('unavailable', 'Purchase verification is temporarily unavailable.');
    return object(await response.json());
  };
  let next = `https://api.revenuecat.com${purchasePath}?environment=${selected}&limit=100`;
  const seenPages = new Set<string>();
  while (next) {
    const url = new URL(next, 'https://api.revenuecat.com');
    if (url.origin !== 'https://api.revenuecat.com' || url.pathname !== purchasePath || seenPages.has(url.href) || seenPages.size >= 100) {
      throw new CommerceError('unavailable', 'Unexpected purchase pagination.');
    }
    // Preserve environment isolation even if a provider pagination link omits its original filter.
    url.searchParams.set('environment', selected);
    seenPages.add(url.href);
    const page = await read(url.href, seenPages.size === 1);
    if (!Array.isArray(page.items)) throw new CommerceError('unavailable', 'Malformed purchase response.');
    for (const item of page.items) {
      const purchase = object(item);
      if (purchase.environment !== selected || purchase.ownership !== 'purchased'
        || !Object.values(stores).includes(purchase.store as VerifiedPurchase['store'])) continue;
      if (purchase.customer_id !== uid && purchase.original_customer_id !== uid) throw new CommerceError('permission-denied', 'Purchase belongs to another customer.');
      if (typeof purchase.product_id !== 'string') throw new CommerceError('unavailable', 'Malformed product identity.');
      if (!products.has(purchase.product_id)) {
        const product = await read(`${base}/products/${encodeURIComponent(purchase.product_id)}`);
        const isConsumable = product.type === 'consumable' || (product.type === 'one_time' && object(product.one_time).is_consumable === true);
        const allowed = product.id === purchase.product_id && config.appIds.includes(String(product.app_id)) && isConsumable
          && POINT_PACKS.some((pack) => pack.productId === product.store_identifier);
        products.set(purchase.product_id, allowed ? String(product.store_identifier) : null);
      }
      const productId = products.get(purchase.product_id);
      if (!productId) continue;
      if (purchase.status !== 'owned' && purchase.status !== 'refunded') throw new CommerceError('unavailable', 'Unknown purchase status.');
      const checked: VerifiedPurchase = {
        transactionId: purchase.store_purchase_identifier as string,
        productId,
        store: purchase.store as VerifiedPurchase['store'],
        environment: selected,
        purchasedAt: purchase.purchased_at as number,
        quantity: purchase.quantity as number,
        refunded: purchase.status === 'refunded',
      };
      packPoints(checked);
      verified.push(checked);
    }
    if (page.next_page != null && typeof page.next_page !== 'string') throw new CommerceError('unavailable', 'Malformed pagination.');
    next = (page.next_page as string | null) ?? '';
  }
  return verified;
}
