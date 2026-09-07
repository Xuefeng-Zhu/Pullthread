import { getFirestore } from 'firebase-admin/firestore';
import { defineSecret, defineString } from 'firebase-functions/params';
import { HttpsError, onCall, onRequest, type CallableRequest } from 'firebase-functions/v2/https';
import { CommerceError, environment, object, parseRedemption } from './domain';
import { requireConfiguration, validWebhookAuthorization, type ProviderConfig } from './revenuecat';
import { receivePurchaseWebhook, syncWallet } from './service';
import { getRedemption, redeemTool, resolveTool } from './wallet';

const apiKey = defineSecret('REVENUECAT_API_KEY');
const webhookAuthorization = defineSecret('REVENUECAT_WEBHOOK_AUTHORIZATION');
const projectId = defineString('REVENUECAT_PROJECT_ID', { default: '' });
const appIds = defineString('REVENUECAT_APP_IDS', { default: '' });
const enabledEnvironments = defineString('COMMERCE_ENABLED_ENVIRONMENTS', { default: '' });
function configuration(): ProviderConfig {
  return { apiKey: apiKey.value(), projectId: projectId.value(), appIds: appIds.value().split(',').map((id) => id.trim()).filter(Boolean),
    enabledEnvironments: enabledEnvironments.value().split(',').map((item) => item.trim()).filter((item) => item === 'sandbox' || item === 'production') };
}
const options = { region: 'us-west1', memory: '256MiB' as const, timeoutSeconds: 120, maxInstances: 5, secrets: [apiKey], enforceAppCheck: false };
function context(request: CallableRequest<unknown>) {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in as a guest before using points.');
  const data = object(request.data);
  const selected = environment(data.environment);
  const config = configuration();
  requireConfiguration(config, selected);
  return { uid: request.auth.uid, data, selected, config };
}
async function callable<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (error instanceof HttpsError) throw error;
    if (error instanceof CommerceError) throw new HttpsError(error.code, error.message, error.details);
    throw new HttpsError('unavailable', 'Points are temporarily unavailable. Try again shortly.');
  }
}
export const commerceSyncWallet = onCall<unknown>(options, (request) => callable(async () => {
  const { uid, data, selected, config } = context(request);
  return syncWallet(getFirestore(), config, uid, selected, data.purchase);
}));
export const commerceRedeemTool = onCall<unknown>(options, (request) => callable(async () => {
  const { uid, data, selected } = context(request);
  return redeemTool(getFirestore(), uid, selected, parseRedemption(data));
}));
export const commerceGetRedemption = onCall<unknown>(options, (request) => callable(async () => {
  const { uid, data, selected } = context(request);
  return getRedemption(getFirestore(), uid, selected, data.operationId as string);
}));
export const commerceResolveTool = onCall<unknown>(options, (request) => callable(async () => {
  const { uid, data, selected } = context(request);
  return resolveTool(getFirestore(), uid, selected, data.operationId as string, data.action as 'applied' | 'refund');
}));
export const commerceRevenueCatWebhook = onRequest({ region: 'us-west1', memory: '256MiB', timeoutSeconds: 60, maxInstances: 5, secrets: [apiKey, webhookAuthorization] }, async (request, response) => {
  if (request.method !== 'POST') { response.status(405).send('Method not allowed.'); return; }
  if (!validWebhookAuthorization(request.headers.authorization, webhookAuthorization.value())) { response.status(401).send('Unauthorized.'); return; }
  try {
    await receivePurchaseWebhook(getFirestore(), configuration(), request.body);
    response.status(200).send('OK');
  } catch (error) {
    // Do not expose provider payloads or authorization secrets in responses or logs.
    const status = error instanceof CommerceError && error.code !== 'unavailable' ? 400 : 503;
    response.status(status).send(status === 503 ? 'Retry later.' : 'Invalid purchase event.');
  }
});
