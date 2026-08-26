# Pullthread Build Plan

## Goal

Extend the proven portrait physics-puzzle slice into a complete local campaign:
three quilt sections, 15 validated levels, sequential unlocking, durable
per-level progress, two stitch types, three fabric properties, deterministic
hazards/collectibles, scoring, best-result comparison, and replay.

Milestone 3 remains offline-first and service-independent. RevenueCat,
entitlement gates, InsForge, Daily Scrap, remote leaderboards, and production
content remain later work.

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

## Milestone 2 plan

1. Use `First Pull` as a three-beat tutorial: place the stitch, read the route,
   then release gravity. Keep every hint skippable and outside the gesture area.
2. Capture a successful run as versioned canonical stitch input, validate the
   replay as untrusted JSON, and prove exact fixed-step equivalence across 30
   repeated runs.
3. Add a results route with thread, stitch, and time statistics, in-session
   best-result comparison, a final route snapshot, a visible thread-tightening
   pre-roll, restartable traveler playback, and immediate Try Again.
4. Persist Sound, Haptics, Reduced motion, High contrast, Tutorial hints, and
   tutorial completion through a versioned AsyncStorage-backed Zustand store.
5. Apply sound/haptic settings to the existing feedback service and apply
   reduced motion and high-contrast indicators without altering game physics.
6. Expand pure-core, store, accessibility, and component tests plus Maestro
   happy-path and failure/regression flows.
7. Verify the integrated flow at 390 x 844 and the compact gameplay shell at
   320 x 568, then repeat lint, strict TypeScript, Jest, Expo Doctor, and
   three-platform export gates.

## Milestone 3 plan

1. Replace the direct-to-level launch with a three-section Quilt Map. Show all
   15 authored levels, their locked/current/completed state, earned thimbles,
   and optional patch status. Unlock each level only after its predecessor is
   completed.
2. Define a typed, versioned level schema and validate the entire catalog at
   module load. Keep fabric coordinates, physics, stitch limits, thread limits,
   regions, hazards, bumpers, collectibles, and reference solutions in data
   rather than screen conditionals.
3. Generalize the height-field and physics core for bounded pocket
   depressions, felt/silk/elastic friction, swept circular bumper collisions,
   hole/thorn failures, and swept collectible-patch detection.
4. Generalize input, rendering, runtime, and replay from the Level 1 spike to
   any catalog level while retaining the backwards-compatible Level 1 replay
   wrapper and tutorial guide.
5. Author Bedroom, Attic, and Festival quilts with five levels each. Introduce
   one mechanic at a time, then combine pinch/pocket stitches, materials,
   hazards, bumpers, budgets, and patches in later levels.
6. Award deterministic thimbles for completion, target thread usage, and an
   optional collectible patch. Rank best runs by thimbles descending, then
   thread, stitch count, and simulated completion time ascending.
7. Persist completed levels, merged best runs, and collected-patch achievement
   through a versioned, fail-soft AsyncStorage store. Hydrate campaign progress
   with preferences before navigation renders to avoid a lock-state flash.
8. Expand Jest coverage for catalog validation, every reference solution,
   materials, pocket deformation, hazards, bumpers, collectibles, scoring,
   migrations, map states, and campaign replay. Update Maestro to enter Level 1
   from the map and prove Level 2 unlocks after success.
9. Repeat lint, strict TypeScript, Jest, Expo Doctor, and three-platform export,
   then complete the physical campaign checklist on the installed iOS
   development client.

## Architecture

```text
App.tsx
src/
  app/navigation/RootNavigator.tsx
  screens/
    QuiltMapScreen/
    SpikeLevelScreen/
    ResultsScreen/
    SettingsScreen/
  game/
    core/           # pure geometry, height field, physics, simulation, types
    input/          # normalized stitch gesture
    levels/         # validated quilt/level catalog and runtime loaders
    rendering/      # Skia-only drawing components
    runtime/        # fixed-step session and animation loop
    replay/         # campaign replay plus Level 1 compatibility wrapper
    tutorial/       # pure guided-flow reducer and accepted copy
    feedback/       # haptic/audio interface and Expo implementation
  store/            # active run plus separately persisted preferences and
                    # versioned per-level campaign progress
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
- The catalog contains exactly three ordered quilts and 15 uniquely identified,
  consecutively ordered, schema-valid levels.
- All 15 reference solutions terminate deterministically and campaign replay
  reproduces each saved fixed-step outcome.
- Pinch and pocket deformation, felt/silk/elastic behavior, hazards, bumpers,
  collectible patches, stitch limits, and thread budgets are exercised by
  focused tests.
- A clean campaign starts with only Level 1 available; completing it unlocks
  Level 2, and that state plus the best scored run survives a cold relaunch.
- Results and the Quilt Map expose earned thimbles and patch state without
  relying on color alone.

## Environment tradeoff

This workspace now has a full Xcode installation and successfully signed,
installed, and launched the Milestone 2 development client on an iPhone 17e.
The 2026-08-25 owner-reported gameplay smoke remains deliberately limited: it
does not cover the extended Milestone 1/2 device checklist or the new Milestone
3 campaign. Android SDK/ADB hardware evidence also remains outstanding.

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
- [x] Limited physical-iOS smoke: local signed build, install, launch, Metro
      bundle, and user-reported manual gameplay pass on iPhone 17e / iOS 26.6.
- [ ] Full physical-device mechanic proof and evidence record, including
      recordings, extended cycles, lifecycle/performance notes, and Maestro.

### Milestone 2

- [x] Three-step, skippable First Pull tutorial with persisted completion.
- [x] Success-only Results route with exact run statistics and Try Again.
- [x] Versioned replay validation, serialization, 30-run determinism proof,
      visible thread tightening, traveler playback, and restart.
- [x] Persisted sound, haptic, reduced-motion, high-contrast, and tutorial-hint
      preferences with defensive hydration/migration.
- [x] High-contrast Skia palette and OS-aware reduced-motion behavior.
- [x] In-session best-run comparison ordered by thread, stitches, then time.
- [x] Expanded Jest and two-flow Maestro coverage.
- [x] Phone-sized browser flow: tutorial, solution, Results, replay restart,
      Settings persistence, Try Again, and zero warning/error console entries.
- [x] Compact-phone layout and an element-relative Maestro stitch guide that is
      independent of global screen percentages and native safe-area offsets.
- [x] Limited physical-iOS smoke pass and evidence record.
- [ ] Full physical-device Milestone 2 checklist and native Maestro evidence.

### Milestone 3

- [x] Three-section Quilt Map with 15 level nodes and sequential lock states.
- [x] Typed and versioned campaign schema, catalog validation, runtime lookup,
      and generic level world/simulation creation.
- [x] Bedroom, Attic, and Festival catalogs with five authored levels each.
- [x] Pinch and pocket height-field deformation.
- [x] Felt, silk, and elastic regions plus deterministic bumpers.
- [x] Hole and thorn hazards plus collectible embroidered patches.
- [x] Per-level stitch/thread limits and generic campaign gameplay/runtime.
- [x] Deterministic thimble scoring and best-run ordering.
- [x] Versioned, fail-soft local campaign progress with migration/sanitization.
- [x] Campaign-aware validated replay with a backwards-compatible Level 1
      wrapper.
- [x] Maestro routes updated to enter Level 1 from Quilt Map and assert Level 2
      unlock after a successful result.
- [x] Full automated Milestone 3 verification snapshot recorded on the final
      change set.
- [ ] Manual physical-device campaign checklist, campaign recording,
      performance notes, and native Maestro evidence.

## Completed work and tradeoffs

- The campaign launches at the Quilt Map with no account, service credential,
  purchase, or network-backed gameplay dependency.
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
- A signed iOS development binary has been compiled, installed, and smoke-tested
  on an iPhone, but that evidence predates Milestone 3 and remains limited. The
  campaign is therefore not yet device-complete.
- `npm audit --omit=dev` currently reports 14 transitive findings (10 moderate,
  4 high) in the Expo
  57 build chain (`metro`/`image-size` and `xcode`/`uuid`). A non-mutating
  `npm audit fix --dry-run --omit=dev` leaves the same findings, while the force
  path proposes a breaking Expo 46 downgrade, so no incompatible fix was applied;
  this should be rechecked when Expo publishes an updated compatible chain.
- Milestone 3 stores per-level best runs locally. Scored achievements merge
  across successful attempts so an earned thread target or collectible patch
  is not lost when a different run supplies better comparison metrics.
- AsyncStorage and the SDK 57 patch updates are native dependency changes, so
  an existing development client must be rebuilt before phone verification.
  The campaign source itself adds no native dependency, but the final integrated
  change set also aligns Expo SDK 57 patch packages; rebuild the client before
  recording Milestone 3 device evidence.

## Verification snapshot — 2026-08-18

- `npm run lint` — passed.
- `npm run typecheck` — passed.
- `npm test -- --runInBand` — 9 suites and 41 tests passed.
- `npx expo-doctor@latest` — 21 of 21 checks passed.
- `npm run export` — web, Android, and iOS bundles exported successfully.
- Codex in-app browser at 390 x 844 — baseline failure, stitched success,
  Release, Retry, Undo, Reset, responsive layout, and zero warning/error console
  entries verified. Captures are stored in `docs/design/`.

## Milestone 2 verification snapshot — 2026-08-22

- `npm run lint` — passed.
- `npm run typecheck` — passed.
- `npm test -- --runInBand` — 18 suites and 96 tests passed.
- `npx expo-doctor@latest` — 21 of 21 checks passed after the SDK 57 patch refresh.
- `npm run export` — web, Android, and iOS bundles exported successfully.
- Codex in-app browser at 390 x 844 — all three tutorial beats, exact reference
  stitch success, Results, thread-tightening pre-roll, two replay cycles,
  reduced-motion instant replay, high-contrast rendering, preference/tutorial
  persistence across reload, Try Again reset, and zero warning/error console
  entries verified. Captures are stored in `docs/design/`.
- Compact 320 x 568 browser layout — tutorial, fabric gesture target, and all
  three bottom controls remain visible without horizontal or vertical clipping.

## Milestone 3 verification snapshot — 2026-08-26

- `npm run lint` — passed with no warnings.
- `npm run typecheck` — passed.
- `npm test -- --runInBand` — 23 suites and 188 tests passed.
- `npx expo-doctor@latest` — 21 of 21 checks passed.
- `npm run export` — web, Android, and iOS bundles exported successfully.
- Maestro YAML parse — both installed-app flows are valid YAML.
- Codex in-app browser at 390 x 844 and the default desktop viewport — Quilt
  Map exposed all 15 levels with Level 1 current and Level 2 locked, Level 1
  opened into the three-step tutorial, and no warning/error console entries
  were recorded.
- Independent catalog audit — every baseline failed and reference succeeded;
  named materials, bumpers, hazards, patches, and each multi-stitch solution
  were exercised by deterministic counterfactual tests.
- `.maestro/spike-smoke.yaml` and `.maestro/failure-retry.yaml` on an installed
  target — pending.
- [`CAMPAIGN_SMOKE_TEST.md`](CAMPAIGN_SMOKE_TEST.md) on the iPhone development
  client — pending.

## Next milestone

Rebuild the development client for the integrated Expo/AsyncStorage changes,
then complete [`CAMPAIGN_SMOKE_TEST.md`](CAMPAIGN_SMOKE_TEST.md) plus the
remaining extended checks in
[`PHYSICAL_DEVICE_TEST.md`](PHYSICAL_DEVICE_TEST.md). Tune
campaign gestures, map usability, feedback timing, replay pacing, and frame
pacing only from recorded evidence. After Milestone 3 is device-validated,
Milestone 4 can add RevenueCat entitlement/restore behavior and later service
work without weakening the offline campaign.
