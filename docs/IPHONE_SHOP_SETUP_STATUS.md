# iPhone shop setup status — September 7, 2026

The current installed iPhone build and production web preview still have
commerce disabled. No new purchase-enabled build has been installed.

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

## Local preparation

Retrieved the existing app's public Firebase SDK settings with the Firebase CLI
and placed them in gitignored `.env.local`. The mode is native, environment is
sandbox, and the enabled flag stays zero. The RevenueCat iOS key remains empty
until the app connection is configured. No secret values are stored in this
report. The public Worker URL is now configured locally; the purchase gate stays off.

## Workers migration and remaining setup

The selected backend is now **Cloudflare Workers + D1**. Firebase stays on
Spark for guest authentication. A Blaze upgrade is no longer a setup step.

- The local Worker and D1 schema run successfully. Its health endpoint reports
  the database ready and commerce unconfigured. Unauthenticated wallet/webhook
  calls return 401; cross-origin browser calls return 403.
- The native HTTP adapter, real bundled Workerd runtime, JWT verification,
  provider fixtures, and D1 passed an integrated purchase/debit/recovery/refund
  scenario. Firebase and RevenueCat were simulated in this check; it is not a
  connected Apple purchase. See [verification evidence](WORKERS_VERIFICATION.md).
- The native adapter supports Workers with the same Firebase guest UID and tool
  recovery contract. Existing Functions builds remain supported.
- Wrangler authorization is complete with account/user read, Workers script
  write, D1 write, and background access. The Worker and new D1 database are
  deployed. All ten schema commands succeeded, and the
  [live health endpoint](https://pullthread-commerce.pullthread-commerce-worker.workers.dev/health)
  reports D1 ready and commerce unconfigured. Protected routes reject missing
  authentication. No paid Cloudflare plan was activated.
- No Firebase ledger data has been migrated. Any existing paid environment needs
  a complete ledger cutover before switching clients; see [COMMERCE_SETUP.md](COMMERCE_SETUP.md).

Remaining steps:

1. Sign in to [App Store Connect](https://appstoreconnect.apple.com/apps).
2. Complete the [RevenueCat iPhone connection](https://app.revenuecat.com/projects/f8ab5b69/new-app/app_store)
   with the appropriate Apple purchase credentials. Confirm the three consumable
   point packs and the `points` offering described in [COMMERCE_SETUP.md](COMMERCE_SETUP.md).
3. Configure Worker secrets, allow the sandbox environment, and set the RevenueCat
   public iOS key. The Worker URL is configured. Enable the client in a sandbox build.
4. Rebuild/install the iPhone app and validate an Apple sandbox checkout,
   wallet credit, paid tool use, and interrupted purchase recovery before
   claiming the shop works. Real-money production activation is separate.

The existing mock service is a development-only demo, not live purchase proof.
The native adapter audit found no definite code defect explaining this screen;
the explicit build gate and missing provider/backend setup explain it.
