# Pullthread

**Stitch the world. Pull it into shape. Let gravity solve the rest.**

Pullthread is a portrait mobile physics-puzzle game built with Expo and React
Native. The player draws pinch and pocket stitches across a quilt, the stitches
deform a shared height field, and a button-shaped traveler rolls over that
changed surface toward an embroidered goal.

The repository now contains the Milestone 3 local campaign: a three-quilt map,
15 authored levels, sequential unlocking, durable per-level progress, pinch and
pocket stitches, felt/silk/elastic regions, holes, thorns, bumpers, collectible
patches, deterministic thimble scoring, best-run comparisons, and
campaign-aware replay. RevenueCat, InsForge, Daily Scrap, and production
content remain intentionally deferred.

> **Physical-device gate: limited Milestone 3 iOS smoke passed; full checklist
> pending.** A locally signed Release build with an embedded Hermes bundle for
> the final Milestone 3 change set installed and launched successfully on an
> iPhone 17e. The project owner reported manual verification on 2026-08-26. The
> detailed
> campaign, touch, haptic/audio, lifecycle, performance, repetition, recording,
> and native Maestro checks remain open.

## Technology

- Expo SDK 57, React Native 0.86, and React 19.2
- Strict TypeScript
- React Native Skia for the playfield
- React Native Reanimated and Gesture Handler for tactile interaction
- Zustand for coarse gameplay state
- AsyncStorage for versioned preferences, tutorial completion, and campaign
  progress
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

No RevenueCat or InsForge credentials are needed for the local Milestone 3
campaign.

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
The recorded 2026-08-26 Release build includes that alignment. Rebuild before
relying on later device evidence whenever native dependencies change.

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
- `undo-button`
- `reset-button`

Start Metro if the installed development build needs it, then run:

```sh
maestro test .maestro/spike-smoke.yaml
maestro test .maestro/failure-retry.yaml
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

## Architecture and proof standard

The campaign keeps geometry, deformation, physics, level validation, replay
validation, scoring, and tutorial state transitions in pure TypeScript. The
renderer and simulation sample the same height field, while high-frequency
traveler state stays outside React and Zustand render cycles. See
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the state boundaries,
fixed-step loop, campaign catalog, persistence, and replay boundaries. Level
authors should also read [`docs/LEVEL_FORMAT.md`](docs/LEVEL_FORMAT.md).

The implementation plan and current tradeoffs live in
[`docs/BUILD_PLAN.md`](docs/BUILD_PLAN.md). The limited physical campaign pass
and remaining checklist are recorded in
[`docs/CAMPAIGN_SMOKE_TEST.md`](docs/CAMPAIGN_SMOKE_TEST.md).

## Explicitly deferred

The following are not part of the local Milestone 3 campaign and should not be
inferred from it:

- RevenueCat purchases, restore purchases, and entitlement caching
- InsForge, Daily Scrap, guest identity, and leaderboards
- Premium level gates and remote/cloud save synchronization
- Remote content delivery, daily challenge content, and social systems
- Production audio, final art, store builds, and release signing
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
