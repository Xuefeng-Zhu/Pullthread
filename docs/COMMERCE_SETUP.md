# Points and tools: backend setup

The code is ready for local verification. Live purchases remain unavailable until the native stores, RevenueCat, Firebase secrets, and the explicit environment gate are configured. No production configuration or deployment is performed by the application.

## Contract

Firebase project: `pullthread-xuefeng-zhu`. Region: `us-west1`. All callable requests require Firebase authentication; anonymous guest authentication is supported. Configure RevenueCat with the exact Firebase UID as its app user ID. The first wallet sync establishes the server-owned customer mapping. A receipt is globally unique by store transaction ID and sandbox/production environment, so RevenueCat aliases cannot grant it to two guests. Guest identity recovery across reinstall is outside this milestone; an anonymous account's points are tied to its Firebase UID.

| Callable | Request | Response |
| --- | --- | --- |
| `commerceSyncWallet` | `{environment, purchase?: {transactionId, productId}}` | `{wallet, purchase?: {transactionId, productId, verified}}` |
| `commerceRedeemTool` | `{environment, operationId, runId, tool, expectedCost, contextKey}` | `{wallet, receipt}` |
| `commerceGetRedemption` | `{environment, operationId}` | `{wallet, receipt}` or `null` |
| `commerceResolveTool` | `{environment, operationId, action: 'applied' \| 'refund'}` | `{wallet, receipt}` |

`environment` is `sandbox` or `production`. Wallets contain `points`, monotonic `revision`, and `environment`. Shared wire types and catalog live in `src/commerce/contracts.ts`. Current tool prices are preview 10, teleport 25, revive 50. Pack identifiers are `pullthread_points_100`, `pullthread_points_550`, and `pullthread_points_1200`.

The optional purchase query is only matched against server-verified transactions. It never grants credit. Pass the native SDK's **string** `transactionIdentifier`, corresponding to the provider's `store_purchase_identifier` and webhook `transaction_id`; preserve strings to avoid numeric precision loss. A verified transaction remains verifiable after its points have been spent. Pending or cancelled purchases do not mint points.

An insufficient-balance callable error uses `resource-exhausted` with `details: {reason: 'insufficient_points', operationId}`. Only this explicit reason proves the requested operation was not debited; a generic quota/network error is ambiguous and must be recovered by operation ID.

A tool operation atomically deducts its catalog price and writes a durable `ready` receipt. Retrying the same operation returns the existing receipt; changing its run, tool, price, or context is rejected. Resolve only after applying the effect, or refund when it cannot be applied. A resolution is terminal and idempotent. One paid revive is allowed per run ID. A ready receipt reserves that slot; refunding an unused revive atomically releases it, while an applied revive keeps it consumed. The client journals and restores the frozen run snapshot before resolving interrupted work.

## RevenueCat and native stores

1. Create the three **consumable** products in App Store Connect / Google Play and import them into the RevenueCat project. Keep their exact store identifiers above. Configure the RevenueCat offering with the exact identifier `points`, containing these packs. Intended US store setup prices are 100 points for $0.99, 550 for $4.99, and 1,200 for $9.99; these are catalog setup choices, while the app displays localized store-provided prices. Prices displayed by the app come from the store, never from a hard-coded currency amount.
2. Configure native RevenueCat SDK public keys separately from server secrets. Configure purchases with Firebase's authenticated guest UID. The server accepts only purchased App Store / Play Store consumables; promotional, family-shared, and RevenueCat Test Store purchases do not grant points. Use actual store sandbox purchases for end-to-end validation.
3. Create a RevenueCat **V2 secret API key** with read scopes `customer_information:purchases:read` and `project_configuration:products:read`. The backend reads every customer purchase page, validates its product/app/store/environment, and credits only owned purchases. V2 refunded purchases reconcile revocations. Unknown statuses fail closed. Product responses must report `consumable` or `one_time` with `one_time.is_consumable: true`.
4. Set Firebase Secret Manager secrets `REVENUECAT_API_KEY` and `REVENUECAT_WEBHOOK_AUTHORIZATION`. Use a long random authorization value, at least 24 characters. Set that exact value as RevenueCat's webhook Authorization header. Never use an `EXPO_PUBLIC_` variable for either secret. The HTTP handler compares the entire header in constant time.
5. Set Functions runtime parameters `REVENUECAT_PROJECT_ID` to the RevenueCat project ID, `REVENUECAT_APP_IDS` to a comma-separated allowlist of the project's native RevenueCat app IDs, and `COMMERCE_ENABLED_ENVIRONMENTS` to `sandbox` for the sandbox acceptance phase. Its default is empty, disabling commerce. Enabling `production` is a separate release decision after real store verification.
6. Once deployment is explicitly approved, deploy the commerce functions, Firestore rules, and indexes together. The webhook endpoint is `https://us-west1-pullthread-xuefeng-zhu.cloudfunctions.net/commerceRevenueCatWebhook`. Subscribe to `NON_RENEWING_PURCHASE` and `CANCELLATION` events for both configured environments. A configured authorization header is required; there is no unauthenticated webhook grant path.

Provider reference: [webhook delivery and authorization](https://www.revenuecat.com/docs/integrations/webhooks), [event fields](https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields), [customer purchase API](https://www.revenuecat.com/docs/api-v2/customer/resources), [purchase API and store identity](https://www.revenuecat.com/docs/api-v2/purchase), [product schema](https://www.revenuecat.com/docs/api-v2/product). The linked OpenAPI purchase schema enumerates `owned` and `refunded`; V1 non-subscription IDs are not interchangeable with store transaction IDs.

## Ledger and refunds

All commerce collections are callable-only: even authenticated owners cannot directly read or write wallets, receipts, lots, customer mappings, or transaction ownership. Historical Daily Scrap rules and backend contracts are unchanged.

- Wallet: `commerce_wallets/{sha256(uid)}/environments/{environment}`.
- Purchase lots, redemptions, and once-per-run revive markers are subcollections of that wallet.
- `commerce_transactions/{environment}_{sha256(store:transactionId)}` binds each transaction to a single UID, catalog pack, and quantity.
- `commerce_customers/{sha256(uid)}` maps established Firebase guest identities to RevenueCat app user IDs.

Debits consume oldest available purchase lots first. A store refund removes only that pack's unspent points. Already applied tools remain applied; balances never become negative. Refunding an unused tool restores its original purchase allocations only if those packs have not themselves been refunded. Refund tombstones override duplicate or delayed purchase events and stale owned API snapshots, including cancellations arriving before their purchase. Purchase webhooks that omit quantity are not credited optimistically: the server resolves the exact V2 transaction and verified quantity first, returning 503 for retry while it is absent. Cancellations may omit quantity; an existing purchase's verified quantity remains authoritative.

Refund reversals are intentionally not automatically recredited: their durable tombstone remains. Handle exceptional refund reversals or anonymous account recovery through an audited support process. No backend endpoint issues a store refund or transfers a wallet between UIDs.

A missing guest mapping returns HTTP 503 so RevenueCat can retry after the first client sync. A crash after a debit is recovered by operation ID. Provider errors leave existing balances untouched; the client can continue free gameplay. API pagination is restricted to the same RevenueCat customer endpoint and includes the selected environment on every page. Secret-bearing HTTP redirects are rejected.

## Verification

From the repository root:

```sh
npm --prefix functions ci
npm --prefix functions test
npm --prefix functions run build
```

The test command runs provider/catalog unit tests and a local Firestore emulator under the non-production project `pullthread-rules-test`; it does not deploy. Java and the Firebase CLI's Firestore emulator are required. Fixtures exercise duplicates, simultaneous debits, exact receipt recovery, conflicting idempotency keys, once-per-run revive, cross-UID denial, environment isolation, FIFO refunds, refund-before-purchase, concurrent refund/spend, and direct client write denial. Existing historical backend tests run alongside them.

Before enabling production, complete real iOS/Android sandbox checks for each pack, cancellation, delayed confirmation, app restart after purchase/debit, refund delivery and duplicate delivery. Confirm native prices and exact transaction identities in that environment without recording secrets. Automated fixtures cannot establish that the external product catalog, receipts, webhook delivery, or store accounts are configured correctly.
