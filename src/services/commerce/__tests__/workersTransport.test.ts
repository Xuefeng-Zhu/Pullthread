/** @jest-environment node */
import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { resolveCommerceBackend, type CommerceConfig } from '../config';
import { CommerceError, isInsufficientPointsError } from '../errors';
import { COMMERCE_REQUEST_TIMEOUT_MS, createWorkersCaller } from '../workersTransport';
import { createCommerceService } from '..';
import { PaidToolJournal } from '../../../commerce/paidToolJournal';
import type { NativeCommerceRuntime } from '../nativeService';
import type { RedeemToolRequest } from '../../../commerce/contracts';

const config: CommerceConfig = { enabled: true, mock: false, development: true, platform: 'ios', environment: 'sandbox',
  revenueCatKey: 'appl_public', firebase: { apiKey: 'public', projectId: 'project', appId: 'app' },
  backendProvider: 'workers', backendUrl: 'https://points.example.com' };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8' },
});
const wallet = (points = 0) => ({ points, revision: points, environment: 'sandbox' });
const request: RedeemToolRequest = { operationId: 'operation-1', runId: 'run-1', tool: 'preview', expectedCost: 10, contextKey: 'tick:12' };
afterEach(() => { jest.useRealTimers(); });

describe('explicit Workers backend configuration', () => {
  test('missing provider preserves Firebase and never switches because a URL happens to exist', () => {
    expect(resolveCommerceBackend({ ...config, backendProvider: undefined })).toEqual({ provider: 'firebase' });
    expect(resolveCommerceBackend({ ...config, backendProvider: 'firebase' })).toEqual({ provider: 'firebase' });
    expect(resolveCommerceBackend(config)).toEqual({ provider: 'workers', url: 'https://points.example.com' });
    expect(resolveCommerceBackend({ ...config, backendUrl: 'https://points.example.com/' })).toEqual({ provider: 'workers', url: 'https://points.example.com' });
  });

  test.each([
    { backendProvider: 'typo' }, { backendUrl: undefined }, { backendUrl: '' }, { backendUrl: 'not-a-url' },
    { backendUrl: ' http://localhost:8787' }, { backendUrl: 'https:\\points.example.com' }, { backendUrl: 'https:points.example.com' },
    { backendUrl: 'http://points.example.com' }, { backendUrl: 'ftp://points.example.com' },
    { backendUrl: 'https://name:password@points.example.com' }, { backendUrl: 'https://points.example.com/path' },
    { backendUrl: 'https://points.example.com?project=other' }, { backendUrl: 'https://points.example.com/#other' },
    { backendUrl: 'http://localhost:8787', development: false },
    { backendUrl: 'http://127.0.0.1:8787', environment: 'production' as const },
    { backendUrl: 'http://192.168.1.1:8787' }, { backendUrl: 'http://localhost.example.com' },
  ])('rejects unsafe or ambiguous backend configuration without loading providers: %j', override => {
    const load = jest.fn<() => Promise<NativeCommerceRuntime>>();
    expect(() => resolveCommerceBackend({ ...config, ...override })).toThrow(CommerceError);
    expect(createCommerceService({ ...config, ...override }, load).mode).toBe('unavailable');
    expect(load).not.toHaveBeenCalled();
  });

  test.each(['http://localhost:8787', 'http://127.0.0.1:8787', 'http://[::1]:8787'])('allows only explicit development sandbox loopback: %s', backendUrl => {
    expect(resolveCommerceBackend({ ...config, backendUrl })).toEqual({ provider: 'workers', url: backendUrl });
  });
});

describe('authenticated Workers callable transport', () => {
  test.each(['commerceSyncWallet', 'commerceRedeemTool', 'commerceGetRedemption', 'commerceResolveTool'])('posts the unchanged payload to %s with a fresh Firebase token', async endpoint => {
    const fetcher = jest.fn<typeof fetch>().mockResolvedValue(response({ result: { wallet: wallet(25) } }));
    const token = jest.fn(async () => 'firebase-id-token');
    const call = createWorkersCaller(config.backendUrl!, token, fetcher);
    const payload = { environment: 'sandbox', ...request };
    expect(await call(endpoint, payload)).toEqual({ wallet: wallet(25) });
    expect(fetcher).toHaveBeenCalledWith(`${config.backendUrl}/${endpoint}`, expect.objectContaining({
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer firebase-id-token' },
      body: JSON.stringify({ data: payload }), redirect: 'error', signal: expect.any(AbortSignal),
    }));
    expect(token).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test('permits a null receipt result and obtains a new token for each call', async () => {
    const fetcher = jest.fn<typeof fetch>().mockImplementation(async () => response({ result: null }));
    const token = jest.fn<() => Promise<string>>().mockResolvedValueOnce('first-token').mockResolvedValueOnce('refreshed-token');
    const call = createWorkersCaller(config.backendUrl!, token, fetcher);
    expect(await call('commerceGetRedemption', {})).toBeNull();
    expect(await call('commerceGetRedemption', {})).toBeNull();
    expect(fetcher.mock.calls.map(([, options]) => (options!.headers as Record<string, string>).Authorization))
      .toEqual(['Bearer first-token', 'Bearer refreshed-token']);
  });

  test.each(['', ' ', 'token\nother'])('missing or malformed auth token never sends a request: %j', async token => {
    const fetcher = jest.fn<typeof fetch>();
    await expect(createWorkersCaller(config.backendUrl!, async () => token, fetcher)('commerceSyncWallet', {})).rejects.toMatchObject({ code: 'account' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  test.each([
    ['UNAUTHENTICATED', 401, 'account'], ['PERMISSION_DENIED', 403, 'account'], ['INVALID_ARGUMENT', 400, 'invalid'],
    ['FAILED_PRECONDITION', 400, 'invalid'], ['NOT_FOUND', 404, 'invalid'], ['RESOURCE_EXHAUSTED', 429, 'busy'],
    ['INTERNAL', 500, 'network'], ['UNAVAILABLE', 503, 'network'], ['DEADLINE_EXCEEDED', 504, 'network'],
  ])('maps server %s without inventing a successful operation', async (status, httpStatus, code) => {
    const fetcher = jest.fn<typeof fetch>().mockResolvedValue(response({ error: { status, message: 'Server refused this action.' } }, Number(httpStatus)));
    await expect(createWorkersCaller(config.backendUrl!, async () => 'token', fetcher)('commerceSyncWallet', {}))
      .rejects.toMatchObject({ code, message: 'Server refused this action.' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test.each([
    {}, { data: {} }, [], { result: {}, error: { status: 'INTERNAL', message: 'No' } },
    { result: {}, extra: true }, { error: { status: 'not-valid', message: 'No' } },
    { error: { status: 'INTERNAL' } }, { error: 'No' },
  ])('rejects malformed envelopes: %j', async envelope => {
    const fetcher = jest.fn<typeof fetch>().mockResolvedValue(response(envelope));
    await expect(createWorkersCaller(config.backendUrl!, async () => 'token', fetcher)('commerceSyncWallet', {})).rejects.toMatchObject({ code: 'network' });
  });

  test('rejects HTTP failures with success bodies, non-JSON responses, and broken JSON', async () => {
    const fetcher = jest.fn<typeof fetch>();
    const call = createWorkersCaller(config.backendUrl!, async () => 'token', fetcher);
    for (const value of [response({ result: {} }, 500), new Response('<html>error</html>', { status: 502 }),
      new Response('{', { headers: { 'content-type': 'application/json' } })]) {
      fetcher.mockResolvedValueOnce(value);
      await expect(call('commerceSyncWallet', {})).rejects.toMatchObject({ code: 'network' });
    }
  });

  test('rejects route injection and non-JSON bodies before authentication or networking', async () => {
    const fetcher = jest.fn<typeof fetch>();
    const token = jest.fn(async () => 'token');
    const call = createWorkersCaller(config.backendUrl!, token, fetcher);
    await expect(call('../another-route', {})).rejects.toMatchObject({ code: 'invalid' });
    for (const payload of [{ value: NaN }, { value: Infinity }, { value: undefined }, { value: 1n }]) {
      await expect(call('commerceSyncWallet', payload)).rejects.toMatchObject({ code: 'invalid' });
    }
    expect(fetcher).not.toHaveBeenCalled();
    expect(token).not.toHaveBeenCalled();
  });

  test('only a matching authoritative insufficient-points refusal is safe to discard', async () => {
    const fetcher = jest.fn<typeof fetch>();
    const call = createWorkersCaller(config.backendUrl!, async () => 'token', fetcher);
    const failure = { status: 'RESOURCE_EXHAUSTED', message: 'Not enough points.', details: { reason: 'insufficient_points', operationId: request.operationId } };
    for (const [body, status] of [[{ ...failure, details: undefined }, 429],
      [{ ...failure, details: { ...failure.details, operationId: 'other' } }, 429], [failure, 500]] as const) {
      fetcher.mockResolvedValueOnce(response({ error: body }, status));
      expect(isInsufficientPointsError(await call('commerceRedeemTool', request as unknown as Record<string, unknown>).catch(error => error), request.operationId)).toBe(false);
    }
    fetcher.mockResolvedValueOnce(response({ error: failure }, 429));
    expect(isInsufficientPointsError(await call('commerceRedeemTool', { ...request }).catch(error => error), request.operationId)).toBe(true);
  });

  test('aborts timed-out requests and never silently retries a mutation', async () => {
    jest.useFakeTimers();
    const fetcher = jest.fn<typeof fetch>().mockReturnValue(new Promise(() => {}));
    const call = createWorkersCaller(config.backendUrl!, async () => 'token', fetcher);
    const result = expect(call('commerceRedeemTool', { ...request })).rejects.toMatchObject({ code: 'network' });
    await jest.advanceTimersByTimeAsync(COMMERCE_REQUEST_TIMEOUT_MS);
    await result;
    expect(fetcher.mock.calls[0][1]!.signal?.aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('a token refresh that finishes after timeout cannot start a late request', async () => {
    jest.useFakeTimers();
    let finish!: (token: string) => void;
    const fetcher = jest.fn<typeof fetch>();
    const token = new Promise<string>(resolve => { finish = resolve; });
    const result = expect(createWorkersCaller(config.backendUrl!, () => token, fetcher)('commerceSyncWallet', {})).rejects.toMatchObject({ code: 'network' });
    await jest.advanceTimersByTimeAsync(COMMERCE_REQUEST_TIMEOUT_MS);
    await result;
    finish('late-token');
    await Promise.resolve();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('Workers calls preserve purchase and journal recovery', () => {
  function native(fetcher: typeof fetch) {
    return { authenticate: jest.fn(async () => 'existing-firebase-uid'), configure: jest.fn(async () => undefined),
      getProducts: jest.fn(async () => [{ productId: 'pullthread_points_100', priceLabel: '$0.99' }]),
      purchase: jest.fn(async () => ({ status: 'completed' as const, transactionId: 'store-transaction' })),
      call: createWorkersCaller(config.backendUrl!, async () => 'token', fetcher) };
  }

  test('a pending purchase retries its exact verified transaction without another native charge', async () => {
    let interrupted = true;
    const fetcher = jest.fn<typeof fetch>().mockImplementation(async (_url, options) => {
      const payload = JSON.parse(String(options!.body)).data;
      if (!payload.purchase) return response({ result: { wallet: wallet(10) } });
      if (interrupted) { interrupted = false; throw new Error('connection lost'); }
      return response({ result: { wallet: wallet(110), purchase: { ...payload.purchase, verified: true } } });
    });
    const runtime = native(fetcher);
    const service = createCommerceService(config, async () => runtime);
    expect(await service.purchasePoints('pullthread_points_100')).toEqual({ status: 'pending', wallet: wallet(10) });
    expect(await service.getWallet()).toEqual(wallet(110));
    expect(runtime.purchase).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetcher.mock.calls.at(-1)![1]!.body)).data.purchase).toEqual({ productId: 'pullthread_points_100', transactionId: 'store-transaction' });
  });

  test('an interrupted tool debit recovers the same operation, UID and journal namespace', async () => {
    let receipt: Record<string, unknown> | undefined;
    const fetcher = jest.fn<typeof fetch>().mockImplementation(async (url, options) => {
      const payload = JSON.parse(String(options!.body)).data;
      if (String(url).endsWith('/commerceRedeemTool')) { receipt = { ...request, status: 'ready' }; throw new Error('response lost after debit'); }
      if (String(url).endsWith('/commerceGetRedemption')) return response({ result: { wallet: wallet(90), receipt } });
      if (String(url).endsWith('/commerceResolveTool')) { expect(payload.operationId).toBe(request.operationId); receipt = { ...receipt, status: 'applied' }; return response({ result: { wallet: wallet(90), receipt } }); }
      return response({ result: { wallet: wallet(90) } });
    });
    const store = new Map<string, string>();
    const storage = { getItem: async (key: string) => store.get(key) ?? null,
      setItem: async (key: string, value: string) => { store.set(key, value); }, removeItem: async (key: string) => { store.delete(key); } };
    const service = createCommerceService(config, async () => native(fetcher));
    const journal = new PaidToolJournal(storage, service, snapshot => ['before', 'after'].includes(snapshot));
    await expect(journal.redeem(request, 'before', 'after')).rejects.toMatchObject({ code: 'network' });
    expect([...store.keys()]).toEqual(['pullthread.paid-tool-journal.v1.native.sandbox']);
    expect(JSON.parse([...store.values()][0]).accountId).toBe('existing-firebase-uid');
    const restarted = new PaidToolJournal(storage, createCommerceService(config, async () => native(fetcher)), snapshot => ['before', 'after'].includes(snapshot));
    expect((await restarted.recover()).snapshot).toBe('after');
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/commerceRedeemTool'))).toHaveLength(1);
    expect((await restarted.recover()).snapshot).toBe('after');
  });
});
