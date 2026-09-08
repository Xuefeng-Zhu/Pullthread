import { CommerceError } from './errors';

export const COMMERCE_REQUEST_TIMEOUT_MS = 15_000;
const endpoints = new Set(['commerceSyncWallet', 'commerceRedeemTool', 'commerceGetRedemption', 'commerceResolveTool']);
const cosmeticEndpoints = new Set(['cosmeticAccount', 'cosmeticPurchase']);
const weeklyEndpoints = new Set(['weeklyRegister', 'weeklyUpload', 'weeklyStandings']);
const statuses: Readonly<Record<string, CommerceError['code']>> = {
  CANCELLED: 'network', UNKNOWN: 'network', INVALID_ARGUMENT: 'invalid', DEADLINE_EXCEEDED: 'network',
  NOT_FOUND: 'invalid', ALREADY_EXISTS: 'invalid', PERMISSION_DENIED: 'account', RESOURCE_EXHAUSTED: 'busy',
  FAILED_PRECONDITION: 'invalid', ABORTED: 'busy', OUT_OF_RANGE: 'invalid', UNIMPLEMENTED: 'unavailable',
  INTERNAL: 'network', UNAVAILABLE: 'network', DATA_LOSS: 'network', UNAUTHENTICATED: 'account',
};
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const invalidResponse = () => new CommerceError('We couldn’t verify the points service response. Please try again.', 'network');

/** One request per action. Uncertain failures stay in the existing recovery journal. */
export function createWorkersCaller(baseUrl: string, getToken: () => Promise<string>, request: typeof fetch = fetch, weekly: boolean | 'cosmetics' = false) {
  return async (endpoint: string, payload: Record<string, unknown>): Promise<unknown> => {
    if (!(weekly === 'cosmetics' ? cosmeticEndpoints : weekly ? weeklyEndpoints : endpoints).has(endpoint) || !record(payload)) throw new CommerceError('This points action is invalid.', 'invalid');
    let body: string;
    try { body = JSON.stringify({ data: payload }, (_key, value: unknown) => {
      if (value === undefined || typeof value === 'function' || typeof value === 'symbol'
        || (typeof value === 'number' && !Number.isFinite(value))) throw new Error('Non-JSON value');
      return value;
    }); }
    catch { throw new CommerceError('This points action is invalid.', 'invalid'); }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new CommerceError('The points service took too long. Please try again.', 'network'));
      }, COMMERCE_REQUEST_TIMEOUT_MS);
    });
    const perform = async () => {
      const token = await getToken();
      if (typeof token !== 'string' || !token.trim() || /\s/.test(token)) {
        throw new CommerceError('Your guest account could not be verified. Please try again.', 'account');
      }
      if (controller.signal.aborted) throw new CommerceError('The points request timed out.', 'network');
      const url = `${baseUrl}/${endpoint}`;
      const response = await request(url, { method: 'POST', headers: {
        'Content-Type': 'application/json', Authorization: `Bearer ${token}`,
      }, body, signal: controller.signal, redirect: 'error' });
      if (response.redirected || (response.url && response.url !== url)) throw invalidResponse();
      const contentType = response.headers.get('content-type') ?? '';
      if (!/^application\/json(?:\s*;|$)/i.test(contentType)) throw invalidResponse();
      let envelope: unknown;
      try { envelope = await response.json(); } catch { throw invalidResponse(); }
      if (!record(envelope) || Object.keys(envelope).length !== 1) throw invalidResponse();
      if ('result' in envelope) {
        if (!response.ok) throw invalidResponse();
        return envelope.result;
      }
      const error = envelope.error;
      if (!record(error) || typeof error.status !== 'string' || !Object.hasOwn(statuses, error.status)
        || typeof error.message !== 'string' || !error.message.trim()) throw invalidResponse();
      const details = error.details;
      if ((endpoint === 'commerceRedeemTool' || endpoint === 'cosmeticPurchase') && response.status === 429 && error.status === 'RESOURCE_EXHAUSTED'
        && record(details) && details.reason === 'insufficient_points' && typeof payload.operationId === 'string'
        && details.operationId === payload.operationId) {
        throw new CommerceError('You need more points for this purchase.', 'insufficient_points', payload.operationId);
      }
      throw new CommerceError(error.message, statuses[error.status]);
    };
    try { return await Promise.race([perform(), timeout]); }
    catch (error) {
      if (error instanceof CommerceError) throw error;
      throw new CommerceError('We couldn’t reach the points service. Please try again.', 'network');
    } finally { if (timer !== undefined) clearTimeout(timer); }
  };
}
