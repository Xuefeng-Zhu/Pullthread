import { COSMETIC_CATALOG } from '../../src/cosmetics/catalog';
import { WeeklyLeaderboard, enabled } from './leaderboard';
import type { ReplayBatch } from '../../src/leaderboard/contracts';
import { CommerceError, environment, object, parseRedemption } from '../../functions/src/commerce/domain';
import { requireConfiguration, validWebhookAuthorization, type ProviderFetch } from '../../functions/src/commerce/revenuecat';
import { AuthenticationError, bearerToken, verifyFirebaseIdToken } from './auth';
import { providerConfiguration, type Env } from './env';
import { receivePurchaseWebhook, syncWallet, type WalletStore } from './service';
import { D1CommerceWallet } from './wallet';

export const MAX_CALLABLE_BODY_BYTES = 16_384;
export const MAX_WEBHOOK_BODY_BYTES = 65_536;
const paths = new Set(['/cosmeticAccount', '/cosmeticPurchase', '/weeklyRegister', '/weeklyUpload', '/weeklyStandings', '/commerceSyncWallet', '/commerceRedeemTool', '/commerceGetRedemption', '/commerceResolveTool', '/commerceRevenueCatWebhook']);

class RequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  } });
}

async function boundedJson(request: Request, limit: number): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new RequestError(415, 'INVALID_ARGUMENT', 'Send an application/json request.');
  }
  const encoding = request.headers.get('content-encoding');
  if (encoding && encoding !== 'identity') throw new RequestError(415, 'INVALID_ARGUMENT', 'Encoded request bodies are not supported.');
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)))) throw new RequestError(400, 'INVALID_ARGUMENT', 'Invalid request length.');
  if (length && Number(length) > limit) throw new RequestError(413, 'RESOURCE_EXHAUSTED', 'Request body is too large.');
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError(400, 'INVALID_ARGUMENT', 'A JSON request body is required.');
  const chunks: Uint8Array[] = [];
  let count = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      count += value.byteLength;
      if (count > limit) {
        await reader.cancel();
        throw new RequestError(413, 'RESOURCE_EXHAUSTED', 'Request body is too large.');
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(count);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes));
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError(400, 'INVALID_ARGUMENT', 'Invalid JSON request body.');
  } finally { reader.releaseLock(); }
}

function failure(error: unknown): Response {
  if (error instanceof AuthenticationError) return json({ error: { status: 'UNAUTHENTICATED', message: error.message } }, 401);
  if (error instanceof RequestError) return json({ error: { status: error.code, message: error.message } }, error.status);
  if (error instanceof CommerceError) {
    const status = { 'invalid-argument': 400, 'failed-precondition': 400, 'permission-denied': 403,
      'not-found': 404, 'already-exists': 409, 'resource-exhausted': 429, unavailable: 503 }[error.code];
    return json({ error: { status: error.code.replaceAll('-', '_').toUpperCase(), message: error.message,
      ...(error.details ? { details: error.details } : {}) } }, status);
  }
  // Provider errors, SQL details, tokens, and secret values never reach clients or logs.
  return json({ error: { status: 'UNAVAILABLE', message: 'Points are temporarily unavailable. Try again shortly.' } }, 503);
}

interface Dependencies {
  verifyToken?: typeof verifyFirebaseIdToken;
  wallet?: (env: Env) => WalletStore;
  providerFetch?: ProviderFetch;
}

/** Dependencies are compile-time test seams; the deployed handler always verifies real tokens. */
export function createCommerceHandler(dependencies: Dependencies = {}) {
  return async (request: Request, env: Env): Promise<Response> => {
    try {
      const url = new URL(request.url);
      const origin = request.headers.get('origin');
      if (origin && origin !== url.origin) throw new RequestError(403, 'PERMISSION_DENIED', 'Browser cross-origin requests are not enabled.');
      if (url.pathname === '/health' && request.method === 'GET') {
        await env.DB.prepare('SELECT 1 FROM commerce_wallets LIMIT 1').first();
        const config = providerConfiguration(env);
        const enabled = config.enabledEnvironments.filter((selected) => {
          try { requireConfiguration(config, selected); return true; } catch { return false; }
        });
        return json({ ok: true, service: 'pullthread-commerce', version: 1, db: 'ready',
          commerce: enabled.length ? 'configured' : 'unconfigured', commerceEnabled: enabled });
      }
      if (!paths.has(url.pathname)) throw new RequestError(404, 'NOT_FOUND', 'Unknown endpoint.');
      if (request.method !== 'POST') throw new RequestError(405, 'INVALID_ARGUMENT', 'Use POST for this endpoint.');
      const config = providerConfiguration(env);
      if (url.pathname === '/commerceRevenueCatWebhook') {
        if (!validWebhookAuthorization(request.headers.get('authorization'), env.REVENUECAT_WEBHOOK_AUTHORIZATION ?? '')) {
          throw new AuthenticationError();
        }
        const body = await boundedJson(request, MAX_WEBHOOK_BODY_BYTES);
        await receivePurchaseWebhook(dependencies.wallet?.(env) ?? new D1CommerceWallet(env.DB), config, body, dependencies.providerFetch);
        return json({ result: { received: true } });
      }
      const uid = await (dependencies.verifyToken ?? verifyFirebaseIdToken)(bearerToken(request), env.FIREBASE_PROJECT_ID);
      const envelope = object(await boundedJson(request, MAX_CALLABLE_BODY_BYTES));
      if (!Object.hasOwn(envelope, 'data') || Object.keys(envelope).some((key) => key !== 'data')) {
        throw new CommerceError('invalid-argument', 'Wrap the request payload in data.');
      }
      const data = object(envelope.data);
      const selected = environment(data.environment);
      if (url.pathname.startsWith('/cosmetic')) {
        if (!enabled(env.COSMETICS_ENABLED_ENVIRONMENTS, selected)) throw new CommerceError('unavailable', 'Button purchases are not open yet.');
        const cosmetics = new D1CommerceWallet(env.DB);
        const result = url.pathname === '/cosmeticAccount' ? await cosmetics.cosmeticAccount(uid, selected)
          : await cosmetics.purchaseCosmetic(uid, selected, { operationId: data.operationId as string, itemId: data.itemId as string, expectedPrice: data.expectedPrice as number });
        return json({ result: { ...result, catalog: COSMETIC_CATALOG } });
      }
      if (url.pathname.startsWith('/weekly')) {
        if (!enabled(env.LEADERBOARD_ENABLED_ENVIRONMENTS, selected)) throw new CommerceError('unavailable', 'Weekly competition is not open yet.');
        const weekly = new WeeklyLeaderboard(env);
        const result = url.pathname === '/weeklyRegister' ? await weekly.register(uid, selected, data.requestId as string, data.ruleset)
          : url.pathname === '/weeklyUpload' ? await weekly.upload(uid, selected, data.runId as string, data.batch as ReplayBatch)
            : await weekly.standings(uid, selected);
        return json({ result });
      }
      const rewardAccess = enabled(env.LEADERBOARD_ENABLED_ENVIRONMENTS, selected);
      if (!rewardAccess) requireConfiguration(config, selected);
      const wallet = dependencies.wallet?.(env) ?? new D1CommerceWallet(env.DB);
      let result: unknown;
      switch (url.pathname) {
        case '/commerceSyncWallet': {
          let configured = true;
          try { requireConfiguration(config, selected); } catch { configured = false; }
          if (!configured && rewardAccess && data.purchase === undefined) result = { wallet: await wallet.getWallet(uid, selected) };
          else result = await syncWallet(wallet, config, uid, selected, data.purchase, dependencies.providerFetch);
          break;
        }
        case '/commerceRedeemTool': result = await wallet.redeemTool(uid, selected, parseRedemption(data)); break;
        case '/commerceGetRedemption': result = await wallet.getRedemption(uid, selected, data.operationId as string); break;
        case '/commerceResolveTool': result = await wallet.resolveTool(uid, selected, data.operationId as string, data.action as 'applied' | 'refund'); break;
      }
      return json({ result });
    } catch (error) { return failure(error); }
  };
}

const handler = createCommerceHandler();
export default { fetch: handler, scheduled: async (_event: ScheduledController, env: Env) => { await new WeeklyLeaderboard(env).settle(); } };
