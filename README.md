# Pullthread

**Stitch the world. Pull it into shape. Let gravity solve the rest.**

Pullthread is a portrait mobile physics-puzzle game built with Expo and React
Native. The player draws pinch and pocket stitches across a quilt, the stitches
deform a shared height field, and a button-shaped traveler rolls over that
changed surface toward an embroidered goal.

The repository now contains the Milestone 5 Daily Scrap slice on top of the
campaign and monetization work: a deterministic UTC challenge, explicit
handcrafted template pool, unlimited local attempts, persisted personal best,
compact stitch replay, ranking by thread/stitches/time, a local-first hub, and a
Firebase adapter/backend with anonymous guest Auth and server-verified scores.
Full remote Firebase activation and production proof remain external gates.

> **Physical-device gate: limited Milestone 3 iOS smoke passed; full checklist
> pending.** A locally signed Release build with an embedded Hermes bundle for
> the final Milestone 3 change set installed and launched successfully on an
> iPhone 17e. The project owner reported manual verification on 2026-08-26. The
> detailed
> campaign, touch, haptic/audio, lifecycle, performance, repetition, recording,
> and native Maestro checks remain open.

> **Milestone 4 transaction gate: implementation complete; real store proof
> pending.** Automated and development-mock coverage does not prove an Apple or
> Google transaction. A new native build, configured RevenueCat project, store
> sandbox product, purchase/cancellation pass, restore pass, and verified
> offline cold launch are still required on physical hardware.

> **Milestone 5 cloud gate: free infrastructure is provisioned; remote mode is
> still blocked.** The dedicated `pullthread-xuefeng-zhu` project is on the
> no-cost Spark plan. Its web app and `us-west1` Firestore database exist, and
> the reviewed rules/indexes were deployed on 2026-08-27. Anonymous Auth and the
> callable function are not active. Cloud Functions deployment requires Blaze,
> so Firebase Daily Scrap mode remains disabled unless billing is explicitly
> approved. Two-user remote proof, native App Check enforcement, and physical
> offline/reconnect evidence also remain open.

## Technology

- Expo SDK 57, React Native 0.86, and React 19.2
- Strict TypeScript
- React Native Skia for the playfield
- React Native Reanimated and Gesture Handler for tactile interaction
- Zustand for coarse gameplay state
- AsyncStorage for versioned preferences, tutorial completion, and campaign
  progress, Daily Scrap bests, pending uploads, and the last verified Full
  Atelier entitlement
- RevenueCat `react-native-purchases` behind a platform-neutral entitlement
  service, with a credential-free development mock
- Firebase Anonymous Auth, Firestore, and a replay-validating callable function
  behind a lazy local-first Daily Scrap service
- Expo Audio and Expo Haptics behind a feedback abstraction
- Jest and React Native Testing Library
- Maestro for the installed-app smoke flow

Expo SDK 57 requires Node 22.13 or newer; this repository deliberately pins the
development and CI environment more narrowly to **Node 24.x** through
`package.json`.

## Prerequisites

- Node.js 24.x and npm
- For Android native builds: Android Studio, an Android SDK, and either an
  emulator or a USB-debuggable phone
- For iOS native builds: macOS, a full Xcode installation, signing configured in
  Xcode, and either a simulator or a trusted phone with Developer Mode enabled
- Optional for the smoke flow: the [Maestro CLI](https://docs.maestro.dev/)

No RevenueCat or Firebase configuration is needed to play the campaign or use
Daily Scrap locally. Real Full Atelier transactions require platform-specific
RevenueCat public SDK keys and matching App Store / Play products. Shared Daily
Scrap standings require a dedicated Firebase project and public web-app config.

## Install

From the repository root:

```sh
npm ci
npx expo-doctor@latest
```

Use `npm ci`, not `npm install`, for a reproducible install from
`package-lock.json`. Use `npx expo install <package>` when adding an Expo/native
dependency so its version remains compatible with SDK 57.

## Run the campaign

This project includes `expo-dev-client` and treats a development build as the
physical-device path. The scripts `npm run ios` and `npm run android` start
Metro and open an **already installed** development client; they do not create
the first native binary.

### First install on an Android phone

1. Enable Developer options and USB debugging, connect the phone, and accept
   its trust prompt.
2. Confirm the device is visible with `adb devices`.
3. Build, install, and open the local development client:

   ```sh
   npx expo run:android --device
   ```

4. For later JavaScript-only iterations, keep the installed client and run:

   ```sh
   npm start
   ```

   Open the printed development-client link on the phone. The phone and Metro
   host must be able to reach one another.

### First install on an iPhone

1. Connect and trust the phone, enable Developer Mode, and make sure Xcode can
   sign `com.xuefengzhu.pullthread` for the selected device.
2. Build, install, and open the local development client:

   ```sh
   npx expo run:ios --device
   ```

3. For later JavaScript-only iterations, keep the installed client and run:

   ```sh
   npm start
   ```

   Scan/open the development-client link with the phone.

Rebuild the native development client after changing native dependencies,
native configuration, or the Expo SDK. The campaign implementation itself is
JavaScript/TypeScript, but this integrated change set also aligns Expo,
Expo Asset, Expo Dev Client, and Metro Runtime to the SDK 57 patch matrix.
The recorded 2026-08-26 Milestone 3 Release build predates this Milestone 4
dependency set. Rebuild before relying on later device evidence.

Milestone 4 adds the native `react-native-purchases` SDK. An older Pullthread
binary cannot exercise RevenueCat even if Metro serves the new JavaScript.
Re-run `npx expo run:ios --device` or `npx expo run:android --device` after
installing this change before testing a real native purchase flow. Use that
same rebuilt client when recording the mock flow as device evidence.

## RevenueCat and Full Atelier

The first six levels are free. Levels 7–15 require the one-time Full Atelier
entitlement **and** their normal predecessor completion; buying Full Atelier
does not skip campaign progression. A premium node opens the paywall instead of
starting gameplay. Results and direct level routes apply the same access rule,
so the map is not the only guard. The paywall is never shown at launch.

Pullthread uses these stable RevenueCat identifiers:

```text
entitlement: full_atelier
product:     pullthread_full_game
```

Copy the environment template for local work:

```sh
cp .env.example .env
```

The supported variables are:

| Variable | Meaning |
| --- | --- |
| `EXPO_PUBLIC_ENTITLEMENT_MODE` | `auto`, `mock`, or `revenuecat` |
| `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY` | Apple-platform public SDK key |
| `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY` | Google-platform public SDK key |

Mode selection is deliberately fail-safe:

- `auto` uses RevenueCat when the selected native platform has a key. In a
  development build with no key it uses the locked-by-default mock. In a
  production build with no key, purchases remain unavailable and a fresh
  install stays locked; previously RevenueCat-verified offline access remains.
  The development mock never replaces or downgrades that stronger cache record.
- `mock` provides a deterministic local offer, purchase, restore-not-found,
  and development lock/unlock controls without contacting a store. Production
  builds ignore this mode and cannot grant new access.
- `revenuecat` requires the current platform key. A missing key does not unlock
  content; the app uses its unavailable, locked state.
- Web uses the unavailable state unless mock mode is selected. This project
  does not configure RevenueCat Web Billing.

Do not commit real key values. RevenueCat platform SDK keys are public client
configuration rather than secret backend API keys, but this repository keeps
all environment-specific values outside source control. Never place a
RevenueCat secret API key in an `EXPO_PUBLIC_*` variable.

For a real store pass:

1. Create the `pullthread_full_game` non-consumable in App Store Connect and
   Google Play Console as applicable.
2. Mark the Android product non-consumable in RevenueCat, then attach the
   product to the `full_atelier` entitlement and current offering. Pullthread
   rejects subscriptions and ambiguous offering metadata. The installed native
   bridge labels Google Play one-time products `NON_SUBSCRIPTION` + `CONSUMABLE`;
   RevenueCat's dashboard non-consumable setting controls repeat purchase and
   restore behavior on Android. Apple consumables remain rejected.
3. Put only the matching platform public SDK key in the local `.env` or build
   environment and use `EXPO_PUBLIC_ENTITLEMENT_MODE=revenuecat`.
4. Rebuild the native app, sign in with a sandbox/test store account, and test
   purchase, cancellation, and explicit restore on the physical device.

At launch, Pullthread hydrates a versioned local entitlement cache before
rendering navigation, then refreshes RevenueCat asynchronously. A refresh
failure never blocks the offline campaign and does not erase previously
verified access. Purchase and restore still require the platform store and may
fail offline; the paywall reports that failure without changing campaign
progress. Offer details are not treated as durable entitlement proof.

## Daily Scrap and Firebase

Daily Scrap is available from the Quilt Map without an account. The UTC date is
hashed into a stable seed and selects one of six explicitly versioned free
campaign templates. Attempts are unlimited; only the best result is retained,
with lower thread first, then fewer stitches, then lower deterministic
completion time. Watching a compact stitch replay never records campaign
progress.

Every shipped template pool has a finite inclusive date range. Pool v1 covers
2026-01-01 through 2027-12-31; the app and callable must ship the next contiguous
pool before that boundary. An older build fails closed with an update-required
message after its final known date instead of silently generating a challenge
that the backend no longer recognizes.

Local mode is the default and requires no service configuration:

```text
EXPO_PUBLIC_DAILY_SERVICE=local
```

Firebase mode preserves that local save, then lazily signs the player in with
Firebase Anonymous Auth and syncs a verified best to Firestore. The callable
function ignores client score claims, re-runs the canonical replay, derives the
metric tuple, and updates one best document per user in a transaction. Exact
committed retries are idempotent, and leaderboard cutoff ties use the
server-authored recording time rather than a client timestamp. Direct
client writes to challenge and run documents are denied by Firestore rules.
The backend also accepts only today or yesterday, rate-limits each guest, and
caps function scaling. Those controls do not replace App Check: public Firebase
mode is blocked until native attestation is wired and callable enforcement is
enabled.

The Firebase web-app values are public identifiers, but environment-specific
values still belong in `.env`, never source control:

| Variable | Meaning |
| --- | --- |
| `EXPO_PUBLIC_DAILY_SERVICE` | `local` or `firebase` |
| `EXPO_PUBLIC_FIREBASE_API_KEY` | Firebase public web API key |
| `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN` | Firebase Auth domain |
| `EXPO_PUBLIC_FIREBASE_PROJECT_ID` | Dedicated Pullthread project id |
| `EXPO_PUBLIC_FIREBASE_APP_ID` | Firebase web-app id |

Never put a service-account key, private key, or Admin SDK credential in an
`EXPO_PUBLIC_*` variable. The campaign does not initialize Firebase at launch
and remains playable if Firebase is absent or unreachable. See
[`docs/FIREBASE_DAILY_SCRAP.md`](docs/FIREBASE_DAILY_SCRAP.md) for project
creation, emulator verification, deployment, and the remaining cloud proof.

### Simulator, emulator, and web diagnostics

With a compatible development client already installed:

```sh
npm run ios       # open the iOS development client
npm run android   # open the Android development client
npm run web       # browser diagnostic only
```

Web is useful for fast visual inspection, but it does not prove native Skia,
touch, audio, haptics, lifecycle, or phone performance.

Expo's SDK 57 transition guidance recommends development builds for SDK 57;
do not use `npm run start:go` or an Expo Go session as physical-device
evidence. Expo Go is a prototyping client with a fixed native runtime, while a
development build contains this project's native dependencies.

## Quality checks

Run the same gates used by CI:

```sh
npm run lint
npm run typecheck
npm test
npm run export
npm run test:firebase
```

Additional local compatibility check:

```sh
npx expo-doctor@latest
```

`npm run export` produces production JavaScript and asset bundles for the native
platforms. It proves bundling, not native compilation, installation, or runtime
behavior on hardware.

## Maestro smoke flows

The flows expect an installed app with identifier
`com.xuefengzhu.pullthread` and stable React Native `testID` values:

- `quilt-map-screen`
- `level-node-bedroom-01-first-pull`
- `level-state-bedroom-02-edge-redirect`
- `spike-level-screen`
- `fabric-playfield`
- `tutorial-stitch-anchor`
- `planning-status`
- `stitch-count`
- `release-button`
- `outcome-banner`
- `retry-button`
- `results-button`
- `results-screen`
- `watch-replay-button`
- `replay-stage`
- `results-map-button`
- `try-again-button`
- `settings-screen`
- `settings-entitlement-status`
- `settings-restore-button`
- `level-state-attic-07-pocket-catch`
- `paywall-screen`
- `paywall-status`
- `paywall-purchase-button`
- `paywall-restore-button`
- `paywall-close-button`
- `undo-button`
- `quilt-map-daily-scrap-button`
- `daily-scrap-screen`
- `daily-scrap-play-button`
- `daily-level-screen`
- `daily-scrap-personal-best`
- `daily-leaderboard-section`
- `daily-replay-screen`
- `reset-button`

Start Metro if the installed development build needs it, then run:

```sh
maestro test .maestro/spike-smoke.yaml
maestro test .maestro/failure-retry.yaml
maestro test .maestro/full-atelier-mock.yaml
maestro test .maestro/daily-scrap-local.yaml
```

The main flow launches cleanly on the Quilt Map, enters Level 1, starts its pull
from the authored in-field guide, completes all three tutorial beats, opens
Results, watches the replay, returns to the map, and verifies that Level 2 is
unlocked. It then cold-relaunches without clearing storage to prove campaign
progress persisted and re-enters Level 1 to verify tutorial completion. The
regression flow enters Level 1 from the map and covers baseline failure, Retry,
Undo, and Reset. Maestro proves the control path on the selected installed
target; it does not judge tactile quality or prove physics determinism by
itself.

`full-atelier-mock.yaml` separately checks the deterministic development mock:
the development tool completes the free path, Level 7 opens the Full Atelier
paywall, restore-not-found is handled, mock purchase makes the reached level
current/playable, and the mock cache survives a cold relaunch. Separate access
tests prove that entitlement alone cannot bypass sequence. This flow does
**not** prove StoreKit, Google Play Billing, RevenueCat receipt validation, a
real localized offer, or a real restore. Record those as separate
physical-device transaction evidence.

`daily-scrap-local.yaml` is a date-agnostic installed-app route smoke for the
local/offline mode: Quilt Map entry, prepared challenge, truthful local board,
Daily gameplay shell, and back navigation. Deterministic completion and best
persistence are exercised in Jest because the selected handcrafted template
rotates at the UTC day boundary. The flow does not prove Firebase deployment or
shared standings.

## Architecture and proof standard

The campaign keeps geometry, deformation, physics, level validation, replay
validation, scoring, and tutorial state transitions in pure TypeScript. The
renderer and simulation sample the same height field, while high-frequency
traveler state stays outside React and Zustand render cycles. See
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the state boundaries,
fixed-step loop, campaign catalog, persistence, and replay boundaries. Level
authors should also read [`docs/LEVEL_FORMAT.md`](docs/LEVEL_FORMAT.md).

The implementation plan and current tradeoffs live in
[`docs/BUILD_PLAN.md`](docs/BUILD_PLAN.md), and the campaign access and
monetization rules live in [`docs/GAME_DESIGN.md`](docs/GAME_DESIGN.md). The
limited physical campaign pass and remaining checklist are recorded in
[`docs/CAMPAIGN_SMOKE_TEST.md`](docs/CAMPAIGN_SMOKE_TEST.md).

## Remaining work and explicit boundaries

The following remain external acceptance work and should not be inferred from
the implemented local/client/backend slices:

- Anonymous Auth enablement, an explicit Blaze billing decision, a monitored
  private-beta callable deploy, native App Check integration, and enforced App
  Check before Firebase mode is publicly activated. The dedicated Spark project,
  web app, Firestore database, rules, and indexes are already provisioned.
- Two-user shared leaderboard, forged-score rejection, pending-upload retry,
  and offline/reconnect proof against the deployed project
- Remote content delivery and broader social systems
- Production audio, final art, store builds, and release signing
- RevenueCat dashboard/store product configuration and real iOS/Android
  sandbox purchase, cancellation, restore, and offline-device evidence
- A completed Milestone 3 physical-device checklist, recording, performance
  capture, or native Maestro report

The 2026-08-26 limited phone smoke proves the signed Milestone 3 Release build,
install/launch path, startup stability, and owner-reported manual verification.
It does not prove every detailed campaign flow or the remaining evidence gates;
complete the campaign checklist before calling Milestone 3 device-complete.

## Current primary references

- [Expo SDK 57 reference](https://docs.expo.dev/versions/v57.0.0/)
- [Expo development builds](https://docs.expo.dev/develop/development-builds/introduction/)
- [Using a development build](https://docs.expo.dev/develop/development-builds/use-development-builds/)
- [Expo CLI native run and export commands](https://docs.expo.dev/more/expo-cli/)
- [Maestro command reference](https://docs.maestro.dev/api-reference/commands)
- [RevenueCat with Expo](https://www.revenuecat.com/docs/getting-started/installation/expo)
- [RevenueCat Google Play product setup](https://www.revenuecat.com/docs/getting-started/entitlements/android-products)
- [RevenueCat CustomerInfo and entitlement status](https://www.revenuecat.com/docs/customers/customer-info)
- [RevenueCat purchase restore guidance](https://www.revenuecat.com/docs/getting-started/restoring-purchases)
- [Firebase anonymous authentication](https://firebase.google.com/docs/auth/web/anonymous-auth)
- [Cloud Firestore Security Rules conditions](https://firebase.google.com/docs/firestore/security/rules-conditions)
