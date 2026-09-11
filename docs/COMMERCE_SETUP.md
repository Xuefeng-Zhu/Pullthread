# Points and tools: backend setup

New builds use Cloudflare Workers and D1 for the points ledger. Firebase remains the guest identity provider and can stay on Spark; this path does not deploy Firebase Functions. Development builds can use RevenueCat Test Store without an Apple or Google developer account. Live purchases require a connected native store or RevenueCat Web Billing provider, RevenueCat secrets, and the explicit environment gate. See [the dated setup record](IPHONE_SHOP_SETUP_STATUS.md) for what is actually connected.

## Contract

Firebase identity project: `pullthread-xuefeng-zhu`. All commerce requests require a Firebase ID token; anonymous guest authentication is supported. Configure RevenueCat with the exact Firebase UID as its app user ID. The first wallet sync establishes the server-owned customer mapping. A receipt is globally unique by store transaction ID and sandbox/production environment, so RevenueCat aliases cannot grant it to two guests. Guest identity recovery across reinstall is outside this milestone; an anonymous account's points are tied to its Firebase UID.

The Worker accepts `POST /<callable-name>` with `Authorization: Bearer <Firebase ID token>` and a JSON `{data: request}` body. Success is `{result: response}`. Errors use `{error: {status, message, details?}}`, with uppercase statuses such as `RESOURCE_EXHAUSTED`; the native adapter preserves the existing error and recovery contract. The Worker verifies the token signature, issuer, audience, subject, and time claims against Google's public signing keys. No Firebase admin key is required.

| Callable | Request | Response |
| --- | --- | --- |
| `commerceSyncWallet` | `{environment, purchase?: {transactionId, productId}}` | `{wallet, purchase?: {transactionId, productId, verified}}` |
| `commerceRedeemTool` | `{environment, operationId, runId, tool, expectedCost, contextKey}` | `{wallet, receipt}` |
| `commerceGetRedemption` | `{environment, operationId}` | `{wallet, receipt}` or `null` |
| `commerceResolveTool` | `{environment, operationId, action: 'applied' \| 'refund'}` | `{wallet, receipt}` |

`environment` is `sandbox` or `production`. Wallets contain `points`, monotonic `revision`, and `environment`. Shared wire types and catalog live in `src/commerce/contracts.ts`. Current tool prices are preview 10, teleport 25, revive 50. Pack identifiers are `pullthread_points_100`, `pullthread_points_550`, and `pullthread_points_1200`.

The optional purchase query is only matched against server-verified transactions. It never grants credit. Pass the SDK's **string** `transactionIdentifier`, corresponding to the provider's `store_purchase_identifier` and webhook `transaction_id`; preserve strings to avoid numeric precision loss. A verified transaction remains verifiable after its points have been spent. Pending or cancelled purchases do not mint points.

An insufficient-balance callable error uses `resource-exhausted` with `details: {reason: 'insufficient_points', operationId}`. Only this explicit reason proves the requested operation was not debited; a generic quota/network error is ambiguous and must be recovered by operation ID.

A tool operation atomically deducts its catalog price and writes a durable `ready` receipt. Retrying the same operation returns the existing receipt; changing its run, tool, price, or context is rejected. Resolve only after applying the effect, or refund when it cannot be applied. A resolution is terminal and idempotent. One paid revive is allowed per run ID. A ready receipt reserves that slot; refunding an unused revive atomically releases it, while an applied revive keeps it consumed. The client journals and restores the frozen run snapshot before resolving interrupted work.

## RevenueCat and stores

1. Create the three **consumable** products in App Store Connect / Google Play and import them into the RevenueCat project. Keep their exact store identifiers above. Configure the RevenueCat offering with the exact identifier `points`, containing these packs. Intended US store setup prices are 100 points for $0.99, 550 for $4.99, and 1,200 for $9.99; these are catalog setup choices, while the app displays localized store-provided prices. Prices displayed by the app come from the store, never from a hard-coded currency amount.
2. Configure RevenueCat SDK public keys separately from server secrets. Configure purchases with Firebase's authenticated guest UID. The server accepts purchased App Store, Play Store, RevenueCat Billing, Stripe Billing, and Paddle Billing consumables from allowlisted apps. It also accepts RevenueCat Test Store purchases only when the selected environment is `sandbox`. Promotional and family-shared purchases do not grant points. Use the matching provider's sandbox purchase for end-to-end validation.
3. Create a RevenueCat **V2 secret API key** with read scopes `customer_information:purchases:read` and `project_configuration:products:read`. The backend reads every customer purchase page, validates its product/app/store/environment, and credits only owned purchases. V2 refunded purchases reconcile revocations. Unknown statuses fail closed. Product responses must report `consumable` or `one_time` with `one_time.is_consumable: true`.
4. Set Worker secrets `REVENUECAT_API_KEY` and `REVENUECAT_WEBHOOK_AUTHORIZATION` using `npx wrangler secret put <name>` from `worker/`. Use a long random webhook authorization value, at least 24 characters. Set that exact value as RevenueCat's webhook Authorization header. Never use an `EXPO_PUBLIC_` variable for either secret. The HTTP handler compares the entire header in constant time.
5. Set `worker/wrangler.jsonc` variables `REVENUECAT_PROJECT_ID` to the RevenueCat project ID, `REVENUECAT_APP_IDS` to a comma-separated allowlist of every enabled RevenueCat native and web app ID, and `COMMERCE_ENABLED_ENVIRONMENTS` to `sandbox` for the sandbox acceptance phase. Its default is empty, disabling commerce. Set `WEB_ALLOWED_ORIGINS` to comma-separated exact browser origins, including scheme and port with no path. Enabling `production` is a separate release decision after real store verification.
6. Deploy the Worker and D1 schema using the steps below. The webhook endpoint is `<Worker HTTPS URL>/commerceRevenueCatWebhook`. Subscribe to `NON_RENEWING_PURCHASE` and `CANCELLATION` events for the configured environments. A configured authorization header is required; there is no unauthenticated webhook grant path.

### Test Store configuration

1. Use the RevenueCat project's pre-provisioned Test Store app. Create the three consumable products with the exact point-pack identifiers and prices above, then attach each one to its matching package in the `points` offering.
2. Add the Test Store app ID to `REVENUECAT_APP_IDS`. For an internal iPhone or Android Debug build, set that platform's public SDK key to the project's `test_...` key and keep `EXPO_PUBLIC_COMMERCE_ENVIRONMENT=sandbox`. RevenueCat rejects Test Store keys in Release builds; use the real platform public SDK key there.
3. Set Sandbox testing access to the intended testers. Configure the purchase webhook for the Test Store app, or for all project apps, while retaining the sandbox-only environment and the non-renewing purchase and cancellation event filters.
4. A Test Store checkout is simulated by RevenueCat and does not use Apple StoreKit, App Store Connect, or real money. Never include a `test_...` key in an App Store, Play Store, or production build. Replace it with the platform's public key after the real store connection is configured and verified.

Test Store requires a supported RevenueCat SDK. Pullthread uses `react-native-purchases` 10.8.0, newer than the React Native minimum of 9.5.4 documented by RevenueCat.

### Web Billing configuration

1. In RevenueCat, connect Stripe to RevenueCat Billing and create a Web Billing app configuration. Create the three consumable products with the exact pack identifiers and intended prices above, then attach them to the `points` offering. Paddle Billing can use the same server path when configured instead.
2. Add the RevenueCat web app ID to `REVENUECAT_APP_IDS`. Set `EXPO_PUBLIC_REVENUECAT_WEB_API_KEY` to that app's public `rcb_...` SDK key. Never expose the RevenueCat V2 secret or webhook authorization value to the browser.
3. Add each deployed web origin to `WEB_ALLOWED_ORIGINS`. Browser requests use the same Firebase anonymous UID and authenticated Worker calls as native. Points stay with that browser profile; clearing site data or using another browser can create a different guest wallet.
4. Build with `EXPO_PUBLIC_COMMERCE_ENABLED=1`, `EXPO_PUBLIC_COMMERCE_BACKEND_PROVIDER=workers`, and the Worker URL. Run a sandbox checkout for all three packs, then verify wallet credit, a paid tool debit, refresh recovery, duplicate delivery, and a refund before enabling production.

RevenueCat's React Native SDK supplies its web implementation through the same `react-native-purchases` package. The browser build selects the `rcb_` key and waits for Firebase Auth before configuring purchases. Checkout prices come from the provider offering.

## Workers deployment and client configuration

From `worker/`, install the locked dependencies and authenticate the official Wrangler CLI to the intended Cloudflare account. Create the database once, then replace the placeholder `database_id` in `wrangler.jsonc` with the returned ID. If the checked-in ID is already configured, inspect that database rather than creating another one.

```sh
npm ci
npx wrangler login --scopes account:read user:read workers_scripts:write d1:write
npx wrangler d1 create pullthread-commerce
npm run db:remote
npm run deploy
```

Use Workers and D1 on the account's free plan. No paid-plan upgrade is part of this setup. Free-tier limits are enforced by Cloudflare, so usage beyond those limits can make requests unavailable. Check [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) and [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) before scaling.

The Worker reads existing transaction records in batches of 1,000 IDs and skips unchanged receipts. A wallet sync applies at most four verified changes, with refunds first and the explicitly queried purchase next. Larger grant backlogs reconcile across subsequent syncs, so the balance can initially omit unprocessed grants. If known refunds remain after a batch, that sync returns unavailable until subsequent syncs finish them. Changes already committed remain durable and idempotent. Reconciliation fails closed above 3,000 unique transactions or 35 provider HTTP requests; accounts beyond these limits require an explicit reconciliation/scaling change. Normal worst-case sync work stays below D1's 50-query free limit; unusually high concurrent contention can still require a retry. These bounds do not establish live CPU or daily-quota acceptance.

New builds set `EXPO_PUBLIC_COMMERCE_BACKEND_PROVIDER=workers` and `EXPO_PUBLIC_COMMERCE_BACKEND_URL` to the returned HTTPS origin. Keep the same Firebase public configuration and the platform's RevenueCat public key. The app never falls back to another ledger after a Workers error. Builds with an absent provider retain the legacy Firebase Functions transport for compatibility. Browser builds use RevenueCat Web Billing rather than App Store or Play Store checkout.

Enable Anonymous Auth in the existing Firebase project. Complete the provider setup, deploy with the sandbox gate, and set `EXPO_PUBLIC_COMMERCE_ENABLED=1` for the sandbox acceptance build. Verify `/health`, an authenticated wallet sync, and an actual provider sandbox purchase; the health endpoint alone is not purchase proof. Sandbox and production share a database but have separate wallet/transaction namespaces. Gate all browser origins explicitly; `*` is never accepted for authenticated commerce requests.

### Existing ledger cutover

This repository retains `functions/` and its tests for legacy builds. Changing the transport does not copy Firestore data. Before cutting over any environment that has served purchases, freeze its commerce writes and migrate **all** wallet revisions, customer mappings, transaction ownership/refund tombstones, purchase lots, tool receipts/allocations, and revive reservations into D1. Reconcile balances and receipts before updating clients or webhooks. Preserve Firebase UIDs and operation IDs. An empty D1 database must never replace an active paid wallet. No Firestore-to-D1 data migration is claimed by this change.

The current iPhone Debug build has sandbox commerce enabled, but its simulated Test Store checkout has not yet demonstrated a connected paid wallet; the dated setup record states the verified scope. Keep the legacy backend and configuration available until existing pending tool operations have been reconciled. Switching environments or backends midway through a pending operation requires the matching ledger records first.

Provider reference: [webhook delivery and authorization](https://www.revenuecat.com/docs/integrations/webhooks), [event fields](https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields), [customer purchase API](https://www.revenuecat.com/docs/api-v2/customer/resources), [purchase API and store identity](https://www.revenuecat.com/docs/api-v2/purchase), [product schema](https://www.revenuecat.com/docs/api-v2/product). The linked OpenAPI purchase schema enumerates `owned` and `refunded`; V1 non-subscription IDs are not interchangeable with store transaction IDs.

## Ledger and refunds

The D1 binding is server-only: clients cannot directly read or write wallets, receipts, lots, customer mappings, or transaction ownership. The schema is versioned in `worker/migrations/`; atomic batches and conflict guards preserve wallet revisions and receipt recovery under concurrent requests. Historical Daily Scrap rules and backend contracts are unchanged.

Debits consume oldest available purchase lots first. A store refund removes only that pack's unspent points. Already applied tools remain applied; balances never become negative. Refunding an unused tool restores its original purchase allocations only if those packs have not themselves been refunded. Refund tombstones override duplicate or delayed purchase events and stale owned API snapshots, including cancellations arriving before their purchase. Purchase webhooks that omit quantity are not credited optimistically: the server resolves the exact V2 transaction and verified quantity first, returning 503 for retry while it is absent. Cancellations may omit quantity; an existing purchase's verified quantity remains authoritative.

Refund reversals are intentionally not automatically recredited: their durable tombstone remains. Handle exceptional refund reversals or anonymous account recovery through an audited support process. No backend endpoint issues a store refund or transfers a wallet between UIDs.

A missing guest mapping returns HTTP 503 so RevenueCat can retry after the first client sync. A crash after a debit is recovered by operation ID. Provider errors leave existing balances untouched; the client can continue free gameplay. API pagination is restricted to the same RevenueCat customer endpoint and includes the selected environment on every page. Secret-bearing HTTP redirects are rejected.

## Verification

From the repository root:

```sh
npm --prefix functions ci
npm --prefix functions test
npm --prefix functions run build
npm --prefix worker ci
npm run test:worker
npm --prefix worker run build
```

Worker tests execute the D1 schema against Miniflare's actual SQLite-backed D1 runtime and check authentication and HTTP contracts. The build command bundles with Wrangler's dry-run mode and does not deploy. Legacy tests run provider/catalog checks and a local Firestore emulator under `pullthread-rules-test`; Java is required for that emulator. Fixtures exercise duplicates, simultaneous debits, exact receipt recovery, conflicting idempotency keys, once-per-run revive, cross-UID denial, environment isolation, FIFO refunds, refund-before-purchase, concurrent refund/spend, and direct client write denial. Existing historical backend tests remain available.

Before enabling production, complete real iOS, Android, and web sandbox checks for each enabled provider: every pack, cancellation, delayed confirmation, restart or refresh after purchase/debit, refund delivery, and duplicate delivery. Confirm localized prices and exact transaction identities without recording secrets. Automated fixtures cannot establish that the external product catalog, receipts, webhook delivery, or store accounts are configured correctly.
