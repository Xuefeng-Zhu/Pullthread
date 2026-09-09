import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { CommerceError, parseRedemption } from '../src/commerce/domain';
import { CREATIVE_TOOLS, TOOL_COSTS } from '../../src/commerce/contracts';
import { fetchVerifiedPurchases, parsePurchaseWebhook, requireConfiguration, validWebhookAuthorization, type ProviderConfig, type ProviderFetch } from '../src/commerce/revenuecat';

const config: ProviderConfig = { apiKey: 'server-only-fixture', projectId: 'proj_fixture', appIds: ['app_fixture'], enabledEnvironments: ['sandbox'] };
const purchase = { object: 'purchase', id: 'purc_fixture', customer_id: 'guest_fixture', original_customer_id: 'guest_fixture', product_id: 'prod_fixture', purchased_at: 123, quantity: 1, status: 'owned', environment: 'sandbox', store: 'app_store', store_purchase_identifier: '20000000000000001', ownership: 'purchased' };
const product = { object: 'product', id: 'prod_fixture', store_identifier: 'pullthread_points_100', type: 'one_time', one_time: { is_consumable: true }, app_id: 'app_fixture' };
const event = { type: 'NON_RENEWING_PURCHASE', id: 'evt_fixture', event_timestamp_ms: 124, app_id: 'app_fixture', original_app_user_id: 'guest_fixture', app_user_id: 'guest_fixture', aliases: [], product_id: 'pullthread_points_100', transaction_id: purchase.store_purchase_identifier, purchased_at_ms: 123, environment: 'SANDBOX', store: 'APP_STORE' };
function response(data: unknown, status = 200) { return { ok: status === 200, status, json: async () => data }; }
function provider(items: unknown[] = [purchase], suppliedProduct: unknown = product): ProviderFetch { return async (url) => response(url.includes('/products/') ? suppliedProduct : { items, next_page: null }); }

test('tool catalog price and complete operation binding are validated server-side', () => {
  const request = { operationId: 'operation_1', runId: 'run_123456', tool: 'preview', expectedCost: 10, contextKey: 'tick:120:source' };
  assert.equal(parseRedemption(request).expectedCost, 10);
  for (const change of [{ expectedCost: 0 }, { tool: 'credits' }, { runId: '../user' }, { contextKey: '' }, { operationId: 'short' }]) assert.throws(() => parseRedemption({ ...request, ...change }), CommerceError);
});
test('all creative tools use authoritative prices and reject forged prices', () => {
  for (const tool of CREATIVE_TOOLS) {
    const request = { operationId: 'creative_operation', runId: 'creative_run', tool, expectedCost: TOOL_COSTS[tool], contextKey: '0:endless-0:creative' };
    assert.deepEqual(parseRedemption(request), request);
    assert.throws(() => parseRedemption({ ...request, expectedCost: 0 }), CommerceError);
  }
});
test('missing config and production stay unavailable; webhook checks the exact configured authorization', () => {
  assert.throws(() => requireConfiguration({ ...config, apiKey: '' }, 'sandbox'), /not configured/);
  assert.throws(() => requireConfiguration(config, 'production'), /not configured/);
  const secret = 'Bearer fixture-long-random-authorization';
  assert.equal(validWebhookAuthorization(secret, secret), true);
  for (const supplied of ['', 'Bearer fixture-long-random-authorizatioN', undefined, ['secret']]) assert.equal(validWebhookAuthorization(supplied, secret), false);
  assert.equal(validWebhookAuthorization('short', 'short'), false);
});
test('provider API and webhook share the exact store transaction identity without numeric precision loss', async () => {
  const parsed = await fetchVerifiedPurchases(config, 'guest_fixture', 'sandbox', provider());
  assert.equal(parsed[0].transactionId, '20000000000000001');
  assert.deepEqual(parsePurchaseWebhook({ api_version: '1.0', event }, config)?.purchase, parsed[0]);
  await assert.rejects(fetchVerifiedPurchases(config, 'guest_fixture', 'sandbox', provider([{ ...purchase, store_purchase_identifier: 20000000000000001 }])), /Invalid verified/);
});
test('refund status and cancellation become matching tombstones; unrelated or temporary events grant nothing', async () => {
  assert.equal((await fetchVerifiedPurchases(config, 'guest_fixture', 'sandbox', provider([{ ...purchase, status: 'refunded' }])))[0].refunded, true);
  assert.equal(parsePurchaseWebhook({ api_version: '1.0', event: { ...event, type: 'CANCELLATION' } }, config)?.purchase.refunded, true);
  for (const type of ['TEST', 'INITIAL_PURCHASE', 'TEMPORARY_ENTITLEMENT_GRANT', 'TRANSFER']) assert.equal(parsePurchaseWebhook({ api_version: '1.0', event: { ...event, type } }, config), null);
  for (const change of [{ store: 'PROMOTIONAL' }, { is_family_share: true }, { product_id: 'unrelated' }]) assert.equal(parsePurchaseWebhook({ api_version: '1.0', event: { ...event, ...change } }, config), null);
});
test('only purchased consumables from allowlisted apps and stores in selected environment are reconciled', async () => {
  for (const change of [{ store: 'test_store' }, { ownership: 'family_shared' }, { environment: 'production' }]) assert.deepEqual(await fetchVerifiedPurchases(config, 'guest_fixture', 'sandbox', provider([{ ...purchase, ...change }])), []);
  for (const change of [{ type: 'subscription' }, { app_id: 'app_other' }, { store_identifier: 'unlisted' }, { one_time: { is_consumable: false } }]) assert.deepEqual(await fetchVerifiedPurchases(config, 'guest_fixture', 'sandbox', provider([purchase], { ...product, ...change })), []);
  await assert.rejects(fetchVerifiedPurchases(config, 'guest_fixture', 'sandbox', provider([{ ...purchase, customer_id: 'other', original_customer_id: 'other' }])), /another customer/);
  await assert.rejects(fetchVerifiedPurchases(config, 'guest_fixture', 'sandbox', provider([{ ...purchase, status: 'pending' }])), /Unknown purchase status/);
});
test('pagination follows only the same customer endpoint and never redirects a server key elsewhere', async () => {
  const seen: string[] = [];
  const result = await fetchVerifiedPurchases(config, 'guest_fixture', 'sandbox', async (url, init) => {
    seen.push(url); assert.equal(init.redirect, 'error'); assert.equal((init.headers as Record<string, string>).Authorization, `Bearer ${config.apiKey}`);
    if (url.includes('/products/')) return response(product);
    return response(url.includes('starting_after') ? { items: [{ ...purchase, store_purchase_identifier: 'tx2' }], next_page: null }
      : { items: [purchase], next_page: '/v2/projects/proj_fixture/customers/guest_fixture/purchases?starting_after=purc_fixture' });
  });
  assert.equal(result.length, 2); assert.equal(seen.filter((url) => url.includes('/products/')).length, 1);
  assert.ok(seen.filter((url) => url.includes('/purchases')).every((url) => url.includes('environment=sandbox')));
  for (const next_page of ['https://attacker.invalid/capture', '/v2/projects/proj_fixture/customers/other/purchases']) {
    let calls = 0;
    await assert.rejects(fetchVerifiedPurchases(config, 'guest_fixture', 'sandbox', async () => { calls += 1; return response({ items: [], next_page }); }), /pagination/);
    assert.equal(calls, 1);
  }
});
test('provider outages fail closed and a customer not created in RevenueCat yet has no purchases', async () => {
  assert.deepEqual(await fetchVerifiedPurchases(config, 'guest_fixture', 'sandbox', async () => response({}, 404)), []);
  await assert.rejects(fetchVerifiedPurchases(config, 'guest_fixture', 'sandbox', async () => response({}, 429)), /temporarily unavailable/);
  await assert.rejects(fetchVerifiedPurchases(config, 'guest_fixture', 'sandbox', async () => { throw new Error('network'); }), /temporarily unavailable/);
});

test('all commerce callables reject unauthenticated requests before touching provider or wallet', async () => {
  const endpoints = await import('../src/commerce/endpoints.js');
  for (const callable of [endpoints.commerceSyncWallet, endpoints.commerceRedeemTool, endpoints.commerceGetRedemption, endpoints.commerceResolveTool]) {
    await assert.rejects(callable.run({ data: { environment: 'sandbox' } } as Parameters<typeof callable.run>[0]), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'unauthenticated');
  }
});
