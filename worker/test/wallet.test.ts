import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { URL } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { CREATIVE_TOOLS, TOOL_COSTS, type RedeemToolRequest, type ToolKind } from '../../src/commerce/contracts';
import { transactionKey, type VerifiedPurchase } from '../../functions/src/commerce/domain';
import type { ProviderConfig, ProviderFetch } from '../../functions/src/commerce/revenuecat';
import { D1CommerceWallet } from '../src/wallet';
import { receivePurchaseWebhook, syncWallet } from '../src/service';

let runtime: Miniflare;
let db: D1Database;
let ledger: D1CommerceWallet;
before(async () => {
  runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default { fetch() { return new Response("fixture"); } }', compatibilityDate: '2026-09-07', d1Databases: ['DB'] }));
  db = await runtime.getD1Database('DB') as unknown as D1Database;
  const migration = (await Promise.all(['0001_commerce.sql', '0002_weekly.sql', '0003_cosmetics.sql', '0004_creative_tools.sql', '0005_web_billing.sql']
    .map(file => readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8')))).join('\n');
  // D1 exec treats each line as a statement; standalone SQL comments are not statements.
  await db.exec(migration.split('\n').filter((line) => line.trim() && !line.trimStart().startsWith('--')).join('\n'));
  ledger = new D1CommerceWallet(db);
});
after(async () => { await runtime?.dispose(); });
const config: ProviderConfig = { apiKey: 'server-only-fixture', projectId: 'proj_fixture', appIds: ['app_fixture'], enabledEnvironments: ['sandbox'] };
let sequence = 0;
function uid() { return `commerce_guest_${++sequence}`; }
function purchase(transactionId: string, changes: Partial<VerifiedPurchase> = {}): VerifiedPurchase { return { transactionId, productId: 'pullthread_points_100', store: 'app_store', environment: 'sandbox', purchasedAt: 100, quantity: 1, refunded: false, ...changes }; }
function request(tool: ToolKind = 'preview', changes: Partial<RedeemToolRequest> = {}): RedeemToolRequest { return { operationId: `operation_${++sequence}`, runId: `run_${sequence}_12345`, contextKey: 'tick:120:source', tool, expectedCost: TOOL_COSTS[tool], ...changes }; }
async function fund(user: string, id = user, changes: Partial<VerifiedPurchase> = {}) { return ledger.applyVerifiedPurchase(user, purchase(id, changes)); }
const balance = async (user: string) => (await ledger.getWallet(user, 'sandbox')).points;
function providerResponse(data: unknown): Awaited<ReturnType<ProviderFetch>> { return { ok: true, status: 200, json: async <T>() => data as T }; }
function provider(user: string, tx: string, refunded = false, store: VerifiedPurchase['store'] = 'app_store'): ProviderFetch { return async (url) => providerResponse(url.includes('/products/')
  ? { id: 'prod_fixture', store_identifier: 'pullthread_points_100', type: 'consumable', app_id: 'app_fixture' }
  : { items: [{ customer_id: user, original_customer_id: user, product_id: 'prod_fixture', purchased_at: 100, quantity: 1, status: refunded ? 'refunded' : 'owned', environment: 'sandbox', store, store_purchase_identifier: tx, ownership: 'purchased' }], next_page: null }); }

test('concurrent purchase delivery, webhook, and exact retries grant one pack', async () => {
  const user = uid();
  await Promise.all(Array.from({ length: 8 }, () => fund(user)));
  assert.equal(await balance(user), 100);
  assert.equal((await ledger.getWallet(user, 'sandbox')).revision, 1);
  const op = request();
  const replies = await Promise.all(Array.from({ length: 6 }, () => ledger.redeemTool(user, 'sandbox', op)));
  assert.ok(replies.every((reply) => reply.receipt.status === 'ready'));
  assert.equal(await balance(user), 90);
  assert.deepEqual((await ledger.getRedemption(user, 'sandbox', op.operationId))?.receipt, replies[0].receipt);
});
test('each creative tool debits once, preserves its exact context, and refunds once', async () => {
  for (const tool of CREATIVE_TOOLS) {
    const user = uid(); await fund(user);
    const op = request(tool, { contextKey: `0:endless-0:${tool}:exact-placement` });
    const first = await ledger.redeemTool(user, 'sandbox', op);
    assert.deepEqual((await ledger.redeemTool(user, 'sandbox', op)).receipt, first.receipt);
    assert.equal(await balance(user), 100 - TOOL_COSTS[tool]);
    await assert.rejects(ledger.redeemTool(user, 'sandbox', { ...op, contextKey: 'different-placement' }), /different tool request/);
    await ledger.resolveTool(user, 'sandbox', op.operationId, 'refund');
    await ledger.resolveTool(user, 'sandbox', op.operationId, 'refund');
    assert.equal(await balance(user), 100);
  }
});
test('concurrent debits never overspend and insufficient funds create no receipt', async () => {
  const user = uid(); await fund(user);
  const operations = Array.from({ length: 7 }, () => request('teleport'));
  const results = await Promise.allSettled(operations.map((op) => ledger.redeemTool(user, 'sandbox', op)));
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 4);
  for (const result of results) if (result.status === 'rejected') assert.equal(result.reason.details?.reason, 'insufficient_points');
  assert.equal(await balance(user), 0);
  for (let i = 0; i < results.length; i++) if (results[i].status === 'rejected') assert.equal(await ledger.getRedemption(user, 'sandbox', operations[i].operationId), null);
});
test('operation IDs bind all request fields and server costs reject forged free tools', async () => {
  const user = uid(); await fund(user); const op = request(); await ledger.redeemTool(user, 'sandbox', op);
  for (const changes of [{ runId: 'another_run' }, { contextKey: 'tick:121:other' }, { tool: 'teleport' as const, expectedCost: 25 }]) await assert.rejects(ledger.redeemTool(user, 'sandbox', { ...op, ...changes }), /different tool request/);
  await assert.rejects(ledger.redeemTool(user, 'sandbox', { ...request(), expectedCost: 0 }), /price changed/);
  assert.equal(await balance(user), 90);
});
test('paid revive is reserved once per run even under simultaneous operation IDs', async () => {
  const user = uid(); await fund(user); const runId = 'same_run_12345';
  const results = await Promise.allSettled([request('revive', { runId }), request('revive', { runId })].map((op) => ledger.redeemTool(user, 'sandbox', op)));
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(await balance(user), 50);
});
test('receipt resolution is durable, one-time, and scoped to authenticated customer', async () => {
  const user = uid(); const other = uid(); await fund(user); const op = request('teleport');
  await ledger.redeemTool(user, 'sandbox', op);
  assert.equal(await ledger.getRedemption(other, 'sandbox', op.operationId), null);
  await assert.rejects(ledger.resolveTool(other, 'sandbox', op.operationId, 'refund'), /Unknown tool/);
  await Promise.all(Array.from({ length: 5 }, () => ledger.resolveTool(user, 'sandbox', op.operationId, 'refund')));
  assert.equal(await balance(user), 100);
  await assert.rejects(ledger.resolveTool(user, 'sandbox', op.operationId, 'applied'), /already resolved/);
  assert.equal((await ledger.getRedemption(user, 'sandbox', op.operationId))?.receipt.status, 'refunded');
});
test('racing applied and refund resolution chooses a single terminal outcome', async () => {
  const user = uid(); await fund(user); const op = request('teleport'); await ledger.redeemTool(user, 'sandbox', op);
  const result = await Promise.allSettled([ledger.resolveTool(user, 'sandbox', op.operationId, 'applied'), ledger.resolveTool(user, 'sandbox', op.operationId, 'refund')]);
  assert.equal(result.filter((item) => item.status === 'fulfilled').length, 1);
  const saved = await ledger.getRedemption(user, 'sandbox', op.operationId);
  assert.equal(saved?.wallet.points, saved?.receipt.status === 'applied' ? 75 : 100);
});
test('FIFO allocations remove only the refunded pack unspent remainder without undoing applied tools', async () => {
  const user = uid(); const first = `${user}_first`; const second = `${user}_second`;
  await fund(user, first, { purchasedAt: 100 }); await fund(user, second, { purchasedAt: 200 });
  const op = request('revive'); await ledger.redeemTool(user, 'sandbox', op); await ledger.resolveTool(user, 'sandbox', op.operationId, 'applied');
  await ledger.applyVerifiedPurchase(user, purchase(first, { refunded: true }));
  assert.equal(await balance(user), 100);
  assert.equal((await ledger.getRedemption(user, 'sandbox', op.operationId))?.receipt.status, 'applied');
  await ledger.applyVerifiedPurchase(user, purchase(second, { purchasedAt: 200, refunded: true })); assert.equal(await balance(user), 0);
});
test('refund-before-purchase and duplicate refunds cannot mint points or go negative, including omitted refund quantity', async () => {
  const user = uid(); const tx = `${user}_late`;
  await ledger.applyVerifiedPurchase(user, purchase(tx, { refunded: true }));
  await fund(user, tx, { quantity: 2 }); assert.equal(await balance(user), 0);
  const next = `${user}_multi`; await fund(user, next, { quantity: 2 }); assert.equal(await balance(user), 200);
  await ledger.applyVerifiedPurchase(user, purchase(next, { refunded: true }));
  await ledger.applyVerifiedPurchase(user, purchase(next, { refunded: true })); assert.equal(await balance(user), 0);
});
test('refunding a ready tool after its store pack refund never resurrects revoked credit', async () => {
  const user = uid(); await fund(user); const op = request('teleport'); await ledger.redeemTool(user, 'sandbox', op);
  await ledger.applyVerifiedPurchase(user, purchase(user, { refunded: true }));
  const result = await ledger.resolveTool(user, 'sandbox', op.operationId, 'refund');
  assert.equal(result.wallet.points, 0); assert.equal(result.receipt.status, 'refunded');
});
test('store refunds racing spending preserve balance and lot invariants', async () => {
  const user = uid(); await fund(user);
  await Promise.allSettled([ledger.applyVerifiedPurchase(user, purchase(user, { refunded: true })), ledger.redeemTool(user, 'sandbox', request('teleport'))]);
  assert.equal(await balance(user), 0);
  const lots = await db.prepare('SELECT remaining, revoked FROM commerce_lots WHERE uid = ? AND environment = ?').bind(user, 'sandbox').all<{ remaining: number; revoked: number }>();
  assert.ok(lots.results.every((lot) => lot.remaining === 0 && lot.revoked === 1));
});
test('same store transaction cannot move to another UID while environments stay isolated', async () => {
  const user = uid(); const other = uid(); await fund(user);
  await assert.rejects(fund(other, user), /already bound/);
  assert.equal(await balance(other), 0); assert.equal((await ledger.getWallet(user, 'production')).points, 0);
  await fund(other, user, { environment: 'production' }); assert.equal((await ledger.getWallet(other, 'production')).points, 100);
});
test('RevenueCat Billing transactions reconcile, refund, and remain isolated from native store IDs', async () => {
  const user = uid(); const transactionId = `web_${user}`;
  const web = await syncWallet(ledger, config, user, 'sandbox', {
    transactionId, productId: 'pullthread_points_100',
  }, provider(user, transactionId, false, 'rc_billing'));
  assert.equal(web.purchase?.verified, true);
  assert.equal(web.wallet.points, 100);
  await fund(user, transactionId, { store: 'app_store' });
  assert.equal(await balance(user), 200);
  const refunded = await syncWallet(ledger, config, user, 'sandbox', undefined, provider(user, transactionId, true, 'rc_billing'));
  assert.equal(refunded.wallet.points, 100);
});
test('sync returns exact provider verification after spending, and client transaction queries never grant credit', async () => {
  const user = uid(); const query = { transactionId: user, productId: 'pullthread_points_100' };
  const first = await syncWallet(ledger, config, user, 'sandbox', query, provider(user, user)); assert.equal(first.purchase?.verified, true);
  await ledger.redeemTool(user, 'sandbox', request('revive'));
  const retry = await syncWallet(ledger, config, user, 'sandbox', query, provider(user, user)); assert.equal(retry.purchase?.verified, true); assert.equal(retry.wallet.points, 50);
  const pending = await syncWallet(ledger, config, user, 'sandbox', { ...query, transactionId: 'invented' }, provider(user, user)); assert.equal(pending.purchase?.verified, false); assert.equal(pending.wallet.points, 50);
  const refund = await syncWallet(ledger, config, user, 'sandbox', query, provider(user, user, true)); assert.equal(refund.purchase?.verified, false); assert.equal(refund.wallet.points, 0);
  const stale = await syncWallet(ledger, config, user, 'sandbox', query, provider(user, user)); assert.equal(stale.purchase?.verified, false); assert.equal(stale.wallet.points, 0);
});
test('trusted webhook uses established customer mapping, global owner for refunds, and retries unknown customers', async () => {
  const user = uid(); const other = uid(); const body = (type: string, app_user_id = user) => ({ api_version: '1.0', event: { id: 'event_123', type, event_timestamp_ms: 300, app_id: 'app_fixture', app_user_id, original_app_user_id: app_user_id, product_id: 'pullthread_points_100', transaction_id: user, quantity: 1, purchased_at_ms: 100, environment: 'SANDBOX', store: 'APP_STORE' } });
  await assert.rejects(receivePurchaseWebhook(ledger, config, body('NON_RENEWING_PURCHASE')), /mapping is not ready/);
  await ledger.bindCustomer(user); await receivePurchaseWebhook(ledger, config, body('NON_RENEWING_PURCHASE')); assert.equal(await balance(user), 100);
  await receivePurchaseWebhook(ledger, config, body('CANCELLATION', other)); assert.equal(await balance(user), 0); assert.equal(await balance(other), 0);
  await receivePurchaseWebhook(ledger, config, body('NON_RENEWING_PURCHASE')); assert.equal(await balance(user), 0);
});

test('trusted RevenueCat Billing webhooks use the same customer mapping and refund tombstones', async () => {
  const user = uid();
  const body = (type: 'NON_RENEWING_PURCHASE' | 'CANCELLATION') => ({ api_version: '1.0', event: {
    id: `web_event_${type}`, type, event_timestamp_ms: 300, app_id: 'app_fixture', app_user_id: user,
    original_app_user_id: user, product_id: 'pullthread_points_100', transaction_id: `webhook_${user}`,
    quantity: 1, purchased_at_ms: 100, environment: 'SANDBOX', store: 'RC_BILLING',
  } });
  await ledger.bindCustomer(user);
  await receivePurchaseWebhook(ledger, config, body('NON_RENEWING_PURCHASE'));
  assert.equal(await balance(user), 100);
  await receivePurchaseWebhook(ledger, config, body('CANCELLATION'));
  assert.equal(await balance(user), 0);
});

test('refunding an unused revive atomically releases its slot; an old refund retry cannot erase a new reservation', async () => {
  const user = uid(); await fund(user); const runId = 'refundable_run'; const first = request('revive', { runId }); const second = request('revive', { runId });
  await ledger.redeemTool(user, 'sandbox', first);
  const results = await Promise.allSettled([ledger.resolveTool(user, 'sandbox', first.operationId, 'refund'), ledger.redeemTool(user, 'sandbox', second)]);
  assert.equal(results[0].status, 'fulfilled');
  // If redemption linearized before the refund it may be rejected; its exact retry must now succeed.
  await ledger.redeemTool(user, 'sandbox', second);
  assert.equal(await balance(user), 50);
  await ledger.resolveTool(user, 'sandbox', first.operationId, 'refund');
  await assert.rejects(ledger.redeemTool(user, 'sandbox', request('revive', { runId })), /already redeemed/);
  await ledger.resolveTool(user, 'sandbox', second.operationId, 'applied');
  await assert.rejects(ledger.redeemTool(user, 'sandbox', request('revive', { runId })), /already redeemed/);
});
test('a tool spanning FIFO lots restores only allocations from packs that remain valid', async () => {
  const user = uid(); const first = `${user}_first`; const second = `${user}_second`;
  await fund(user, first); await fund(user, second, { purchasedAt: 200 });
  for (const tool of ['revive', 'teleport', 'preview'] as const) {
    const op = request(tool); await ledger.redeemTool(user, 'sandbox', op); await ledger.resolveTool(user, 'sandbox', op.operationId, 'applied');
  }
  const spanning = request('teleport'); await ledger.redeemTool(user, 'sandbox', spanning); assert.equal(await balance(user), 90);
  await ledger.applyVerifiedPurchase(user, purchase(first, { refunded: true }));
  const restored = await ledger.resolveTool(user, 'sandbox', spanning.operationId, 'refund'); assert.equal(restored.wallet.points, 100);
});


test('webhook missing quantity waits for exact V2 verification and credits every verified unit once', async () => {
  const user = uid(); await ledger.bindCustomer(user);
  const body = { api_version: '1.0', event: { id: 'multi_quantity_event', type: 'NON_RENEWING_PURCHASE',
    event_timestamp_ms: 300, app_id: 'app_fixture', app_user_id: user, original_app_user_id: user,
    product_id: 'pullthread_points_100', transaction_id: user, purchased_at_ms: 100,
    environment: 'SANDBOX', store: 'APP_STORE' } };
  const absent: ProviderFetch = async () => providerResponse({ items: [], next_page: null });
  await assert.rejects(receivePurchaseWebhook(ledger, config, body, absent), /quantity is not verified/);
  assert.equal(await balance(user), 0);
  const multiple: ProviderFetch = async (url, init) => {
    const response = await provider(user, user)(url, init);
    const data = await response.json() as { items?: { quantity: number }[] };
    if (data.items) data.items[0].quantity = 2;
    return providerResponse(data);
  };
  await receivePurchaseWebhook(ledger, config, body, multiple);
  assert.equal(await balance(user), 200);
  await receivePurchaseWebhook(ledger, config, body, multiple);
  const synced = await syncWallet(ledger, config, user, 'sandbox', undefined, multiple);
  assert.equal(synced.wallet.points, 200);
});

test('D1 revision assertion rolls back preceding wallet updates and all following writes', async () => {
  const user = uid(); await fund(user);
  const original = await ledger.getWallet(user, 'sandbox');
  // Simulate a stale writer: its tentative debit must roll back, and its later
  // mapping write must never execute. This exercises SQLite, not a mocked batch.
  await assert.rejects(db.batch([
    db.prepare('UPDATE commerce_wallets SET points = 0 WHERE uid = ? AND environment = ?').bind(user, 'sandbox'),
    db.prepare('UPDATE commerce_wallets SET revision = revision + 1 WHERE uid = ? AND environment = ? AND revision = ?').bind(user, 'sandbox', original.revision - 1),
    db.prepare('INSERT INTO commerce_revision_assertions(matched) SELECT changes() WHERE changes() != 1'),
    db.prepare('INSERT INTO commerce_customers(revenue_cat_id, uid) VALUES (?, ?)').bind(user, user),
  ]), /commerce_revision_conflict/);
  assert.deepEqual(await ledger.getWallet(user, 'sandbox'), original);
  assert.equal(await ledger.findCustomer(user), null);
  assert.equal((await db.prepare('SELECT count(*) AS count FROM commerce_revision_assertions').first<{ count: number }>())?.count, 0);
});

test('global transaction uniqueness rolls back the losing account during simultaneous first grants', async () => {
  const owners = [uid(), uid(), uid(), uid()];
  const tx = `shared_${uid()}`;
  const replies = await Promise.allSettled(owners.map((owner) => fund(owner, tx)));
  assert.equal(replies.filter((reply) => reply.status === 'fulfilled').length, 1);
  for (const reply of replies) if (reply.status === 'rejected') assert.match(reply.reason.message, /already bound/);
  const stored = await ledger.findTransaction(transactionKey(purchase(tx)));
  assert.ok(stored);
  assert.equal((await Promise.all(owners.map(balance))).reduce((sum, points) => sum + points, 0), 100);
  for (const owner of owners) assert.equal(await balance(owner), owner === stored.uid ? 100 : 0);
});

test('concurrent independent credits retain every lot and every wallet revision', async () => {
  const user = uid();
  await Promise.all(Array.from({ length: 16 }, (_, index) => fund(user, `${user}_${index}`)));
  assert.deepEqual(await ledger.getWallet(user, 'sandbox'), { points: 1600, revision: 16, environment: 'sandbox' });
  const lots = await db.prepare('SELECT count(*) AS count, sum(remaining) AS remaining FROM commerce_lots WHERE uid = ?').bind(user).first<{ count: number; remaining: number }>();
  assert.deepEqual(lots, { count: 16, remaining: 1600 });
});

test('store and ready-tool refunds racing cannot resurrect a revoked allocation', async () => {
  const user = uid(); await fund(user); const op = request('teleport');
  await ledger.redeemTool(user, 'sandbox', op);
  const replies = await Promise.all([
    ledger.resolveTool(user, 'sandbox', op.operationId, 'refund'),
    ledger.applyVerifiedPurchase(user, purchase(user, { refunded: true })),
  ]);
  assert.equal(replies.length, 2);
  assert.equal(await balance(user), 0);
  assert.equal((await ledger.getRedemption(user, 'sandbox', op.operationId))?.receipt.status, 'refunded');
});

test('global identity also binds product and non-refunded quantity while stores remain isolated', async () => {
  const user = uid(); await fund(user);
  await assert.rejects(fund(user, user, { productId: 'pullthread_points_550' }), /already bound/);
  await assert.rejects(fund(user, user, { quantity: 2 }), /already bound/);
  await fund(user, user, { store: 'play_store' });
  assert.equal(await balance(user), 200);
  await ledger.applyVerifiedPurchase(user, purchase(user, { refunded: true }));
  assert.equal(await balance(user), 100);
});

test('alias reconciliation cannot duplicate or transfer another account transaction', async () => {
  const user = uid(); const alias = uid(); await fund(user);
  await ledger.redeemTool(user, 'sandbox', request('revive'));
  const result = await syncWallet(ledger, config, alias, 'sandbox', { transactionId: user, productId: 'pullthread_points_100' }, provider(alias, user));
  assert.equal(result.purchase?.verified, false);
  assert.equal(result.wallet.points, 0);
  assert.equal(await balance(user), 50);
});

test('reconstructed wallet instances recover durable ready operations without a second debit', async () => {
  const user = uid(); await fund(user); const op = request('teleport');
  const initial = await ledger.redeemTool(user, 'sandbox', op);
  const recovered = new D1CommerceWallet(db);
  assert.deepEqual(await recovered.getRedemption(user, 'sandbox', op.operationId), initial);
  assert.deepEqual(await recovered.redeemTool(user, 'sandbox', op), initial);
  assert.equal((await recovered.resolveTool(user, 'sandbox', op.operationId, 'applied')).wallet.points, 75);
  assert.equal((await recovered.redeemTool(user, 'sandbox', op)).receipt.status, 'applied');
});

test('bulk transaction lookup preserves owners and refunds across three JSON chunks without executing key text', async () => {
  const owner = uid(); const other = uid();
  const owned = purchase(owner, { purchasedAt: 200, quantity: 2 });
  const refunded = purchase(other, { refunded: true });
  await ledger.applyVerifiedPurchase(owner, owned);
  await ledger.applyVerifiedPurchase(other, refunded);
  const ownedKey = transactionKey(owned); const refundedKey = transactionKey(refunded);
  const unknownKeys = Array.from({ length: 1998 }, (_, index) => `unknown_${owner}_${index}`);
  const sqlText = "'); DROP TABLE commerce_transactions; --";
  let lookupQueries = 0;
  const counted = new D1CommerceWallet({
    prepare: (sql: string) => db.prepare(sql),
    batch: <T>(statements: D1PreparedStatement[]) => { lookupQueries += statements.length; return db.batch<T>(statements); },
  } as D1Database);
  // The wrapper only counts statements; every query executes against real D1.
  const found = await counted.findTransactions([ownedKey, ...unknownKeys, sqlText, refundedKey, ownedKey]);
  assert.equal(lookupQueries, 3);
  assert.equal(found.size, 2);
  assert.deepEqual(found.get(ownedKey), { ...owned, uid: owner, points: 200 });
  assert.deepEqual(found.get(refundedKey), { ...refunded, uid: other, points: 100 });
  assert.equal(found.has(unknownKeys[0]), false);
  assert.equal(found.has(sqlText), false);
  assert.deepEqual(await ledger.findTransaction(ownedKey), found.get(ownedKey));
  assert.deepEqual(await ledger.findTransactions([]), new Map());
  assert.equal(await balance(owner), 200);
  assert.equal(await balance(other), 0);
});


test('cosmetic unlock is atomic, permanent, and concurrent purchases charge once', async () => {
  const user = uid(); await fund(user);
  const operations = Array.from({ length: 8 }, (_, index) => ({ operationId: `cosmetic_operation_${index}`, itemId: 'rim-brass', expectedPrice: 50 }));
  await Promise.all(operations.map(op => ledger.purchaseCosmetic(user, 'sandbox', op)));
  assert.equal(await balance(user), 50);
  assert.deepEqual((await ledger.cosmeticAccount(user, 'sandbox')).owned, ['rim-brass']);
  await ledger.purchaseCosmetic(user, 'sandbox', operations[0]);
  assert.equal(await balance(user), 50);
  await assert.rejects(ledger.purchaseCosmetic(user, 'sandbox', { ...operations[0], itemId: 'rim-pearl' }), /another purchase/);
  assert.deepEqual((await ledger.cosmeticAccount(user, 'production')).owned, []);
  assert.deepEqual((await ledger.cosmeticAccount(uid(), 'sandbox')).owned, []);
});
test('cosmetics reject forged prices and insufficient funds without unlocking', async () => {
  const user = uid();
  await assert.rejects(ledger.purchaseCosmetic(user, 'sandbox', { operationId: 'cosmetic_invalid_1', itemId: 'color-coral', expectedPrice: 0 }), /price/);
  await assert.rejects(ledger.purchaseCosmetic(user, 'sandbox', { operationId: 'cosmetic_invalid_2', itemId: 'color-coral', expectedPrice: 25 }), /Not enough/);
  assert.deepEqual((await ledger.cosmeticAccount(user, 'sandbox')).owned, []);
});
test('cosmetics use reward and purchase lots and store refunds preserve unlocked parts', async () => {
  const user = uid(); await fund(user);
  await db.prepare('INSERT INTO commerce_reward_lots(uid,environment,tx_key,remaining,purchased_at,active) VALUES (?, ?, ?, 25, 0, 1)').bind(user, 'sandbox', 'fixture-reward').run();
  await db.prepare('UPDATE commerce_wallets SET points = 125, revision = revision + 1 WHERE uid = ?').bind(user).run();
  await ledger.purchaseCosmetic(user, 'sandbox', { operationId: 'cosmetic_mixed_lots', itemId: 'pattern-stars', expectedPrice: 75 });
  assert.equal(await balance(user), 50);
  const row = await db.prepare('SELECT allocations FROM cosmetic_purchases WHERE uid = ?').bind(user).first<{ allocations: string }>();
  assert.deepEqual(JSON.parse(row!.allocations).map((x: { source: string; points: number }) => [x.source, x.points]), [['reward', 25], ['purchase', 50]]);
  await fund(user, user, { refunded: true });
  assert.equal(await balance(user), 0);
  assert.deepEqual((await ledger.cosmeticAccount(user, 'sandbox')).owned, ['pattern-stars']);
});

test('cosmetic endpoints authenticate, isolate environments, and gate purchases independently', async () => {
  const { createCommerceHandler } = await import('../src/index');
  const user = uid(); await fund(user);
  const handler = createCommerceHandler({ verifyToken: async () => user });
  const env = { DB: db, COSMETICS_ENABLED_ENVIRONMENTS: 'sandbox' };
  const call = (path: string, data: object, selected = env) => handler(new Request(`https://fixture.test/${path}`, { method: 'POST', headers: { authorization: 'Bearer fixture.token.signature', 'content-type': 'application/json' }, body: JSON.stringify({ data }) }), selected);
  assert.equal((await call('cosmeticAccount', { environment: 'production' })).status, 503);
  assert.equal((await call('cosmeticPurchase', { environment: 'sandbox', operationId: 'endpoint_cosmetic', itemId: 'color-sky', expectedPrice: 25 }, { ...env, COSMETICS_ENABLED_ENVIRONMENTS: '' })).status, 503);
  const response = await call('cosmeticPurchase', { environment: 'sandbox', operationId: 'endpoint_cosmetic', itemId: 'color-sky', expectedPrice: 25, uid: 'forged-user' });
  assert.equal(response.status, 200);
  const body = await response.json() as { result: { uid: string; owned: string[]; wallet: { points: number } } };
  assert.equal(body.result.uid, user); assert.deepEqual(body.result.owned, ['color-sky']); assert.equal(body.result.wallet.points, 75);
  const denied = await createCommerceHandler()(new Request('https://fixture.test/cosmeticAccount', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: { environment: 'sandbox' } }) }), env);
  assert.equal(denied.status, 401);
});
