import type { CommerceEnvironment } from '../../src/commerce/contracts';
import type { ProviderConfig } from '../../functions/src/commerce/revenuecat';

/** Secrets are Worker secret bindings; no provider credentials belong in app bundles. */
export interface Env {
  DB: D1Database;
  COSMETICS_ENABLED_ENVIRONMENTS?: string;
  LEADERBOARD_ENABLED_ENVIRONMENTS?: string;
  LEADERBOARD_PRIZES_ENABLED?: string;
  FIREBASE_PROJECT_ID?: string;
  REVENUECAT_PROJECT_ID?: string;
  REVENUECAT_APP_IDS?: string;
  COMMERCE_ENABLED_ENVIRONMENTS?: string;
  REVENUECAT_API_KEY?: string;
  REVENUECAT_WEBHOOK_AUTHORIZATION?: string;
}

export function providerConfiguration(env: Env): ProviderConfig {
  const split = (value: string | undefined) => (value ?? '').split(',').map((item) => item.trim()).filter(Boolean);
  return {
    apiKey: env.REVENUECAT_API_KEY ?? '',
    projectId: (env.REVENUECAT_PROJECT_ID ?? '').trim(),
    appIds: split(env.REVENUECAT_APP_IDS),
    enabledEnvironments: split(env.COMMERCE_ENABLED_ENVIRONMENTS)
      .filter((value): value is CommerceEnvironment => value === 'sandbox' || value === 'production'),
  };
}
