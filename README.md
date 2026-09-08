# Pullthread

**Pull back. Let go. Keep climbing.**

Pullthread is a portrait arcade game built with Expo and React Native. Stretch
an occupied fabric pocket, launch a button-shaped traveler, bounce off stitched
cushions, and choose between roomy pockets and tempting reward routes as the
handmade playground scrolls upward. Moving thorn gates and optional unraveling
pockets interrupt the climb with short challenges. Falling off the fabric or
touching thorns ends the run.

Endless flight is the whole game. The climb and earned tools work offline,
without an account or purchase. Your best pocket count is saved locally.
Optional points purchases retain their separate commerce configuration.
The points backend uses Cloudflare Workers and D1, with Firebase guest identity
and RevenueCat store verification. See [commerce setup](docs/COMMERCE_SETUP.md).

## Playing

- Pull backward to choose direction and power, then release. A short initial
  arc helps aim; there is no midair steering.
- Catch a descending button in a pocket to launch again. Moving receivers
  become stationary once caught.
- After two welcoming catches, choose between wide stitched pockets and
  narrower star-marked routes with free tools. Twelve authored sections and
  their mirrors mix forks, cushion banks, moving gates, and recovery landings.
- Ordinary pockets give unlimited aiming time. After twelve catches, optional
  loose pockets can appear: they unravel four seconds after first landing.
  Their ring and number count down; pause and tool dialogs stop the clock.
- Each new higher row actually reached earns one point. Alternative pockets
  in the same row, skipped rows, and repeated catches do not add points.
- **Pause** suspends a run. **Play again** after a fall starts a fresh layout;
  there are no level breaks. A Revive tool can restore the last catch once per run.
- **Settings** contains sound, haptics, reduced motion, high contrast, and
  tutorial hints. **Done** returns to the current run.
- A cold app launch normally starts a fresh run while keeping the local best;
  a saved paid-tool effect restores its run. Backgrounding pauses play and
  cancels an active pull.

## Stack

Expo SDK 57, React Native 0.86, React 19.2, and strict TypeScript. Skia renders the
playfield; Reanimated and Gesture Handler carry tactile interaction. Zustand and
AsyncStorage hold preferences and the best score. Expo Audio and Expo Haptics
provide feedback. Development and CI use **Node 24.x**.

## Install and run

```sh
npm ci
npm run web
```

The web build is useful for visual and interaction checks. Phone touch feel,
audio, haptics, lifecycle, and performance require an installed native build.

For a first native development build, install the platform tooling and connect
a trusted device:

```sh
npx expo run:ios --device
# or
npx expo run:android --device
```

For iPhone, use macOS with full Xcode, configure signing for
`com.xuefengzhu.pullthread`, and enable Developer Mode on the phone. For Android,
install Android Studio and the SDK, enable USB debugging, and accept the phone's
trust prompt.

For later JavaScript iterations with the compatible client already installed:

```sh
npm start
npm run ios       # start Metro and open the installed iOS client
npm run android   # start Metro and open the installed Android client
```

Open the development-client link on the phone and ensure it can reach Metro.
The `ios` and `android` scripts do not build the first native binary. Rebuild the
client after changing native dependencies, native configuration, or Expo SDK.
Use the project's development client for native verification, including
RevenueCat support, rather than Expo Go's fixed runtime.

Use `npm ci` for the reproducible lockfile install and `npx expo install` when
adding an Expo/native dependency. No app environment file is required.

## Checks

See [branching climb verification](docs/CLIMB_OVERHAUL_VERIFICATION.md) for
route coverage, browser screenshots, and the native playtest record.

```sh
npm run lint
npm run typecheck
npm test
npm run export
```

Optional local dependency check:

```sh
npx expo-doctor@latest
```

`npm run export` produces production JavaScript and asset bundles; it does not
prove a native install or a phone playthrough. Tests cover simulation,
generation, scoring, camera/input behavior, lifecycle, and durable best handling.

For an installed app with bundle identifier `com.xuefengzhu.pullthread`, run:

```sh
maestro test .maestro/endless-smoke.yaml
```

The flow checks direct launch, pause/resume, Settings and Done, a fresh run, and
a cold relaunch. It avoids device-coordinate guesses for the Skia gesture.
Use [the endless device checklist](docs/ENDLESS_SMOKE_TEST.md) for manual first
launch, scrolling, failure, feedback, and a nonzero best surviving restart.

## Documentation

- [Game design](docs/GAME_DESIGN.md): controls, scoring, challenge, and feedback.
- [Architecture](docs/ARCHITECTURE.md): simulation, rendering, input, and storage.
- [Challenge authoring](docs/CHALLENGE_AUTHORING.md): completing inputs and route validation.
- [Device checks and dated evidence](docs/ENDLESS_SMOKE_TEST.md).
- [Cloudflare commerce verification](docs/WORKERS_VERIFICATION.md) and
  [remaining iPhone shop setup](docs/IPHONE_SHOP_SETUP_STATUS.md).
- [Historical references](docs/archive/README.md): retained records and contracts
  from earlier versions. Their old modes and service setup are not part of the app.
