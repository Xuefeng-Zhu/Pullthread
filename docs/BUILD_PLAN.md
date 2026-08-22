# Pullthread Build Plan

## Goal

Ship the first playable technical spike: a portrait Expo app in which one pinch
stitch visibly deforms a quilt, changes a button traveler's deterministic route,
and turns a baseline failure into success.

This milestone intentionally excludes the campaign, persistence, pocket stitch,
RevenueCat, InsForge, Daily Scrap, and production content.

## Milestone 1 plan

1. Scaffold an Expo SDK 57 TypeScript app with strict checking. SDK 57 is the
   current stable native stack; physical-device testing will use a development
   build rather than the transition-period Expo Go fallback. Install native dependencies with
   `expo install` so Skia, Reanimated, Worklets, Gesture Handler, haptics, and
   audio match the Expo runtime.
2. Keep geometry, height-field deformation, and simulation in pure TypeScript.
   Use normalized fabric coordinates, a 24 x 36 height field, bilinear sampling,
   and a fixed 1/120-second simulation step.
3. Author one immutable level with a base slope. With no stitch, the traveler
   must leave the fabric or stop away from the goal. A documented pinch stitch
   must redirect it into the goal from the same starting state.
4. Render the playfield with React Native Skia using the generated textile
   concept as the visual reference. The fabric mesh, contour shading, displaced
   guide lines, stitch, traveler, goal, and route all consume the same height
   field used by physics.
5. Implement a drag-to-stitch planning state with live preview, normalized
   endpoints, a fixed tension, invalid-drag rejection, thread cost, Undo, Reset,
   Release, Retry, and minimal success/failure states. Editing is disabled while
   the traveler is running.
6. Put coarse session state in Zustand and keep fixed-step traveler updates in a
   mutable runtime so React does not rerender for every physics step.
7. Add a small feedback abstraction backed by Expo haptics and temporary
   programmatic audio cues. Unsupported feedback must fail silently.
8. Add focused Jest coverage for geometry, deformation, sampling, terminal
   states, thread cost, and repeated deterministic simulation. Add one important
   UI behavior test for planning controls.
9. Verify lint, strict TypeScript, Jest, Expo Doctor, and platform bundle export.
   Run the web build for visual and interaction QA in this environment.

## Architecture

```text
App.tsx
src/
  app/navigation/RootNavigator.tsx
  screens/SpikeLevelScreen/
  game/
    core/           # pure geometry, height field, physics, simulation, types
    input/          # normalized stitch gesture
    levels/         # one spike level and reference solution
    rendering/      # Skia-only drawing components
    runtime/        # fixed-step session and animation loop
    feedback/       # haptic/audio interface and Expo implementation
  store/            # planning phase, stitches, outcome, debug flags
  components/       # reachable controls and outcome UI
  theme/            # textile design tokens
tests/
```

Rendering never owns gameplay rules. Undo and Reset rebuild deformation from
the immutable base field plus committed stitches rather than attempting to
reverse mutable mesh changes.

## Visual system

Reference: `docs/design/pullthread-gameplay-concept.png`

- Oatmeal linen playfield with indigo stitched framing.
- Cranberry active thread, mustard embroidered goal, dusty-teal traveler.
- A visibly puckered ridge, soft shadow, displaced grid lines, and a restrained
  tightening ripple make deformation readable without a soft-body simulation.
- Compact serif level title, sturdy sans-serif HUD labels, and large bottom
  controls keep the fabric as the focus and support one-handed play.
- Controls use at least 48 dp targets and communicate disabled/outcome state
  with labels and shape, not color or motion alone.

## Acceptance gates

- The same level and initial state produce identical results over at least 30
  repeated simulations.
- The zero-stitch baseline fails and the reference pinch stitch succeeds.
- Stitch preview and committed stitch visibly alter both the surface and route.
- Undo, Reset, Release, and Retry are immediate and cannot corrupt the mesh.
- Every release terminates as success or failure through goal, bounds, stuck,
  or maximum-time detection.
- Lint, typecheck, tests, Expo Doctor, and export complete without errors.
- A human physical-device pass confirms drag ergonomics, haptic/audio timing,
  and performance before the milestone is called device-complete.

## Environment tradeoff

This workspace has Node/npm but no active full Xcode installation, Android SDK,
simulator, ADB, or attached phone tooling. Automated implementation, bundling,
determinism, browser interaction, and visual checks can be completed here. The
physical-device gate will remain explicitly outstanding until the app is opened
in a development build on real iOS or Android hardware.

## Progress

- [x] Repository inspected; no remote or prior commits exist.
- [x] Complete portrait gameplay concept generated and saved.
- [x] Expo SDK 57 project and mutually compatible dependency configuration.
- [x] Pure game core and deterministic 30-run A/B level proof.
- [x] Skia playfield, touch-begin stitch interaction, controls, and feedback.
- [x] Unit/UI tests, CI, Maestro smoke flow, architecture, and device checklist.
- [x] Phone-sized browser interaction pass: baseline failure, calibrated stitch
      success, Release, Retry, Undo, and Reset.
- [x] Lint, strict TypeScript, Jest, Expo Doctor, and three-platform export.
- [ ] Physical-device mechanic proof and evidence record.

## Completed work and tradeoffs

- The technical spike is a directly launchable single screen with no account,
  service credential, or network-backed gameplay dependency.
- Rendering uses the documented procedural fallback: woven Skia paths,
  displaced height-field guides, contour/shadow cues, and the same surface data
  sampled by physics. A dynamically textured vertex mesh remains deferred so
  shader work cannot block the mechanic proof.
- The current authored surface uses 1 x 1.5 fabric coordinates to match the
  portrait playfield while remaining independent of device pixels.
- Placeholder sounds are deterministic, original PCM assets. Web deliberately
  skips playback because browser autoplay policy is not representative of the
  native Expo Audio path; native audio and haptics remain best-effort.
- The generated visual concept and implementation captures live in
  `docs/design/`. The tuned reference route is also exported as typed level
  data and covered by exact replay tests.
- This environment cannot compile or install a native binary because it has no
  full Xcode toolchain, Android SDK, attached phone, or emulator. The milestone
  therefore remains **provisional** despite passing automated, export, and web
  interaction gates.
- `npm audit --omit=dev` currently reports 22 transitive findings in the Expo
  57 build chain (`metro`/`image-size` and `xcode`/`uuid`). npm offers only a
  forced downgrade to Expo 53, so no incompatible automatic fix was applied;
  this should be rechecked when Expo publishes an updated compatible chain.

## Verification snapshot — 2026-08-18

- `npm run lint` — passed.
- `npm run typecheck` — passed.
- `npm test -- --runInBand` — 9 suites and 41 tests passed.
- `npx expo-doctor@latest` — 21 of 21 checks passed.
- `npm run export` — web, Android, and iOS bundles exported successfully.
- Codex in-app browser at 390 x 844 — baseline failure, stitched success,
  Release, Retry, Undo, Reset, responsive layout, and zero warning/error console
  entries verified. Captures are stored in `docs/design/`.

## Next milestone

First, complete `docs/PHYSICAL_DEVICE_TEST.md` on a real iOS or Android phone
and tune the reference drag, feedback timing, and frame pacing from that
evidence. Milestone 2 then adds a guided tutorial, richer results and replay
presentation, settings-backed feedback/accessibility toggles, and expanded
unit/UI coverage.
