import { strict as assert } from 'node:assert';
import { after, test } from 'node:test';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { TOOL_COSTS, type RedeemToolRequest, type ToolKind } from '../../src/commerce/contracts';
import { type VerifiedPurchase } from '../src/commerce/domain';
import { bindCustomer, applyVerifiedPurchase, getWallet, getRedemption, redeemTool, resolveTool, walletRef } from '../src/commerce/wallet';
import { receivePurchaseWebhook, syncWallet } from '../src/commerce/service';
import type { ProviderConfig, ProviderFetch } from '../src/commerce/revenuecat';

const app = initializeApp({ projectId: 'pullthread-rules-test' }, 'commerce-test');
const db = getFirestore(app);
after(async () => { await deleteApp(app); });
const config: ProviderConfig = { apiKey: 'server-only-fixture', projectId: 'proj_fixture', appIds: ['app_fixture'], enabledEnvironments: ['sandbox'] };
let sequence = 0;
function uid() { return `commerce_guest_${++sequence}`; }
function purchase(transactionId: string, changes: Partial<VerifiedPurchase> = {}): VerifiedPurchase { return { transactionId, productId: 'pullthread_points_100', store: 'app_store', environment: 'sandbox', purchasedAt: 100, quantity: 1, refunded: false, ...changes }; }
function request(tool: ToolKind = 'preview', changes: Partial<RedeemToolRequest> = {}): RedeemToolRequest { return { operationId: `operation_${++sequence}`, runId: `run_${sequence}_12345`, contextKey: 'tick:120:source', tool, expectedCost: TOOL_COSTS[tool], ...changes }; }
async function fund(user: string, id = user, changes: Partial<VerifiedPurchase> = {}) { return applyVerifiedPurchase(db, user, purchase(id, changes)); }
const balance = async (user: string) => (await getWallet(db, user, 'sandbox')).points;
function provider(user: string, tx: string, refunded = false): ProviderFetch { return async (url) => ({ ok: true, status: 200, json: async () => url.includes('/products/')
  ? { id: 'prod_fixture', store_identifier: 'pullthread_points_100', type: 'consumable', app_id: 'app_fixture' }
  : { items: [{ customer_id: user, original_customer_id: user, product_id: 'prod_fixture', purchased_at: 100, quantity: 1, status: refunded ? 'refunded' : 'owned', environment: 'sandbox', store: 'app_store', store_purchase_identifier: tx, ownership: 'purchased' }], next_page: null } }); }

test('concurrent purchase delivery, webhook, and exact retries grant one pack', async () => {
  const user = uid();
  await Promise.all(Array.from({ length: 8 }, () => fund(user)));
  assert.equal(await balance(user), 100);
  assert.equal((await getWallet(db, user, 'sandbox')).revision, 1);
  const op = request();
  const replies = await Promise.all(Array.from({ length: 6 }, () => redeemTool(db, user, 'sandbox', op)));
  assert.ok(replies.every((reply) => reply.receipt.status === 'ready'));
  assert.equal(await balance(user), 90);
  assert.deepEqual((await getRedemption(db, user, 'sandbox', op.operationId))?.receipt, replies[0].receipt);
});
test('concurrent debits never overspend and insufficient funds create no receipt', async () => {
  const user = uid(); await fund(user);
  const operations = Array.from({ length: 7 }, () => request('teleport'));
  const results = await Promise.allSettled(operations.map((op) => redeemTool(db, user, 'sandbox', op)));
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 4);
  for (const result of results) if (result.status === 'rejected') assert.equal(result.reason.details?.reason, 'insufficient_points');
  assert.equal(await balance(user), 0);
  for (let i = 0; i < results.length; i++) if (results[i].status === 'rejected') assert.equal(await getRedemption(db, user, 'sandbox', operations[i].operationId), null);
});
test('operation IDs bind all request fields and server costs reject forged free tools', async () => {
  const user = uid(); await fund(user); const op = request(); await redeemTool(db, user, 'sandbox', op);
  for (const changes of [{ runId: 'another_run' }, { contextKey: 'tick:121:other' }, { tool: 'teleport' as const, expectedCost: 25 }]) await assert.rejects(redeemTool(db, user, 'sandbox', { ...op, ...changes }), /different tool request/);
  await assert.rejects(redeemTool(db, user, 'sandbox', { ...request(), expectedCost: 0 }), /price changed/);
  assert.equal(await balance(user), 90);
});
test('paid revive is reserved once per run even under simultaneous operation IDs', async () => {
  const user = uid(); await fund(user); const runId = 'same_run_12345';
  const results = await Promise.allSettled([request('revive', { runId }), request('revive', { runId })].map((op) => redeemTool(db, user, 'sandbox', op)));
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(await balance(user), 50);
});
test('receipt resolution is durable, one-time, and scoped to authenticated customer', async () => {
  const user = uid(); const other = uid(); await fund(user); const op = request('teleport');
  await redeemTool(db, user, 'sandbox', op);
  assert.equal(await getRedemption(db, other, 'sandbox', op.operationId), null);
  await assert.rejects(resolveTool(db, other, 'sandbox', op.operationId, 'refund'), /Unknown tool/);
  await Promise.all(Array.from({ length: 5 }, () => resolveTool(db, user, 'sandbox', op.operationId, 'refund')));
  assert.equal(await balance(user), 100);
  await assert.rejects(resolveTool(db, user, 'sandbox', op.operationId, 'applied'), /already resolved/);
  assert.equal((await getRedemption(db, user, 'sandbox', op.operationId))?.receipt.status, 'refunded');
});
test('racing applied and refund resolution chooses a single terminal outcome', async () => {
  const user = uid(); await fund(user); const op = request('teleport'); await redeemTool(db, user, 'sandbox', op);
  const result = await Promise.allSettled([resolveTool(db, user, 'sandbox', op.operationId, 'applied'), resolveTool(db, user, 'sandbox', op.operationId, 'refund')]);
  assert.equal(result.filter((item) => item.status === 'fulfilled').length, 1);
  const saved = await getRedemption(db, user, 'sandbox', op.operationId);
  assert.equal(saved?.wallet.points, saved?.receipt.status === 'applied' ? 75 : 100);
});
test('FIFO allocations remove only the refunded pack unspent remainder without undoing applied tools', async () => {
  const user = uid(); const first = `${user}_first`; const second = `${user}_second`;
  await fund(user, first, { purchasedAt: 100 }); await fund(user, second, { purchasedAt: 200 });
  const op = request('revive'); await redeemTool(db, user, 'sandbox', op); await resolveTool(db, user, 'sandbox', op.operationId, 'applied');
  await applyVerifiedPurchase(db, user, purchase(first, { refunded: true }));
  assert.equal(await balance(user), 100);
  assert.equal((await getRedemption(db, user, 'sandbox', op.operationId))?.receipt.status, 'applied');
  await applyVerifiedPurchase(db, user, purchase(second, { purchasedAt: 200, refunded: true })); assert.equal(await balance(user), 0);
});
test('refund-before-purchase and duplicate refunds cannot mint points or go negative, including omitted refund quantity', async () => {
  const user = uid(); const tx = `${user}_late`;
  await applyVerifiedPurchase(db, user, purchase(tx, { refunded: true }));
  await fund(user, tx, { quantity: 2 }); assert.equal(await balance(user), 0);
  const next = `${user}_multi`; await fund(user, next, { quantity: 2 }); assert.equal(await balance(user), 200);
  await applyVerifiedPurchase(db, user, purchase(next, { refunded: true }));
  await applyVerifiedPurchase(db, user, purchase(next, { refunded: true })); assert.equal(await balance(user), 0);
});
test('refunding a ready tool after its store pack refund never resurrects revoked credit', async () => {
  const user = uid(); await fund(user); const op = request('teleport'); await redeemTool(db, user, 'sandbox', op);
  await applyVerifiedPurchase(db, user, purchase(user, { refunded: true }));
  const result = await resolveTool(db, user, 'sandbox', op.operationId, 'refund');
  assert.equal(result.wallet.points, 0); assert.equal(result.receipt.status, 'refunded');
});
test('store refunds racing spending preserve balance and lot invariants', async () => {
  const user = uid(); await fund(user);
  await Promise.allSettled([applyVerifiedPurchase(db, user, purchase(user, { refunded: true })), redeemTool(db, user, 'sandbox', request('teleport'))]);
  assert.equal(await balance(user), 0);
  const lots = await walletRef(db, user, 'sandbox').collection('lots').get();
  assert.ok(lots.docs.every((lot) => lot.get('remaining') === 0 && lot.get('revoked') === true));
});
test('same store transaction cannot move to another UID while environments stay isolated', async () => {
  const user = uid(); const other = uid(); await fund(user);
  await assert.rejects(fund(other, user), /already bound/);
  assert.equal(await balance(other), 0); assert.equal((await getWallet(db, user, 'production')).points, 0);
  await fund(other, user, { environment: 'production' }); assert.equal((await getWallet(db, other, 'production')).points, 100);
});
test('sync returns exact provider verification after spending, and client transaction queries never grant credit', async () => {
  const user = uid(); const query = { transactionId: user, productId: 'pullthread_points_100' };
  const first = await syncWallet(db, config, user, 'sandbox', query, provider(user, user)); assert.equal(first.purchase?.verified, true);
  await redeemTool(db, user, 'sandbox', request('revive'));
  const retry = await syncWallet(db, config, user, 'sandbox', query, provider(user, user)); assert.equal(retry.purchase?.verified, true); assert.equal(retry.wallet.points, 50);
  const pending = await syncWallet(db, config, user, 'sandbox', { ...query, transactionId: 'invented' }, provider(user, user)); assert.equal(pending.purchase?.verified, false); assert.equal(pending.wallet.points, 50);
  const refund = await syncWallet(db, config, user, 'sandbox', query, provider(user, user, true)); assert.equal(refund.purchase?.verified, false); assert.equal(refund.wallet.points, 0);
  const stale = await syncWallet(db, config, user, 'sandbox', query, provider(user, user)); assert.equal(stale.purchase?.verified, false); assert.equal(stale.wallet.points, 0);
});
test('trusted webhook uses established customer mapping, global owner for refunds, and retries unknown customers', async () => {
  const user = uid(); const other = uid(); const body = (type: string, app_user_id = user) => ({ api_version: '1.0', event: { id: 'event_123', type, event_timestamp_ms: 300, app_id: 'app_fixture', app_user_id, original_app_user_id: app_user_id, product_id: 'pullthread_points_100', transaction_id: user, quantity: 1, purchased_at_ms: 100, environment: 'SANDBOX', store: 'APP_STORE' } });
  await assert.rejects(receivePurchaseWebhook(db, config, body('NON_RENEWING_PURCHASE')), /mapping is not ready/);
  await bindCustomer(db, user); await receivePurchaseWebhook(db, config, body('NON_RENEWING_PURCHASE')); assert.equal(await balance(user), 100);
  await receivePurchaseWebhook(db, config, body('CANCELLATION', other)); assert.equal(await balance(user), 0); assert.equal(await balance(other), 0);
  await receivePurchaseWebhook(db, config, body('NON_RENEWING_PURCHASE')); assert.equal(await balance(user), 0);
});

test('refunding an unused revive atomically releases its slot; an old refund retry cannot erase a new reservation', async () => {
  const user = uid(); await fund(user); const runId = 'refundable_run'; const first = request('revive', { runId }); const second = request('revive', { runId });
  await redeemTool(db, user, 'sandbox', first);
  const results = await Promise.allSettled([resolveTool(db, user, 'sandbox', first.operationId, 'refund'), redeemTool(db, user, 'sandbox', second)]);
  assert.equal(results[0].status, 'fulfilled');
  // If redemption linearized before the refund it may be rejected; its exact retry must now succeed.
  await redeemTool(db, user, 'sandbox', second);
  assert.equal(await balance(user), 50);
  await resolveTool(db, user, 'sandbox', first.operationId, 'refund');
  await assert.rejects(redeemTool(db, user, 'sandbox', request('revive', { runId })), /already redeemed/);
  await resolveTool(db, user, 'sandbox', second.operationId, 'applied');
  await assert.rejects(redeemTool(db, user, 'sandbox', request('revive', { runId })), /already redeemed/);
});
test('a tool spanning FIFO lots restores only allocations from packs that remain valid', async () => {
  const user = uid(); const first = `${user}_first`; const second = `${user}_second`;
  await fund(user, first); await fund(user, second, { purchasedAt: 200 });
  for (const tool of ['revive', 'teleport', 'preview'] as const) {
    const op = request(tool); await redeemTool(db, user, 'sandbox', op); await resolveTool(db, user, 'sandbox', op.operationId, 'applied');
  }
  const spanning = request('teleport'); await redeemTool(db, user, 'sandbox', spanning); assert.equal(await balance(user), 90);
  await applyVerifiedPurchase(db, user, purchase(first, { refunded: true }));
  const restored = await resolveTool(db, user, 'sandbox', spanning.operationId, 'refund'); assert.equal(restored.wallet.points, 100);
});


test('webhook missing quantity waits for exact V2 verification and credits every verified unit once', async () => {
  const user = uid(); await bindCustomer(db, user);
  const body = { api_version: '1.0', event: { id: 'multi_quantity_event', type: 'NON_RENEWING_PURCHASE',
    event_timestamp_ms: 300, app_id: 'app_fixture', app_user_id: user, original_app_user_id: user,
    product_id: 'pullthread_points_100', transaction_id: user, purchased_at_ms: 100,
    environment: 'SANDBOX', store: 'APP_STORE' } };
  const absent: ProviderFetch = async () => ({ ok: true, status: 200, json: async () => ({ items: [], next_page: null }) });
  await assert.rejects(receivePurchaseWebhook(db, config, body, absent), /quantity is not verified/);
  assert.equal(await balance(user), 0);
  const multiple: ProviderFetch = async (url, init) => {
    const response = await provider(user, user)(url, init);
    const data = await response.json() as { items?: { quantity: number }[] };
    if (data.items) data.items[0].quantity = 2;
    return { ...response, json: async () => data };
  };
  await receivePurchaseWebhook(db, config, body, multiple);
  assert.equal(await balance(user), 200);
  await receivePurchaseWebhook(db, config, body, multiple);
  const synced = await syncWallet(db, config, user, 'sandbox', undefined, multiple);
  assert.equal(synced.wallet.points, 200);
});
