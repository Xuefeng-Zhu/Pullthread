# Archived Firebase Daily Scrap Backend Reference

This document preserves the historical Daily Scrap backend contract and setup
record. Daily Scrap, Firebase configuration, and account flows are absent from
the current client. Retained functions/rules support compatibility work; setup
and activation instructions below are historical service reference, not steps
needed to run Pullthread. No backend deployment or data change is implied.

---

Daily Scrap is local-first. With no cloud configuration, the deterministic UTC
challenge, unlimited attempts, personal best, and one-player device board all
work through AsyncStorage. Firebase is a lazy enhancement used only after the
player opens Daily Scrap; campaign launch and campaign completion never import
credentials, authenticate, or wait for a network.

## Current activation state

The repository is linked through `.firebaserc` to the dedicated
`pullthread-xuefeng-zhu` project. That project remains on the no-cost Spark plan.
A Firebase web app named `Pullthread Mobile` and the default Standard Firestore
database in `us-west1` were created on 2026-08-27; database deletion protection
is enabled, and the reviewed rules/indexes are deployed.

Anonymous Auth is not enabled, and `submitDailyRun` is not deployed. Cloud Functions
deployment requires the Blaze plan, so the shared replay-verified leaderboard
cannot run on this free-only setup. Until billing is explicitly approved and
the remaining private-beta/App Check gates are complete, keep:

```text
EXPO_PUBLIC_DAILY_SERVICE=local
```

## Security model

- Firebase Anonymous Auth creates the guest identity on first Daily Scrap use;
  there is no account screen and no account requirement for campaign play.
- Public Firebase web-app configuration is allowed in `EXPO_PUBLIC_*` values.
  Admin SDK credentials and service-account keys never belong in the app or
  repository.
- Challenge documents and leaderboard replays are readable, but direct client
  writes to challenge definitions and run documents are denied.
- The callable function requires Firebase Auth, bounds and parses the payload,
  reconstructs the canonical UTC challenge, validates the compact stitch
  replay, re-runs the fixed-step simulator, and derives metrics server-side.
- Submissions are limited to today plus one UTC day of offline grace, each guest
  is transactionally rate-limited, and function scaling is capped at five
  instances. The private rate-limit documents are unreadable and unwritable by
  clients.
- A Firestore transaction stores one best document per challenge/user, ordered
  by thread used, stitches used, then simulated completion time. Ties and worse
  attempts retain the incumbent. The top-50 cutoff uses server-authored
  `recordedAt`; client `createdAt` is retained only as run metadata. An exact
  retry of a committed run is returned idempotently without extending the
  per-user throttle.
- The app writes the local best before attempting Firebase. Failed uploads stay
  pending and retry after a later Daily Scrap connection. Once a pending run is
  older than the server's one-day grace window, the client prunes it and keeps
  flushing newer days instead of retrying a permanent rejection forever.

## Pool compatibility release rule

Each Daily Scrap pool has an immutable, finite `effectiveFrom` through
`effectiveThrough` UTC range. Pool v1 ends on 2027-12-31. Before that date, ship
the app and Functions from the same revision with a contiguous v2 range starting
2028-01-01, and deploy the new `recordedAt` composite index before releasing the
client. Never activate a new pool inside an older pool's advertised range and
never edit a historical range. A build past its last shipped range shows an
update-required state and does not create or submit a superseded challenge,
including while offline.

## Provisioned project and remaining setup

Project provisioning was completed on 2026-08-27. The repository alias,
`Pullthread Mobile` web app, immutable `us-west1` Firestore location, and
deployed rules/indexes all belong to `pullthread-xuefeng-zhu`. Do not run
`firebase projects:create`, `firebase use --add`, or create another web app for
this repository. Inspect the existing public client configuration with:

```sh
firebase apps:list --project pullthread-xuefeng-zhu
firebase apps:sdkconfig WEB --project pullthread-xuefeng-zhu
```

The remaining Firebase Console and release steps are:

1. Enable **Authentication → Sign-in method → Anonymous** only when the
   monitored private beta is ready.
2. Review Cloud Functions billing requirements and explicitly approve the Blaze
   upgrade before the first callable deployment.
3. Register the production apps with App Check, monitor unenforced metrics
   during a limited beta, then set `enforceAppCheck: true` on the callable before
   general release. Firebase recommends App Check for callable abuse defense;
   the initial Expo Firebase JS adapter does not claim native attestation yet.

Do not copy a config from another Firebase project. Do not commit `.env`.

## Configure the app

Copy `.env.example` to `.env`, select Firebase mode, and fill the four values
printed by `firebase apps:sdkconfig WEB ...`:

```text
EXPO_PUBLIC_DAILY_SERVICE=firebase
EXPO_PUBLIC_FIREBASE_API_KEY=...
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=...
EXPO_PUBLIC_FIREBASE_PROJECT_ID=...
EXPO_PUBLIC_FIREBASE_APP_ID=...
```

These are public client identifiers. A private key, service-account JSON,
Firebase Admin credential, or CI deploy token must never use an
`EXPO_PUBLIC_*` name.

## Verify locally

Install and build the function workspace, then run its deterministic domain
tests and Firestore rules/emulator tests:

```sh
npm ci --prefix functions
npm run build --prefix functions
npm test --prefix functions
```

Run the app's independent gates from the repository root:

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run export
```

## Private-beta deploy and acceptance test

The callable currently has `enforceAppCheck: false` so the two-device contract
can be proven before native attestation is integrated. That setting is not a
public-production posture: do not distribute Firebase-mode configuration or
leave the endpoint publicly activated as a general release. After the project
alias points only to the dedicated Pullthread project, use the following command
only for a tightly monitored private-beta validation with billing alerts:

```sh
firebase deploy --only firestore:rules,firestore:indexes,functions:submitDailyRun
```

Cloud completion requires evidence beyond a green deploy:

1. Launch with Firebase mode on two fresh devices/installations.
2. Confirm each device receives a different anonymous uid and can submit its
   own verified best.
3. Confirm both see the same UTC challenge and ordered leaderboard.
4. Attempt direct challenge/run writes and another user's update in the rules
   emulator; all must be denied.
5. Submit a forged score with an unchanged replay; the displayed metrics must
   still come from server re-simulation.
6. Go offline, improve the run, and confirm the local best appears immediately.
   Reconnect and confirm the pending best syncs without regressing either user.
7. Cold-launch the campaign with Firebase unreachable and confirm campaign and
   Full Atelier access remain independent.
8. Integrate a native App Check provider, validate attestation metrics, change
   the callable to `enforceAppCheck: true`, redeploy, and repeat submission from
   release builds before publicly activating Firebase mode.

Firestore rules and indexes are deployed. Callable deployment, Anonymous Auth
enablement, two-user remote proof, native App Check enforcement, and a
physical-device offline/reconnect pass remain explicit gates until recorded.
