import { Platform } from 'react-native';
import type { FirebaseOptions } from 'firebase/app';
import type { CommerceEnvironment } from '../../commerce/contracts';
import { CommerceError } from './errors';

export interface CommerceConfig {
  readonly enabled: boolean;
  readonly mock: boolean;
  readonly development: boolean;
  readonly platform: string;
  readonly environment?: CommerceEnvironment;
  readonly revenueCatKey?: string;
  /** Public configuration is validated before native services initialize. */
  readonly backendProvider?: string;
  readonly backendUrl?: string;
  readonly firebase: FirebaseOptions;
}

/** Literal property access is required for Expo's public-variable replacement. */
export function readCommerceConfig(): CommerceConfig {
  const environment = process.env.EXPO_PUBLIC_COMMERCE_ENVIRONMENT;
  return {
    enabled: process.env.EXPO_PUBLIC_COMMERCE_ENABLED === '1',
    mock: process.env.EXPO_PUBLIC_COMMERCE_MODE === 'mock',
    development: __DEV__,
    platform: Platform.OS,
    backendProvider: process.env.EXPO_PUBLIC_COMMERCE_BACKEND_PROVIDER,
    backendUrl: process.env.EXPO_PUBLIC_COMMERCE_BACKEND_URL,
    environment: environment === 'sandbox' || environment === 'production' ? environment : undefined,
    revenueCatKey: Platform.OS === 'ios' ? process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY
      : process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY,
    firebase: {
      apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
      authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
      projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
      appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
      storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    },
  };
}

export type CommerceBackend = { readonly provider: 'firebase' } | { readonly provider: 'workers'; readonly url: string };

/** Old builds retain Functions unless a new build explicitly selects Workers. */
export function resolveCommerceBackend(config: CommerceConfig): CommerceBackend {
  if (config.backendProvider === undefined || config.backendProvider === '' || config.backendProvider === 'firebase') {
    return { provider: 'firebase' };
  }
  if (config.backendProvider !== 'workers') throw new CommerceError('This points backend is not configured correctly.', 'unavailable');
  const value = config.backendUrl;
  if (!value || value !== value.trim() || /[\s\\]/.test(value) || !/^https?:\/\//i.test(value)) {
    throw new CommerceError('The points backend URL is not configured correctly.', 'unavailable');
  }
  let url: URL;
  try { url = new URL(value); }
  catch { throw new CommerceError('The points backend URL is not configured correctly.', 'unavailable'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const localDevelopment = config.development && config.environment === 'sandbox' && loopback && url.protocol === 'http:';
  if ((url.protocol !== 'https:' && !localDevelopment) || url.username || url.password || url.search || url.hash
    || (url.pathname !== '/' && url.pathname !== '')) {
    throw new CommerceError('Use an HTTPS origin for the points backend.', 'unavailable');
  }
  return { provider: 'workers', url: url.origin };
}
