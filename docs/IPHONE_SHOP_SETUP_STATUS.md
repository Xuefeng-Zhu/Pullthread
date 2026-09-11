# Shop setup status — September 11, 2026

The current iPhone build uses RevenueCat Test Store, which does not require an
Apple Developer Program membership or App Store Connect. The signed internal
Debug build was installed and launched on Frank iPhone17. RevenueCat rejects a
Test Store key in a Release build by design, so Test Store device acceptance
must use Debug; production builds must use the platform's production public
SDK key. The local web configuration
continues to target the connected RevenueCat Billing sandbox. It loads the
provider offering and opens sandbox checkout, but no web test payment has been
submitted yet.

## Verified account state

- Firebase project `pullthread-xuefeng-zhu` is accessible using the existing
  signed-in account. Its `Pullthread Mobile` Firebase app is active.
- Firebase Console shows the Spark plan and requires an upgrade to use Functions.
  The upgrade dialog reports that this account has no Cloud Billing account.
  No billing account or paid plan was created.
- App Store Connect requires sign-in. Store products, agreements, and Apple
  purchase credentials have not yet been verified.
- Created RevenueCat project **Pullthread**, ID `f8ab5b69`, with category Games
  and platform React Native. Skipped the suggested subscription onboarding.
- Prepared its App Store form for `com.xuefengzhu.pullthread`. RevenueCat refused
  to save without the Apple in-app purchase Key ID and Issuer ID; the app
  connection is not created yet. No Apple key was read, created, or uploaded.
- RevenueCat Billing is connected to the existing Stripe account in **Test**
  mode. The web app is `Pullthread (RevenueCat Billing)`, RevenueCat app ID
  `app518bafad2a`.
- Created the three consumable Web Billing products with identifiers
  `pullthread_points_100`, `pullthread_points_550`, and
  `pullthread_points_1200`, priced at USD $0.99, $4.99, and $9.99.
- Created the default `points` offering with packages `points_100`,
  `points_550`, and `points_1200` attached to the matching products.
- Created a scoped RevenueCat V2 key for the Worker with read-only access to
  customer purchases and project products. It is not stored in the repository.
- Added a RevenueCat webhook for this web app, limited to sandbox non-renewing
  purchases and cancellations. RevenueCat's test delivery returned HTTP 200.
- Configured the project's pre-provisioned **Test Store** app, RevenueCat app ID
  `appc10a6c23e0`, with matching 100, 550, and 1,200 point consumables. Each is
  attached to the existing matching package in the `points` offering.
- Sandbox testing access is set to anybody. The existing Worker webhook now
  covers all project apps while remaining limited to sandbox non-renewing
  purchases and cancellations.

## Local preparation

Retrieved the existing app's public Firebase SDK settings with the Firebase CLI
and placed them in gitignored `.env.local`. The mode is native, environment is
sandbox, the web RevenueCat public key is configured, and the local commerce
gate is enabled. The iOS field now uses the project's public Test Store key for
the internal sandbox build. No key values are stored in this report. The public
Worker URL is configured locally.

## Workers migration and remaining setup

The selected backend is **Cloudflare Workers + D1**. Firebase stays on
Spark for guest authentication. A Blaze upgrade is no longer a setup step.

- The local Worker and D1 schema run successfully. The web-billing and Test Store
  migrations preserve existing transaction lots and expand verified stores to
  RevenueCat Billing, Stripe, Paddle, and sandbox-only Test Store. Browser calls
  require an exact configured origin.
- The native HTTP adapter, real bundled Workerd runtime, JWT verification,
  provider fixtures, and D1 passed an integrated purchase/debit/recovery/refund
  scenario. Firebase and RevenueCat were simulated in this check; it is not a
  connected Apple purchase. See [verification evidence](WORKERS_VERIFICATION.md).
- The native adapter supports Workers with the same Firebase guest UID and tool
  recovery contract. Existing Functions builds remain supported.
- Wrangler authorization is complete with account/user read, Workers script
  write, D1 write, and background access. The Worker and D1 database are
  deployed. Migrations `0005_web_billing.sql` and `0006_test_store.sql` each
  executed all eleven commands. Worker version
  `17bff566-453a-472e-beda-c72bacd6cbd0` is live with both the web and Test
  Store apps allowlisted and the sandbox commerce gate enabled.
  The configured localhost browser preflight returns HTTP 204, and the
  [live health endpoint](https://pullthread-commerce.pullthread-commerce-worker.workers.dev/health)
  reports D1 ready and commerce configured for sandbox. Protected routes reject
  missing authentication. No paid Cloudflare plan was activated.
- The local browser loads the three provider prices, requires the browser-wallet
  disclosure, and opens RevenueCat's Stripe-backed sandbox checkout for the
  100-point pack. Cancelling returns cleanly to the offers without a balance
  error. The payment was not submitted, so wallet credit and refund delivery
  remain unverified.
- A Release iPhone build with the public `test_...` configuration was signed by
  the existing personal development team, installed, and launched. RevenueCat
  correctly refused that key in Release with its Wrong API Key safeguard. A
  signed Debug build with the same configuration was then built, installed on
  Frank iPhone17, launched, and verified as a running process (PID 76918). The
  Test Store checkout itself still needs an on-device interaction check.
- No Firebase ledger data has been migrated. Any existing paid environment needs
  a complete ledger cutover before switching clients; see [COMMERCE_SETUP.md](COMMERCE_SETUP.md).

Remaining steps:

1. Complete a RevenueCat Billing sandbox payment for each pack, then validate
   wallet credit, paid tool use, refresh recovery, duplicate delivery, and refund.
2. Complete an iPhone Test Store purchase for each pack, then validate wallet
   credit, paid tool use, interrupted purchase recovery, duplicate delivery,
   and cancellation/refund handling.
3. For Apple StoreKit sandbox and production, sign in to [App Store Connect](https://appstoreconnect.apple.com/apps), then
   complete the [RevenueCat iPhone connection](https://app.revenuecat.com/projects/f8ab5b69/new-app/app_store)
   with the appropriate Apple purchase credentials. Confirm the three consumable
   point packs and the `points` offering described in [COMMERCE_SETUP.md](COMMERCE_SETUP.md).
4. Add the iOS app ID to the Worker allowlist and set its public SDK key after
   the Apple connection exists.
5. Validate an Apple sandbox checkout, wallet
   credit, paid tool use, interrupted purchase recovery, and refund delivery
   before claiming either shop works. Real-money production activation is separate.

The existing mock service is a development-only demo, not live purchase proof.
The native adapter audit found no definite code defect explaining this screen;
the explicit build gate and missing provider/backend setup explain it.
