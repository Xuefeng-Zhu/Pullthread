import { Platform } from 'react-native';
import type { FirebaseOptions } from 'firebase/app';
import type { CommerceEnvironment } from '../../commerce/contracts';

export interface CommerceConfig {
  readonly enabled: boolean;
  readonly mock: boolean;
  readonly development: boolean;
  readonly platform: string;
  readonly environment?: CommerceEnvironment;
  readonly revenueCatKey?: string;
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
