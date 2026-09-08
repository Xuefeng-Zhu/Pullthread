# Cloudflare commerce verification — September 7, 2026

The Workers/D1 backend and native transport are implemented and verified locally.
The Worker and D1 database are now deployed, with live HTTP health/auth checks.
No Apple sandbox purchase is claimed.
The existing gameplay redesign and installed iPhone build are preserved.

## Delivered behavior

- Firebase anonymous authentication keeps the existing guest UID used by
  RevenueCat. The Worker validates Firebase RS256 signatures and identity/time
  claims using Google's cached public keys. Firebase Functions are optional
  legacy transport; new builds explicitly select Workers.
- D1 stores wallets, transaction ownership, refund tombstones, FIFO purchase
  lots, bound tool receipts, and revive reservations. Atomic batches guard the
  observed wallet revision and retry conflicts. Duplicate events cannot mint
  points, concurrent debits cannot overspend, and refunds cannot resurrect
  revoked credit.
- Wallet history uses bulk SQL lookups. Reconciliation applies four changes per
  request, prioritizes refunds, and rejects success while known refunds remain.
  Explicit history/provider limits and rollout details are documented in
  [commerce setup](COMMERCE_SETUP.md).
- The native HTTP adapter sends the current Firebase ID token, validates response
  envelopes, and preserves operation IDs and interrupted-tool recovery. Errors
  never cause a silent switch to another ledger.
- `worker/wrangler.jsonc`, the D1 migration, package lockfile, and CI job provide
  reproducible local checks. Provider secrets and the commerce environment gate
  are unset. Public app configuration selects Workers but keeps purchases off.

## Checks performed

| Layer | Evidence |
| --- | --- |
| App suite | 51 suites, 723 tests passed. Includes transport, native identity, commerce journal and gameplay regression coverage. |
| Worker suite | 57 tests passed against Node and actual Miniflare/Workerd/D1. Includes signed-token rejection cases, schema startup, atomic rollback, concurrent credit/debit/refund, alias ownership, bulk query bounds and reconciliation backlogs. |
| Full local integration | Native HTTP adapter → bundled Worker → fixture signing keys/provider → real D1. Verified exact string transaction ID, lost debit response, receipt recovery without another debit, tool refund, store refund, and stale owned-provider response rejection. |
| Retained Firebase backend | 15 unit tests and 35 emulator tests passed. Historical contracts and Firestore rules remain intact. |
| Static/build checks | Root lint, root/Worker type checking, and diff whitespace checks passed. Expo production export succeeded for web, iOS and Android. Wrangler dry-run bundle succeeded: 68.92 KiB, 18.10 KiB gzip. |
| Local HTTP | `http://127.0.0.1:8787/health`: 200, D1 ready, commerce unconfigured. Missing-auth wallet/webhook: 401. Cross-origin request: 403. |
| Deployed HTTP | The public Worker health endpoint returns 200 with D1 ready and commerce unconfigured. Missing-auth wallet/webhook calls return 401; cross-origin calls return 403. |

The integrated runtime test caught and verified the fix for Workerd's unsupported
`redirect: 'error'` option. Worker outbound requests now use manual redirects and
reject non-success responses without forwarding credentials. The tests also
exercise the actual deployed module entry so unsupported exports cannot pass
only a bundling check.

Local logs: `/private/tmp/pullthread-workers-{app-tests,tests,legacy-tests,lint,typecheck,export,build,integration}.log`.
HTTP result: `/private/tmp/pullthread-workers-http-smoke.json`.
Deployed result: `/private/tmp/pullthread-workers-remote-http.json`.

## Connected Cloudflare deployment

The user approved Wrangler authorization. The browser displayed **Authorization
granted to Wrangler**, the CLI confirmed login, and account/resource checks
confirmed no existing Pullthread Worker or D1 database before creation.

- Account: `62694a02d05e9f529bba1664135adc2f`.
- Worker: `pullthread-commerce`.
- URL: https://pullthread-commerce.pullthread-commerce-worker.workers.dev
- Health: https://pullthread-commerce.pullthread-commerce-worker.workers.dev/health
- Version: `9e6a3c3d-f466-4b4a-ba57-33441f2efafe`.
- D1 database: `pullthread-commerce`, ID `d1d6331e-e9a8-4aec-b20b-f79637758489`, region WNAM.
- Migration: `0001_commerce.sql`, all ten schema commands applied successfully.

Wrangler received account/user read, Workers script write, D1 write, and
background access. No paid plan was activated. The app's gitignored local
configuration now contains the public Worker URL; its purchase gate stays off.

## Remaining connected acceptance

Apple/RevenueCat product and credential setup is still incomplete. No new
purchase-enabled iPhone build was installed. Complete the steps in
[the iPhone setup record](IPHONE_SHOP_SETUP_STATUS.md), then verify a real Apple
sandbox checkout, refund delivery and interrupted purchase/tool recovery.
Local provider fixtures do not prove these connected services or free-tier CPU
and daily-quota behavior. Any existing paid Firestore ledger requires a complete
data cutover before changing its clients; this change does not migrate cloud data.
