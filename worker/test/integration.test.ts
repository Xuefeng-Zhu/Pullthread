import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';
import { Miniflare, Response as RuntimeResponse, convertV4MiniflareOptions } from 'miniflare';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createWorkersCaller } from '../../src/services/commerce/workersTransport';
import { FIREBASE_JWKS_URL } from '../src/auth';

test('native HTTP adapter, bundled Worker auth, provider fixtures and actual D1 recover an interrupted debit', async () => {
  const project = 'pullthread-integration-test';
  const uid = 'fixture-guest-123';
  const secret = 'fixture-only-provider-secret';
  const webhookSecret = 'fixture-only-webhook-secret-123456789';
  const pair = await generateKeyPair('RS256');
  const publicKey = { ...await exportJWK(pair.publicKey), kid: 'fixture-key', alg: 'RS256', use: 'sig' };
  const now = Math.floor(Date.now() / 1000);
  const idToken = await new SignJWT({ sub: uid, aud: project, iss: `https://securetoken.google.com/${project}`,
    exp: now + 300, iat: now - 1, auth_time: now - 2 }).setProtectedHeader({ alg: 'RS256', kid: 'fixture-key' }).sign(pair.privateKey);
  const bundled = await build({ entryPoints: [fileURLToPath(new URL('../src/entry.ts', import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
    external: ['node:*'], conditions: ['workerd', 'worker', 'browser'] });
  let keyReads = 0;
  const outboundUrls: string[] = [];
  const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundled.outputFiles![0].text,
    compatibilityDate: '2026-09-07', compatibilityFlags: ['nodejs_compat'], d1Databases: ['DB'],
    bindings: { FIREBASE_PROJECT_ID: project, REVENUECAT_PROJECT_ID: 'fixture-project', REVENUECAT_APP_IDS: 'fixture-app',
      REVENUECAT_API_KEY: secret, REVENUECAT_WEBHOOK_AUTHORIZATION: webhookSecret, COMMERCE_ENABLED_ENVIRONMENTS: 'sandbox' },
    // All outbound services are explicit fixtures. This test never contacts Firebase or RevenueCat.
    outboundService: async (request) => {
      outboundUrls.push(request.url);
      if (request.url === FIREBASE_JWKS_URL) {
        keyReads += 1;
        return RuntimeResponse.json({ keys: [publicKey] }, { headers: { 'Cache-Control': 'public, max-age=3600' } });
      }
      assert.equal(request.headers.get('authorization'), `Bearer ${secret}`);
      if (request.url === 'https://api.revenuecat.com/v2/projects/fixture-project/products/fixture-product') {
        return RuntimeResponse.json({ id: 'fixture-product', app_id: 'fixture-app', type: 'consumable', store_identifier: 'pullthread_points_100' });
      }
      assert.equal(request.url, `https://api.revenuecat.com/v2/projects/fixture-project/customers/${uid}/purchases?environment=sandbox&limit=100`);
      return RuntimeResponse.json({ items: [{ customer_id: uid, original_customer_id: uid, product_id: 'fixture-product',
        purchased_at: 100, quantity: 1, status: 'owned', environment: 'sandbox', store: 'app_store',
        store_purchase_identifier: '90071992547409931234', ownership: 'purchased' }], next_page: null });
    },
  }));
  try {
    const database = await runtime.getD1Database('DB');
    const migration = (await Promise.all(['0001_commerce.sql', '0002_weekly.sql', '0003_cosmetics.sql', '0004_creative_tools.sql']
      .map(file => readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8')))).join('\n');
    await database.exec(migration.split('\n').filter((line) => line.trim() && !line.trimStart().startsWith('--')).join('\n'));
    let loseDebitReply = true;
    const request: typeof fetch = async (input, init) => {
      const response = await runtime.dispatchFetch(String(input), init as Parameters<typeof runtime.dispatchFetch>[1]);
      if (String(input).endsWith('/commerceRedeemTool') && loseDebitReply) {
        loseDebitReply = false;
        assert.equal(response.status, 200);
        throw new Error('Fixture loses the reply after the durable debit.');
      }
      return response as unknown as Response;
    };
    const call = createWorkersCaller('https://commerce.example', async () => idToken, request);
    const syncPayload = { environment: 'sandbox', purchase: { productId: 'pullthread_points_100', transactionId: '90071992547409931234' } };
    const synced = await call('commerceSyncWallet', syncPayload).catch((error: unknown) => {
      throw new Error(`Fixture sync failed after outbound requests: ${JSON.stringify(outboundUrls)}`, { cause: error });
    });
    assert.deepEqual(synced, {
      wallet: { points: 100, revision: 1, environment: 'sandbox' }, purchase: { ...syncPayload.purchase, verified: true },
    });
    const operation = { environment: 'sandbox', operationId: 'operation-123', runId: 'run-12345678',
      tool: 'teleport', expectedCost: 25, contextKey: 'tick:120:pocket:4' };
    await assert.rejects(call('commerceRedeemTool', operation), /reach the points service/);
    const recovered = await call('commerceGetRedemption', { environment: 'sandbox', operationId: operation.operationId }) as { wallet: { points: number }; receipt: { status: string } };
    assert.equal(recovered.wallet.points, 75);
    assert.equal(recovered.receipt.status, 'ready');
    assert.deepEqual(await call('commerceRedeemTool', operation), recovered);
    const refunded = await call('commerceResolveTool', { environment: 'sandbox', operationId: operation.operationId, action: 'refund' }) as { wallet: { points: number }; receipt: { status: string } };
    assert.equal(refunded.wallet.points, 100);
    assert.equal(refunded.receipt.status, 'refunded');
    const webhook = { api_version: '1.0', event: { id: 'fixture-event', type: 'CANCELLATION', app_id: 'fixture-app',
      product_id: 'pullthread_points_100', environment: 'SANDBOX', store: 'APP_STORE', transaction_id: '90071992547409931234',
      purchased_at_ms: 100, event_timestamp_ms: 200, original_app_user_id: uid, app_user_id: uid } };
    const refundEvent = await runtime.dispatchFetch('https://commerce.example/commerceRevenueCatWebhook', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: webhookSecret }, body: JSON.stringify(webhook) });
    assert.equal(refundEvent.status, 200);
    const final = await call('commerceSyncWallet', syncPayload) as { wallet: { points: number }; purchase: { verified: boolean } };
    assert.equal(final.wallet.points, 0);
    assert.equal(final.purchase.verified, false);
    assert.equal(keyReads, 1);
  } finally { await runtime.dispose(); }
});
