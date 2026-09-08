import { createLocalJWKSet, errors, jwtVerify, type JSONWebKeySet, type JWTVerifyGetKey } from 'jose';
import { CommerceError } from '../../functions/src/commerce/domain';

/** Google publishes the Firebase securetoken signing account as both X.509 and JWKS. */
export const FIREBASE_JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
export class AuthenticationError extends Error {
  constructor() { super('Sign in as a guest before using points.'); }
}
export type AuthFetch = (url: string, init: RequestInit) => Promise<Pick<Response, 'ok' | 'headers' | 'json'>>;

/** Cache only until Google's max-age; an unknown kid can trigger a bounded early refresh. */
export function createGoogleKeyResolver(fetcher: AuthFetch = fetch, now: () => number = Date.now): JWTVerifyGetKey {
  let keys: ReturnType<typeof createLocalJWKSet> | undefined;
  let expiresAt = 0;
  let refreshedAt = Number.NEGATIVE_INFINITY;
  let refreshing: Promise<void> | undefined;
  const refresh = async () => {
    if (!refreshing) refreshing = (async () => {
      try {
        const response = await fetcher(FIREBASE_JWKS_URL, {
          headers: { Accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(5_000),
        });
        if (!response.ok) throw new Error('Key service unavailable.');
        const body = await response.json() as Partial<JSONWebKeySet> | null;
        if (!body || !Array.isArray(body.keys) || !body.keys.length || body.keys.length > 64) throw new Error('Invalid signing keys.');
        const maxAge = /(?:^|,)\s*max-age=(\d+)/i.exec(response.headers.get('cache-control') ?? '');
        const lifetime = maxAge ? Math.min(Number(maxAge[1]), 86_400) * 1000 : 300_000;
        keys = createLocalJWKSet(body as JSONWebKeySet);
        refreshedAt = now();
        expiresAt = refreshedAt + lifetime;
      } catch {
        throw new CommerceError('unavailable', 'Account verification is temporarily unavailable.');
      }
    })().finally(() => { refreshing = undefined; });
    await refreshing;
  };
  return async (header, token) => {
    if (!keys || now() >= expiresAt) await refresh();
    try { return await keys!(header, token); }
    catch (error) {
      if (!(error instanceof errors.JWKSNoMatchingKey) || now() - refreshedAt < 30_000) throw error;
      await refresh();
      return keys!(header, token);
    }
  };
}

const googleKeys = createGoogleKeyResolver();
const verifiedTokens = new Map<string, { uid: string; expiresAt: number }>();

/** Firebase's documented issuer/audience/time/subject checks, with Google's RS256 signature. */
export async function verifyFirebaseIdToken(token: string, projectId: string | undefined,
  keys: JWTVerifyGetKey = googleKeys): Promise<string> {
  if (!projectId || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) {
    throw new CommerceError('unavailable', 'Account verification is not configured.');
  }
  try {
    if (!token || token.length > 8192) throw new AuthenticationError();
    const cacheKey = `${projectId}:${token}`;
    const cached = keys === googleKeys ? verifiedTokens.get(cacheKey) : undefined;
    if (cached && cached.expiresAt > Date.now()) return cached.uid;
    verifiedTokens.delete(cacheKey);
    const { payload, protectedHeader } = await jwtVerify(token, keys, {
      algorithms: ['RS256'], issuer: `https://securetoken.google.com/${projectId}`, audience: projectId,
      requiredClaims: ['exp', 'iat', 'sub', 'auth_time'], clockTolerance: 0,
    });
    const seconds = Math.floor(Date.now() / 1000);
    if (typeof protectedHeader.kid !== 'string' || !protectedHeader.kid || protectedHeader.kid.length > 256
      || payload.aud !== projectId || typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 128
      || !Number.isSafeInteger(payload.exp) || !Number.isSafeInteger(payload.iat) || payload.iat! > seconds
      || typeof payload.auth_time !== 'number' || !Number.isSafeInteger(payload.auth_time)
      || payload.auth_time < 0 || payload.auth_time > seconds || payload.iat! < 0) throw new AuthenticationError();
    if (keys === googleKeys) {
      if (verifiedTokens.size >= 128) verifiedTokens.delete(verifiedTokens.keys().next().value!);
      verifiedTokens.set(cacheKey, { uid: payload.sub, expiresAt: Math.min(payload.exp! * 1000, Date.now() + 60000) });
    }
    return payload.sub;
  } catch (error) {
    if (error instanceof CommerceError) throw error;
    throw new AuthenticationError();
  }
}

export function bearerToken(request: Request): string {
  const authorization = request.headers.get('authorization');
  const match = authorization?.length && authorization.length <= 8200
    ? /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(authorization) : null;
  if (!match) throw new AuthenticationError();
  return match[1];
}
