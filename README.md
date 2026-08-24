# Pullthread

**Stitch the world. Pull it into shape. Let gravity solve the rest.**

Pullthread is a portrait mobile physics-puzzle game built with Expo and React
Native. The player draws a pinch stitch across a quilt, the stitch deforms a
shared height field, and a button-shaped traveler rolls over that changed
surface toward an embroidered goal.

The repository now contains the Milestone 2 polished vertical slice: one guided
level, one stitch type, deterministic movement, immediate retry, a results
screen, compact restartable replay, persisted feedback/accessibility settings,
and enough polish to demonstrate the complete mechanic. Campaign progression,
RevenueCat, InsForge, and production content remain intentionally deferred.

> **Physical-device gate: not yet verified.** Automated checks, exports, and
> simulator runs cannot establish touch feel, haptic/audio timing, or real-phone
> performance. Milestone 2 is not device-complete until the checklist in
> [`docs/PHYSICAL_DEVICE_TEST.md`](docs/PHYSICAL_DEVICE_TEST.md) is completed and
> its device evidence is recorded.

## Technology

- Expo SDK 57, React Native 0.86, and React 19.2
- Strict TypeScript
- React Native Skia for the playfield
- React Native Reanimated and Gesture Handler for tactile interaction
- Zustand for coarse gameplay state
- AsyncStorage for versioned preferences and tutorial completion
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

No RevenueCat or InsForge credentials are needed for Milestone 2.

## Install

From the repository root:

```sh
npm ci
npx expo-doctor@latest
```

Use `npm ci`, not `npm install`, for a reproducible install from
`package-lock.json`. Use `npx expo install <package>` when adding an Expo/native
dependency so its version remains compatible with SDK 57.

## Run the spike

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
native configuration, or the Expo SDK. Milestone 2 added AsyncStorage and SDK
57 patch updates, so a client installed from Milestone 1 must be rebuilt. A
later JavaScript/TypeScript-only edit only needs Metro reload.

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
do not use `npm run start:go` or an Expo Go session as Milestone 2 hardware
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
- `try-again-button`
- `settings-screen`
- `undo-button`
- `reset-button`

Start Metro if the installed development build needs it, then run:

```sh
maestro test .maestro/spike-smoke.yaml
maestro test .maestro/failure-retry.yaml
```

The main flow launches cleanly, starts its pull from the authored in-field guide,
completes all three tutorial beats, opens Results, watches the replay, verifies
Try Again, then cold-relaunches without clearing storage to prove tutorial
completion persisted. The regression flow covers baseline failure, Retry, Undo,
and Reset. Maestro proves the control path on the selected installed target; it
does not judge tactile quality or prove physics determinism by itself.

## Architecture and proof standard

The slice keeps geometry, deformation, physics, replay validation, and tutorial
state transitions in pure TypeScript. The
renderer and simulation sample the same height field, while high-frequency
traveler state stays outside React and Zustand render cycles. See
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the state boundaries,
fixed-step loop, and baseline-failure/reference-stitch-success proof.

The implementation plan and current tradeoffs live in
[`docs/BUILD_PLAN.md`](docs/BUILD_PLAN.md).

## Explicitly deferred

The following are not part of Milestone 2 and should not be inferred from this
spike:

- RevenueCat purchases, restore purchases, and entitlement caching
- InsForge, Daily Scrap, guest identity, and leaderboards
- Campaign map, fifteen levels, premium gates, and save migration
- Pocket stitches, fabric materials, hazards, collectibles, and final scoring
- Durable campaign best-result and progress persistence
- Production audio, final art, store builds, and release signing

Those systems begin only after the physical-phone mechanic proof passes.

## Current primary references

- [Expo SDK 57 reference](https://docs.expo.dev/versions/v57.0.0/)
- [Expo development builds](https://docs.expo.dev/develop/development-builds/introduction/)
- [Using a development build](https://docs.expo.dev/develop/development-builds/use-development-builds/)
- [Expo CLI native run and export commands](https://docs.expo.dev/more/expo-cli/)
- [Maestro command reference](https://docs.maestro.dev/api-reference/commands)
