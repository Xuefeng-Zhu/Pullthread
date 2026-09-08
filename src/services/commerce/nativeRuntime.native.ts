import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApps, initializeApp } from 'firebase/app';
import * as FirebaseAuth from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import Purchases, { PRODUCT_CATEGORY, PURCHASES_ERROR_CODE, type PurchasesPackage } from 'react-native-purchases';
import { resolveCommerceBackend, type CommerceConfig } from './config';
import { CommerceError } from './errors';
import type { NativeCommerceRuntime } from './nativeService';
import { requirePointPack } from './validation';
import { createWorkersCaller } from './workersTransport';

let configuration: Promise<void> | undefined;
let configuredIdentity: { accountId: string; apiKey: string } | undefined;
let authentication: Promise<string> | undefined;
let authenticatedIdentity: string | undefined;

export async function loadNativeRuntime(config: CommerceConfig, weekly: boolean | 'cosmetics' = false): Promise<NativeCommerceRuntime> {
  const backend = resolveCommerceBackend(config);
  const name = 'pullthread-commerce';
  const app = getApps().find((candidate) => candidate.name === name) ?? initializeApp(config.firebase, name);
  if (app.options.projectId !== config.firebase.projectId || app.options.appId !== config.firebase.appId) {
    throw new CommerceError('Restart the app to use this store configuration.', 'unavailable');
  }
  // Firebase's web declaration omits this documented React Native export.
  const persistence = (FirebaseAuth as typeof FirebaseAuth & {
    getReactNativePersistence(storage: typeof AsyncStorage): FirebaseAuth.Persistence;
  }).getReactNativePersistence;
  if (typeof persistence !== 'function') throw new CommerceError('Use a native development build to access points.', 'unavailable');
  let auth: FirebaseAuth.Auth;
  try { auth = FirebaseAuth.initializeAuth(app, { persistence: persistence(AsyncStorage) }); }
  catch (error) {
    if ((error as { code?: string }).code !== 'auth/already-initialized') throw error;
    auth = FirebaseAuth.getAuth(app);
  }
  const functions = backend.provider === 'firebase' ? getFunctions(app, 'us-west1') : undefined;
  const packages = new Map<string, PurchasesPackage>();
  const checkIdentity = () => {
    const expected = authenticatedIdentity ?? configuredIdentity?.accountId;
    if (expected && auth.currentUser?.uid !== expected) {
      throw new CommerceError('Your guest account changed. Restart before using points.', 'account');
    }
  };
  const workersCall = backend.provider === 'workers' ? createWorkersCaller(backend.url, async () => {
    checkIdentity();
    const user = auth.currentUser;
    if (!user) throw new CommerceError('Your guest account is unavailable. Please try again.', 'account');
    // The SDK refreshes an expiring ID token while retaining this persisted UID.
    const token = await user.getIdToken();
    checkIdentity();
    if (auth.currentUser?.uid !== user.uid) throw new CommerceError('Your guest account changed. Restart before using points.', 'account');
    return token;
  }, fetch, weekly) : undefined;
  return {
    authenticate: () => {
      if (!authentication) authentication = (async () => {
        await auth.authStateReady();
        const uid = (auth.currentUser ?? (await FirebaseAuth.signInAnonymously(auth)).user).uid;
        if (authenticatedIdentity && uid !== authenticatedIdentity) throw new CommerceError('Your guest account changed. Restart before using points.', 'account');
        authenticatedIdentity = uid;
        return uid;
      })().finally(() => { authentication = undefined; });
      return authentication;
    },
    configure: (accountId, apiKey) => {
      if (configuredIdentity && (configuredIdentity.accountId !== accountId || configuredIdentity.apiKey !== apiKey)) {
        return Promise.reject(new CommerceError('Restart the app to reconnect your guest account.', 'account'));
      }
      if (!configuration) {
        configuredIdentity = { accountId, apiKey };
        configuration = (async () => {
          if (!await Purchases.isConfigured()) Purchases.configure({ apiKey, appUserID: accountId });
          if (await Purchases.getAppUserID() !== accountId) throw new CommerceError('Your store account could not be verified.', 'account');
        })().catch((error) => { configuration = undefined; configuredIdentity = undefined; throw error; });
      }
      return configuration;
    },
    getProducts: async () => {
      const offering = (await Purchases.getOfferings()).all.points;
      packages.clear();
      for (const item of offering?.availablePackages ?? []) {
        try { requirePointPack(item.product.identifier); } catch { continue; }
        if (item.product.productCategory === PRODUCT_CATEGORY.NON_SUBSCRIPTION) packages.set(item.product.identifier, item);
      }
      return [...packages.values()].map((item) => ({ productId: item.product.identifier, priceLabel: item.product.priceString }));
    },
    purchase: async (productId) => {
      checkIdentity();
      const product = packages.get(productId);
      if (!product) throw new CommerceError('This points pack is unavailable.', 'unavailable');
      try {
        const result = await Purchases.purchasePackage(product);
        return { status: 'completed', transactionId: result.transaction.transactionIdentifier };
      } catch (error) {
        const failure = error as { code?: string; userCancelled?: boolean };
        if (failure.userCancelled || failure.code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) return { status: 'cancelled' };
        if (failure.code === PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR) return { status: 'pending' };
        throw error;
      }
    },
    call: async (endpoint, payload) => {
      // Never silently purchase/redeem under a changed anonymous identity.
      checkIdentity();
      return workersCall ? workersCall(endpoint, payload) : (await httpsCallable(functions!, endpoint)(payload)).data;
    },
  };
}
