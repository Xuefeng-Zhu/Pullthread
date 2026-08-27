# Firebase Daily Scrap activation

Daily Scrap is local-first. With no cloud configuration, the deterministic UTC
challenge, unlimited attempts, personal best, and one-player device board all
work through AsyncStorage. Firebase is a lazy enhancement used only after the
player opens Daily Scrap; campaign launch and campaign completion never import
credentials, authenticate, or wait for a network.

## Current activation state

The repository contains the Firebase client adapter, Firestore rules/indexes,
and the `submitDailyRun` callable function. It is intentionally **not linked or
deployed**: the Firebase account available during Milestone 5 had no Pullthread
project, and unrelated projects were not reused. Until a dedicated project is
created and the environment is configured, keep:

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
  attempts retain the incumbent.
- The app writes the local best before attempting Firebase. Failed uploads stay
  pending and retry after a later Daily Scrap connection. Once a pending run is
  older than the server's one-day grace window, the client prunes it and keeps
  flushing newer days instead of retrying a permanent rejection forever.

## Create and link a dedicated project

Project creation and deployment are external state changes. Run these only
after choosing a globally unique project id and confirming its billing/region
policy:

```sh
firebase projects:create <pullthread-project-id> --display-name Pullthread
firebase use --add
firebase apps:create WEB "Pullthread Mobile"
firebase apps:sdkconfig WEB <firebase-app-id>
```

Then, in Firebase Console:

1. Enable **Authentication → Sign-in method → Anonymous**.
2. Create the default Cloud Firestore database in the selected production
   location. The location cannot be changed later.
3. Review Cloud Functions billing requirements before the first deployment.
4. Register the production apps with App Check, monitor unenforced metrics
   during a limited beta, then set `enforceAppCheck: true` on the callable before
   general release. Firebase recommends App Check for callable abuse defense;
   the initial Expo Firebase JS adapter does not claim native attestation yet.

If the default Firestore database was not created in Console, the current CLI
also supports:

```sh
firebase firestore:locations
firebase firestore:databases:create "(default)" --location <location>
```

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

Firebase deployment, Anonymous Auth enablement, two-user remote proof, native
App Check enforcement, and a physical-device offline/reconnect pass remain
explicit gates until recorded.
