import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, URL as NodeURL } from 'node:url';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose';
import { CommerceError, identifier, transactionKey, type VerifiedPurchase } from '../../functions/src/commerce/domain';
import { AuthenticationError, createGoogleKeyResolver, FIREBASE_JWKS_URL, verifyFirebaseIdToken } from '../src/auth';
import { createCommerceHandler, MAX_CALLABLE_BODY_BYTES, MAX_WEBHOOK_BODY_BYTES } from '../src/index';
import { providerConfiguration, type Env } from '../src/env';
import { MAX_PROVIDER_REQUESTS, MAX_SYNC_CHANGES, MAX_SYNC_TRANSACTIONS, syncWallet, type WalletStore } from '../src/service';
import type { StoredTransaction } from '../src/wallet';

const project = 'pullthread-unit-test';
const uid = 'anonymous-user-123';
let pair: Awaited<ReturnType<typeof generateKeyPair>>;
let other: Awaited<ReturnType<typeof generateKeyPair>>;
let keys: ReturnType<typeof createLocalJWKSet>;
before(async () => {
  pair = await generateKeyPair('RS256');
  other = await generateKeyPair('RS256');
  keys = createLocalJWKSet({ keys: [{ ...await exportJWK(pair.publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' }] });
});

async function token(claims: JWTPayload = {}, key = pair.privateKey, kid: string | undefined = 'test-key') {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ iss: `https://securetoken.google.com/${project}`, aud: project, sub: uid,
    exp: now + 300, iat: now - 30, auth_time: now - 60, firebase: { sign_in_provider: 'anonymous' }, ...claims })
    .setProtectedHeader({ alg: 'RS256', ...(kid ? { kid } : {}) }).sign(key);
}

function configured(overrides: Partial<Env> = {}): Env {
  return {
    DB: { prepare: () => ({ first: async () => null }) } as unknown as D1Database,
    FIREBASE_PROJECT_ID: project, REVENUECAT_PROJECT_ID: 'rc-project', REVENUECAT_APP_IDS: 'ios-app',
    REVENUECAT_API_KEY: 'test-only-provider-key', COMMERCE_ENABLED_ENVIRONMENTS: 'sandbox',
    REVENUECAT_WEBHOOK_AUTHORIZATION: 'test-only-webhook-authorization-123456789', ...overrides,
  };
}

function walletSpy() {
  const calls: { name: string; args: unknown[] }[] = [];
  const wallet: WalletStore = {
    bindCustomer: async (...args) => { calls.push({ name: 'bindCustomer', args }); },
    getWallet: async (...args) => { calls.push({ name: 'getWallet', args }); return { points: 100, revision: 1, environment: args[1] }; },
    applyVerifiedPurchase: async (...args) => { calls.push({ name: 'applyVerifiedPurchase', args }); return { points: 100, revision: 1, environment: args[1].environment }; },
    findTransaction: async () => null,
    findTransactions: async (...args) => { calls.push({ name: 'findTransactions', args }); return new Map(); },
    findCustomer: async () => null,
    redeemTool: async (...args) => { calls.push({ name: 'redeemTool', args }); return {
      wallet: { points: 90, revision: 2, environment: args[1] }, receipt: { ...args[2], status: 'ready' },
    }; },
    getRedemption: async (...args) => { identifier(args[2]); calls.push({ name: 'getRedemption', args }); return null; },
    resolveTool: async (...args) => {
      identifier(args[2]);
      if (args[3] !== 'applied' && args[3] !== 'refund') throw new CommerceError('invalid-argument', 'Invalid resolution.');
      calls.push({ name: 'resolveTool', args });
      return { wallet: { points: 90, revision: 3, environment: args[1] }, receipt: {
        operationId: args[2], runId: 'run-12345678', contextKey: 'tick:10', tool: 'preview', expectedCost: 10,
        status: args[3] === 'applied' ? 'applied' : 'refunded',
      } };
    },
  };
  const handler = createCommerceHandler({ wallet: () => wallet,
    verifyToken: (value, selectedProject) => verifyFirebaseIdToken(value, selectedProject, keys),
    providerFetch: async () => new Response(JSON.stringify({ items: [], next_page: null })),
  });
  return { wallet, calls, handler };
}

function request(path: string, bearer?: string, body: unknown = { data: { environment: 'sandbox' } }, headers: Record<string, string> = {}) {
  return new Request(`https://commerce.example${path}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

test('Firebase ID tokens verify RS256 signature and preserve the anonymous account UID', async () => {
  assert.equal(await verifyFirebaseIdToken(await token(), project, keys), uid);
});

test('Firebase verification rejects incorrect identity, expiry, signatures, and missing required claims', async (t) => {
  const now = Math.floor(Date.now() / 1000);
  const invalid: [string, JWTPayload][] = [
    ['issuer', { iss: 'https://accounts.google.com' }], ['audience', { aud: 'another-project' }],
    ['audience array', { aud: [project, 'another-project'] }], ['expired', { exp: now - 1 }],
    ['missing expiry', { exp: undefined }], ['future issued-at', { iat: now + 60 }],
    ['missing issued-at', { iat: undefined }], ['future authentication', { auth_time: now + 60 }],
    ['missing authentication', { auth_time: undefined }], ['empty UID', { sub: '' }],
    ['oversized UID', { sub: 'u'.repeat(129) }],
  ];
  for (const [name, claims] of invalid) await t.test(name, async () => {
    await assert.rejects(verifyFirebaseIdToken(await token(claims), project, keys), AuthenticationError);
  });
  await assert.rejects(verifyFirebaseIdToken(await token({}, other.privateKey), project, keys), AuthenticationError);
  await assert.rejects(verifyFirebaseIdToken(await token({}, pair.privateKey, 'unknown-key'), project, keys), AuthenticationError);
  await assert.rejects(verifyFirebaseIdToken(await token({}, pair.privateKey, ''), project, keys), AuthenticationError);
  const symmetric = await new SignJWT({ sub: uid }).setProtectedHeader({ alg: 'HS256', kid: 'test-key' }).sign(new Uint8Array(32));
  await assert.rejects(verifyFirebaseIdToken(symmetric, project, keys), AuthenticationError);
  await assert.rejects(verifyFirebaseIdToken(await token(), '', keys), (error: unknown) => error instanceof CommerceError && error.code === 'unavailable');
});

test('Google key resolution pins the official endpoint, caches by max-age, and limits unknown-key refreshes', async () => {
  let time = 0;
  let calls = 0;
  const jwk = { ...await exportJWK(pair.publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' };
  const resolve = createGoogleKeyResolver(async (url, init) => {
    calls += 1;
    assert.equal(url, FIREBASE_JWKS_URL);
    assert.equal(init.redirect, 'manual');
    assert.ok(init.signal);
    return new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'Cache-Control': 'public, max-age=60' } });
  }, () => time);
  const jws = { payload: '', protected: '', signature: '' };
  await resolve({ alg: 'RS256', kid: 'test-key' }, jws);
  time = 59_000;
  await resolve({ alg: 'RS256', kid: 'test-key' }, jws);
  assert.equal(calls, 1);
  time = 60_001;
  await resolve({ alg: 'RS256', kid: 'test-key' }, jws);
  assert.equal(calls, 2);
  for (let attempt = 0; attempt < 4; attempt++) await assert.rejects(async () => resolve({ alg: 'RS256', kid: 'unknown' }, jws));
  assert.equal(calls, 2);
  time = 91_000;
  await assert.rejects(async () => resolve({ alg: 'RS256', kid: 'unknown' }, jws));
  assert.equal(calls, 3);
});

test('signing-key service failure fails closed without exposing upstream payloads', async () => {
  const resolve = createGoogleKeyResolver(async () => { throw new Error('private upstream diagnostics'); });
  await assert.rejects(verifyFirebaseIdToken(await token(), project, resolve), (error: unknown) =>
    error instanceof CommerceError && error.code === 'unavailable' && !error.message.includes('private'));
});

test('Worker signing-key fetch never follows a redirect and rejects the response', async () => {
  let calls = 0;
  const resolve = createGoogleKeyResolver(async (url, init) => {
    calls += 1;
    assert.equal(url, FIREBASE_JWKS_URL);
    assert.equal(init.redirect, 'manual');
    return new Response(null, { status: 302, headers: { Location: 'https://untrusted.example/keys' } });
  });
  await assert.rejects(verifyFirebaseIdToken(await token(), project, resolve),
    (error: unknown) => error instanceof CommerceError && error.code === 'unavailable');
  assert.equal(calls, 1);
});

test('health probes the D1 schema and publishes only readiness and enabled environment names', async () => {
  const { handler } = walletSpy();
  const response = await handler(new Request('https://commerce.example/health'), configured({ COMMERCE_ENABLED_ENVIRONMENTS: '' }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, service: 'pullthread-commerce', version: 1, db: 'ready', commerce: 'unconfigured', commerceEnabled: [] });
  const missing = await handler(new Request('https://commerce.example/health'), configured({ DB: {
    prepare: () => { throw new Error('private SQL schema and provider key'); },
  } as unknown as D1Database }));
  assert.equal(missing.status, 503);
  assert.doesNotMatch(await missing.text(), /private|provider key|SQL/);
});

test('commerce is disabled by default and authentication is required even when disabled', async () => {
  assert.deepEqual(providerConfiguration({ DB: {} as D1Database }).enabledEnvironments, []);
  const { handler, calls } = walletSpy();
  const env = configured({ COMMERCE_ENABLED_ENVIRONMENTS: '' });
  const missing = await handler(request('/commerceSyncWallet'), env);
  assert.equal(missing.status, 401);
  assert.equal((await missing.json() as any).error.status, 'UNAUTHENTICATED');
  const disabled = await handler(request('/commerceSyncWallet', await token()), env);
  assert.equal(disabled.status, 503);
  assert.equal((await disabled.json() as any).error.status, 'UNAVAILABLE');
  assert.deepEqual(calls, []);
});

test('all callable endpoints preserve the result envelope and use only the verified token UID', async () => {
  const { handler, calls } = walletSpy();
  const bearer = await token();
  const env = configured();
  const sync = await handler(request('/commerceSyncWallet', bearer, { data: { environment: 'sandbox', uid: 'forged-user' } }), env);
  assert.deepEqual(await sync.json(), { result: { wallet: { points: 100, revision: 1, environment: 'sandbox' } } });
  const redeem = await handler(request('/commerceRedeemTool', bearer, { data: { environment: 'sandbox',
    uid: 'forged-user', operationId: 'operation-123', runId: 'run-12345678', tool: 'preview', expectedCost: 10, contextKey: 'tick:10' } }), env);
  assert.equal((await redeem.json() as any).result.receipt.status, 'ready');
  const get = await handler(request('/commerceGetRedemption', bearer, { data: { environment: 'sandbox', operationId: 'operation-123' } }), env);
  assert.deepEqual(await get.json(), { result: null });
  const resolve = await handler(request('/commerceResolveTool', bearer, { data: { environment: 'sandbox', operationId: 'operation-123', action: 'applied' } }), env);
  assert.equal((await resolve.json() as any).result.receipt.status, 'applied');
  assert.ok(calls.length >= 5);
  for (const call of calls.filter((call) => call.name !== 'findTransactions')) assert.equal(call.args[0], uid);
});

test('invalid envelopes, payloads and content types fail before wallet mutations', async () => {
  const { handler, calls } = walletSpy();
  const bearer = await token();
  for (const body of ['{bad', {}, [], { data: [] }, { data: { environment: 'other' } }, { data: {}, extra: true }]) {
    assert.equal((await handler(request('/commerceSyncWallet', bearer, body), configured())).status, 400);
  }
  assert.equal((await handler(request('/commerceSyncWallet', bearer, '{}', { 'Content-Type': 'text/plain' }), configured())).status, 415);
  assert.equal((await handler(request('/commerceSyncWallet', bearer, '{}', { 'Content-Encoding': 'gzip' }), configured())).status, 415);
  assert.equal((await handler(request('/commerceSyncWallet', bearer, '{}', { 'Content-Length': 'not-a-number' }), configured())).status, 400);
  assert.deepEqual(calls, []);
});

test('both declared and undeclared oversized bodies are rejected without wallet access', async () => {
  const { handler, calls } = walletSpy();
  const bearer = await token();
  const oversized = JSON.stringify({ data: { environment: 'sandbox', padding: 'x'.repeat(MAX_CALLABLE_BODY_BYTES) } });
  const streamed = await handler(request('/commerceSyncWallet', bearer, oversized), configured());
  assert.equal(streamed.status, 413);
  const declared = await handler(request('/commerceSyncWallet', bearer, '{}', { 'Content-Length': String(MAX_CALLABLE_BODY_BYTES + 1) }), configured());
  assert.equal(declared.status, 413);
  assert.deepEqual(calls, []);
});

test('browser routes require an exact origin allowlist and a narrow authenticated preflight', async () => {
  const { handler, calls } = walletSpy();
  assert.equal((await handler(request('/commerceSyncWallet', await token(), undefined, { Origin: 'https://other.example' }), configured())).status, 403);
  assert.equal((await handler(new Request('https://commerce.example/commerceSyncWallet', { method: 'OPTIONS' }), configured())).status, 405);
  const env = configured({ WEB_ALLOWED_ORIGINS: 'https://play.example,http://localhost:8081' });
  const preflight = await handler(new Request('https://commerce.example/commerceSyncWallet', { method: 'OPTIONS', headers: {
    Origin: 'https://play.example', 'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'authorization, content-type',
  } }), env);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://play.example');
  assert.equal(preflight.headers.get('access-control-allow-methods'), 'POST, OPTIONS');
  const bearer = await token();
  const browser = await handler(request('/commerceSyncWallet', bearer, undefined, { Origin: 'https://play.example' }), env);
  assert.equal(browser.status, 200);
  assert.equal(browser.headers.get('access-control-allow-origin'), 'https://play.example');
  const forbiddenHeader = await handler(new Request('https://commerce.example/commerceSyncWallet', { method: 'OPTIONS', headers: {
    Origin: 'https://play.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-forged',
  } }), env);
  assert.equal(forbiddenHeader.status, 403);
  assert.equal((await handler(new Request('https://commerce.example/commerceSyncWallet'), configured())).status, 405);
  assert.equal((await handler(request('/unknown', await token()), configured())).status, 404);
  assert.equal(calls.filter((call) => call.name === 'getWallet').length, 1);
});

test('wallet errors retain machine-readable insufficient-points details; unknown errors are redacted', async () => {
  const { handler, wallet } = walletSpy();
  const body = { data: { environment: 'sandbox', operationId: 'operation-123', runId: 'run-12345678', tool: 'preview', expectedCost: 10, contextKey: 'tick:10' } };
  wallet.redeemTool = async () => { throw new CommerceError('resource-exhausted', 'Not enough points.', { reason: 'insufficient_points', operationId: 'operation-123' }); };
  const denied = await handler(request('/commerceRedeemTool', await token(), body), configured());
  assert.equal(denied.status, 429);
  assert.deepEqual(await denied.json(), { error: { status: 'RESOURCE_EXHAUSTED', message: 'Not enough points.', details: { reason: 'insufficient_points', operationId: 'operation-123' } } });
  wallet.redeemTool = async () => { throw new Error('test-only-provider-key SQL connection details'); };
  const unknown = await handler(request('/commerceRedeemTool', await token(), body), configured());
  assert.equal(unknown.status, 503);
  assert.doesNotMatch(await unknown.text(), /provider-key|SQL|connection/);
});

test('webhooks use their separate secret, bound bodies, and fail safely on invalid provider payloads', async () => {
  const { handler, calls } = walletSpy();
  const env = configured();
  const ignored = { api_version: '1.0', event: { type: 'INITIAL_PURCHASE' } };
  assert.equal((await handler(request('/commerceRevenueCatWebhook', await token(), ignored), env)).status, 401);
  const headers = { Authorization: env.REVENUECAT_WEBHOOK_AUTHORIZATION! };
  const accepted = await handler(request('/commerceRevenueCatWebhook', undefined, ignored, headers), env);
  assert.equal(accepted.status, 200);
  assert.deepEqual(await accepted.json(), { result: { received: true } });
  assert.equal((await handler(request('/commerceRevenueCatWebhook', undefined, {}, headers), env)).status, 400);
  const tooLarge = await handler(request('/commerceRevenueCatWebhook', undefined, 'x'.repeat(MAX_WEBHOOK_BODY_BYTES + 1), headers), env);
  assert.equal(tooLarge.status, 413);
  assert.deepEqual(calls, []);
});

function purchase(id: number, changes: Partial<VerifiedPurchase> = {}): VerifiedPurchase {
  return { transactionId: `store-${id}`, productId: 'pullthread_points_100', store: 'app_store',
    environment: 'sandbox', purchasedAt: id, quantity: 1, refunded: false, ...changes };
}

function historyFixture(stored: readonly StoredTransaction[] = []) {
  const { wallet } = walletSpy();
  const records = new Map(stored.map((item) => [transactionKey(item), item]));
  const applied: VerifiedPurchase[] = [];
  const lookups: string[][] = [];
  let singleReads = 0;
  wallet.findTransactions = async (ids) => {
    lookups.push([...ids]);
    return new Map(ids.filter((id) => records.has(id)).map((id) => [id, records.get(id)!]));
  };
  wallet.findTransaction = async (id) => { singleReads += 1; return records.get(id) ?? null; };
  wallet.getWallet = async (customer, environment) => ({ environment, revision: applied.length,
    points: [...records.values()].filter((item) => item.uid === customer && item.environment === environment && !item.refunded)
      .reduce((sum, item) => sum + item.points, 0),
  });
  wallet.applyVerifiedPurchase = async (customer, item) => {
    applied.push(item);
    const existing = records.get(transactionKey(item));
    if (!existing?.refunded) records.set(transactionKey(item), { ...item, uid: customer, points: item.quantity * 100 });
    return wallet.getWallet(customer, item.environment);
  };
  const provider = (purchases: readonly VerifiedPurchase[]) => async (url: string) => new Response(JSON.stringify(url.includes('/products/')
    ? { id: 'provider-product', store_identifier: 'pullthread_points_100', type: 'consumable', app_id: 'ios-app' }
    : { items: purchases.map((item) => ({ customer_id: uid, original_customer_id: uid, product_id: 'provider-product',
      store_purchase_identifier: item.transactionId, store: item.store, environment: item.environment,
      purchased_at: item.purchasedAt, quantity: item.quantity, ownership: 'purchased', status: item.refunded ? 'refunded' : 'owned' })), next_page: null }));
  return { wallet, records, applied, lookups, provider, singleReads: () => singleReads };
}

test('hundreds of unchanged store receipts use bulk lookup without per-receipt reads or writes', async () => {
  const purchases = Array.from({ length: 250 }, (_, index) => purchase(index));
  const fixture = historyFixture(purchases.map((item) => ({ ...item, uid, points: 100 })));
  const result = await syncWallet(fixture.wallet, providerConfiguration(configured()), uid, 'sandbox', undefined, fixture.provider(purchases));
  assert.equal(result.wallet.points, 25_000);
  assert.equal(fixture.lookups.length, 1);
  assert.equal(fixture.lookups[0].length, 250);
  assert.equal(fixture.singleReads(), 0);
  assert.equal(fixture.applied.length, 0);
});

test('new purchase backlogs reconcile durably across bounded syncs and prioritize the explicit purchase', async () => {
  const purchases = Array.from({ length: 7 }, (_, index) => purchase(index));
  const fixture = historyFixture();
  const query = { transactionId: purchases[6].transactionId, productId: purchases[6].productId };
  const first = await syncWallet(fixture.wallet, providerConfiguration(configured()), uid, 'sandbox', query, fixture.provider(purchases));
  assert.equal(fixture.applied.length, MAX_SYNC_CHANGES);
  assert.equal(fixture.applied[0].transactionId, query.transactionId);
  assert.equal(first.wallet.points, MAX_SYNC_CHANGES * 100);
  assert.equal(first.purchase?.verified, true);
  const second = await syncWallet(fixture.wallet, providerConfiguration(configured()), uid, 'sandbox', undefined, fixture.provider(purchases));
  assert.equal(second.wallet.points, 700);
  assert.equal(fixture.applied.length, 7);
  await syncWallet(fixture.wallet, providerConfiguration(configured()), uid, 'sandbox', undefined, fixture.provider(purchases));
  assert.equal(fixture.applied.length, 7);
});

test('more than four pending refunds cannot return a healthy wallet or grant an explicit purchase early', async () => {
  const old = Array.from({ length: 6 }, (_, index) => purchase(index));
  const fixture = historyFixture(old.map((item) => ({ ...item, uid, points: 100 })));
  const newPurchase = purchase(7);
  const purchases = [...old.map((item) => ({ ...item, refunded: true })), newPurchase];
  const query = { transactionId: newPurchase.transactionId, productId: newPurchase.productId };
  await assert.rejects(syncWallet(fixture.wallet, providerConfiguration(configured()), uid, 'sandbox', query, fixture.provider(purchases)),
    (error: unknown) => error instanceof CommerceError && error.code === 'unavailable');
  assert.equal(fixture.applied.length, MAX_SYNC_CHANGES);
  assert.ok(fixture.applied.every((item) => item.refunded));
  assert.equal(fixture.records.has(transactionKey(newPurchase)), false);
  const reconciled = await syncWallet(fixture.wallet, providerConfiguration(configured()), uid, 'sandbox', query, fixture.provider(purchases));
  assert.equal(reconciled.wallet.points, 100);
  assert.equal(reconciled.purchase?.verified, true);
  assert.equal(fixture.applied.length, 7);
});

test('bulk skipping preserves alias ownership, quantity conflicts, and permanent refund tombstones', async () => {
  const item = purchase(1);
  const query = { transactionId: item.transactionId, productId: item.productId };
  const alias = historyFixture([{ ...item, uid: 'original-owner', points: 100 }]);
  assert.equal((await syncWallet(alias.wallet, providerConfiguration(configured()), uid, 'sandbox', query, alias.provider([item]))).purchase?.verified, false);
  assert.equal(alias.applied.length, 0);
  const refunded = historyFixture([{ ...item, uid, refunded: true, points: 100 }]);
  assert.equal((await syncWallet(refunded.wallet, providerConfiguration(configured()), uid, 'sandbox', query, refunded.provider([item]))).purchase?.verified, false);
  assert.equal(refunded.applied.length, 0);
  const conflict = historyFixture([{ ...item, uid, points: 100 }]);
  await assert.rejects(syncWallet(conflict.wallet, providerConfiguration(configured()), uid, 'sandbox', undefined,
    conflict.provider([{ ...item, quantity: 2 }])), (error: unknown) => error instanceof CommerceError && error.code === 'permission-denied');
  assert.equal(conflict.applied.length, 0);
});

test('provider fetch and history limits fail closed before any wallet reconciliation', async () => {
  const fixture = historyFixture();
  let fetched = 0;
  await assert.rejects(syncWallet(fixture.wallet, providerConfiguration(configured()), uid, 'sandbox', undefined, async (url) => {
    fetched += 1;
    const next = new URL(url);
    next.searchParams.set('page', String(fetched + 1));
    return new Response(JSON.stringify({ items: [], next_page: next.href }));
  }), (error: unknown) => error instanceof CommerceError && error.code === 'unavailable');
  assert.equal(fetched, MAX_PROVIDER_REQUESTS);
  const tooMany = Array.from({ length: MAX_SYNC_TRANSACTIONS + 1 }, (_, index) => purchase(index));
  await assert.rejects(syncWallet(fixture.wallet, providerConfiguration(configured()), uid, 'sandbox', undefined, fixture.provider(tooMany)),
    (error: unknown) => error instanceof CommerceError && error.code === 'unavailable');
  assert.equal(fixture.applied.length, 0);
  assert.equal(fixture.lookups.length, 0);
});

test('Worker provider fetch uses manual redirects and never forwards credentials to a redirect target', async () => {
  const fixture = historyFixture();
  let calls = 0;
  await assert.rejects(syncWallet(fixture.wallet, providerConfiguration(configured()), uid, 'sandbox', undefined, async (url, init) => {
    calls += 1;
    assert.equal(new URL(url).origin, 'https://api.revenuecat.com');
    assert.equal(init.redirect, 'manual');
    assert.ok(new Headers(init.headers).get('authorization'));
    return new Response(null, { status: 307, headers: { Location: 'https://untrusted.example/collect' } });
  }), (error: unknown) => error instanceof CommerceError && error.code === 'unavailable');
  assert.equal(calls, 1);
  assert.equal(fixture.lookups.length, 0);
  assert.equal(fixture.applied.length, 0);
});

test('conflicting provider duplicates cannot put an owned receipt ahead of its cancellation', async () => {
  const item = purchase(1);
  const fixture = historyFixture();
  const query = { transactionId: item.transactionId, productId: item.productId };
  const result = await syncWallet(fixture.wallet, providerConfiguration(configured()), uid, 'sandbox', query,
    fixture.provider([item, { ...item, refunded: true }, item]));
  assert.equal(result.purchase?.verified, false);
  assert.equal(result.wallet.points, 0);
  assert.deepEqual(fixture.applied, [{ ...item, refunded: true }]);
});

test('the deployed entry actually starts in workerd and reports migrated D1 readiness', async () => {
  const bundled = await build({
    entryPoints: [fileURLToPath(new NodeURL('../src/entry.ts', import.meta.url))], bundle: true, write: false,
    format: 'esm', platform: 'browser', target: 'es2022', external: ['node:*'], conditions: ['workerd', 'worker', 'browser'],
  });
  const runtime = new Miniflare(convertV4MiniflareOptions({
    modules: true, script: bundled.outputFiles![0].text, compatibilityDate: '2026-09-07',
    compatibilityFlags: ['nodejs_compat'], d1Databases: ['DB'], bindings: { FIREBASE_PROJECT_ID: project },
  }));
  try {
    const unmigrated = await runtime.dispatchFetch('https://commerce.example/health');
    assert.equal(unmigrated.status, 503);
    const database = await runtime.getD1Database('DB');
    const migration = await readFile(new NodeURL('../migrations/0001_commerce.sql', import.meta.url), 'utf8');
    await database.exec(migration.split('\n').filter((line) => line.trim() && !line.trimStart().startsWith('--')).join('\n'));
    const health = await runtime.dispatchFetch('https://commerce.example/health');
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true, service: 'pullthread-commerce', version: 1, db: 'ready', commerce: 'unconfigured', commerceEnabled: [] });
    const unauthorized = await runtime.dispatchFetch('https://commerce.example/commerceSyncWallet', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"data":{"environment":"sandbox"}}',
    });
    assert.equal(unauthorized.status, 401);
    assert.equal((await unauthorized.json() as any).error.status, 'UNAUTHENTICATED');
    const browser = await runtime.dispatchFetch('https://commerce.example/commerceSyncWallet', {
      method: 'POST', headers: { Origin: 'https://other.example', 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.equal(browser.status, 403);
    assert.equal(browser.headers.get('access-control-allow-origin'), null);
  } finally { await runtime.dispose(); }
});
