# Pullthread Build Plan

## Goal

Extend the proven portrait physics-puzzle slice into a complete offline-first
campaign with a natural one-time unlock and an optional daily mode: three quilt
sections, 15 validated levels, sequential progression, durable per-level
progress, deterministic replay, a fail-soft Full Atelier entitlement, and a
local-first Daily Scrap leaderboard that never becomes a campaign dependency.

Milestone 5 adds deterministic Daily Scrap locally and a Firebase
Anonymous-Auth/Firestore adapter with server-verified replay submission. A
dedicated Firebase project, cloud deployment, production store configuration,
and final device evidence remain external acceptance gates.

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

## Milestone 4 plan

1. Define a platform-neutral entitlement service with stable
   `full_atelier` entitlement and `pullthread_full_game` product identifiers.
   Provide RevenueCat, deterministic mock, and unavailable locked
   implementations without committing environment values.
2. Persist the last verified entitlement through a versioned, sanitized,
   fail-soft AsyncStorage store. Hydrate it before navigation, then initialize
   or refresh RevenueCat asynchronously so network work never blocks launch.
3. Derive campaign access in pure TypeScript: Levels 1–6 remain free, Levels
   7–15 require Full Atelier, completed premium replays remain gated, and
   purchase never bypasses predecessor progression.
4. Apply the same access rule to Quilt Map nodes, Results `Next Level`, and
   direct gameplay routes. Keep sequence locks disabled while premium locks
   remain pressable and explain the one-time unlock.
5. Add a custom Full Atelier paywall with nine-level/mechanic benefits,
   localized offer price, explicit one-time/no-subscription language, purchase,
   restore, cancellation, failure, and already-unlocked states. Never show it
   automatically at launch.
6. Add Restore Purchases to Settings and a development-only, non-persisted
   entitlement lock/unlock override. Missing production configuration must not
   grant new access; development may fall back to the mock.
7. Cover service behavior, persistence/migration, offline refresh failure,
   access rules, map/results/direct-route guards, paywall states, and Settings
   restore with Jest and React Native Testing Library.
8. Add a separate Maestro development-mock flow. Keep its evidence explicitly
   separate from real StoreKit/Play Billing, receipt validation, sandbox
   cancellation, fresh-install restore, and offline physical-device proof.
9. Rebuild the native development client for `react-native-purchases`, repeat
   lint/typecheck/test/Doctor/export, then perform real iOS and Android store
   acceptance passes when dashboard products and platform keys are available.

## Milestone 5 plan

1. Define an append-only, effective-dated Daily Scrap template pool containing
   only the six free handcrafted levels. Derive the global UTC date, FNV-1a
   seed, template, challenge identity, and level version deterministically.
2. Wrap the existing compact level replay in a Daily envelope and derive every
   rank metric through fixed-step re-simulation. Rank by thread, stitches, then
   completion time; exact ties retain the incumbent.
3. Implement `DailyChallengeService` locally first with fail-soft AsyncStorage,
   unlimited attempts, one personal best per challenge, and a pending-best
   upload queue. Load it only after Daily Scrap opens.
4. Add a prominent Quilt Map entry, Daily hub, truthful local/offline/remote
   states, personal best, shared leaderboard, replay route, Try Again flow, and
   accessibility/reduced-motion behavior.
5. Add an explicit Daily gameplay session to the reusable level shell. A Daily
   success must submit to the Daily store without recording campaign progress,
   changing entitlement state, unlocking levels, or exposing a Next Level path.
6. Use Firebase Anonymous Auth for invisible guest identity. Keep Firebase SDK
   initialization lazy and expose only public web-app configuration to the app.
7. Deny direct run/challenge writes with Firestore rules. Submit through an
   authenticated callable function that bounds input, validates the canonical
   challenge/replay, re-runs the simulation, derives metrics server-side, and
   atomically retains one best per user. Bound accepted dates, per-guest call
   frequency, and function scaling; require native App Check enforcement before
   public activation.
8. Cover deterministic dates, replay drift, local persistence/idempotency,
   campaign isolation, Daily UI states, reduced-motion replay, server
   validation, Firestore rules, and concurrent best selection.
9. Repeat app lint/typecheck/Jest/Doctor/export and function build/emulator
   tests. Keep project creation, deployment, two-user proof, and physical
   offline/reconnect evidence as explicit gates rather than claiming them from
   local emulators.

## Architecture

```text
App.tsx
src/
  app/navigation/RootNavigator.tsx
  screens/
    QuiltMapScreen/
    DailyScrapScreen/
    DailyReplayScreen/
    SpikeLevelScreen/
    ResultsScreen/
    PaywallScreen/
    SettingsScreen/
  game/
    core/           # pure geometry, height field, physics, simulation, types
    daily/          # UTC pool, challenge/replay contract, best comparator
    input/          # normalized stitch gesture
    levels/         # catalog, pure access policy, and runtime loaders
    rendering/      # Skia-only drawing components
    runtime/        # fixed-step session and animation loop
    replay/         # campaign replay plus Level 1 compatibility wrapper
    tutorial/       # pure guided-flow reducer and accepted copy
    feedback/       # haptic/audio interface and Expo implementation
  services/
    entitlements/   # mock/RevenueCat implementations behind one contract
    dailyChallenges/# local-first service plus lazy Firebase decorator
  store/            # active run plus separately persisted preferences,
                    # campaign/Daily progress, and verified entitlement cache
  components/       # reachable controls and outcome UI
  theme/            # textile design tokens
tests/
functions/          # Firebase callable plus rules/transaction emulator tests
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
- Levels 1–6 never require Full Atelier; Levels 7–15 do, including replay of a
  previously completed premium level.
- Premium locks open Paywall, while entitlement without predecessor progress
  remains sequence-locked. Results and direct routes cannot bypass either rule.
- Purchase cancellation, unavailable offers, initialization failure, and
  restore errors preserve prior access and never erase campaign progress.
- A previously verified RevenueCat entitlement remains usable from local cache
  while offline; network refresh never blocks the free campaign.
- Development mock proof is reported separately from a real store transaction.
  Real completion requires a rebuilt native client plus physical purchase,
  cancellation, restore, and offline cold-launch evidence.

## Environment tradeoff

This workspace now has a full Xcode installation and successfully signed,
installed, and launched both the earlier Milestone 2 development client and a
Release build with an embedded Hermes bundle for the final Milestone 3 change
set on an iPhone 17e. The 2026-08-26 owner-reported Milestone 3 manual smoke
remains deliberately limited:
it does not complete the detailed campaign, recording, performance/lifecycle,
or native Maestro checks. Android SDK/ADB hardware evidence also remains
outstanding.

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
- [x] Limited physical-iOS Milestone 3 smoke: locally signed Release build with
      an embedded Hermes bundle, install, launch, startup stability, and
      owner-reported manual verification on iPhone 17e / iOS 26.6.
- [ ] Manual physical-device campaign checklist, campaign recording,
      performance notes, and native Maestro evidence.

### Milestone 4

- [x] Platform-neutral entitlement contract with RevenueCat, development mock,
      and unavailable locked implementations.
- [x] Versioned, fail-soft cached entitlement hydration and asynchronous SDK
      refresh that does not block the campaign.
- [x] Pure premium/progression access rules for the first six free levels and
      nine Full Atelier levels.
- [x] Quilt Map, Results, and direct-route access guards with distinct Atelier
      and sequence lock behavior.
- [x] Custom one-time Full Atelier paywall with purchase, cancellation/error,
      restore, localized-offer, and unlocked states.
- [x] Settings restore action and development-only lock/unlock/auto controls.
- [x] Focused service, store, access, screen, paywall, and restore tests.
- [x] Separate Maestro development-mock paywall/restore flow authored.
- [x] Integrated final lint, typecheck, Jest, Expo Doctor, and all-platform
      export snapshot on the completed Milestone 4 change set.
- [ ] Rebuilt physical-device client containing `react-native-purchases`.
- [ ] Real iOS sandbox purchase, cancellation, fresh-install restore, and
      verified offline cold-launch evidence.
- [ ] Android Play test purchase, cancellation, restore, and offline evidence.

### Milestone 5

- [x] Deterministic UTC seed and append-only six-template free-level pool.
- [x] Versioned Daily replay envelope with server/client metric derivation.
- [x] Local-first `DailyChallengeService`, unlimited attempts, persisted best,
      pending upload, malformed-record isolation, and fail-soft storage.
- [x] Quilt Map entry, Daily hub, truthful service states, leaderboard, compact
      replay, personal best, and unlimited Try Again flow.
- [x] Dedicated Daily game session and Results behavior proven not to mutate
      campaign progress or entitlement access.
- [x] Lazy Firebase Anonymous Auth/Firestore adapter with no privileged mobile
      credential and no app-start dependency.
- [x] Replay-validating callable function, transactional best selection,
      bounded leaderboard index, and deny-by-default Firestore rules.
- [x] App Jest coverage plus function domain, transaction, and Firestore rules
      emulator coverage.
- [ ] Dedicated Firebase project, Anonymous Auth, Firestore, billing, project
      alias, and tightly monitored private-beta rules/index/function deployment.
- [ ] Two-user remote leaderboard, forged-score, offline pending-sync, native
      App Check client attestation, callable enforcement, and physical-device
      evidence before public Firebase activation.

## Completed work and tradeoffs

- The campaign launches at the Quilt Map with no account, service credential,
  purchase, or network-backed gameplay dependency for the free campaign.
- Full Atelier wraps, rather than owns, campaign progression. The last verified
  RevenueCat entitlement is cached independently of level progress; a purchase
  cannot fabricate predecessor completion and purchase failures cannot erase
  completed runs.
- Daily Scrap similarly wraps the catalog without owning it. Its session reuses
  fixed-step level simulation and replay, but completion writes only to the
  lazily hydrated Daily store. Local save precedes Firebase, while a remote
  outage never blocks the campaign or removes a device best.
- `auto` mode selects RevenueCat only when the native platform key exists,
  falls back to a locked development mock when appropriate, and stays
  unavailable/locked in production when configuration is missing. Production
  builds also reject explicit `mock` mode, so it cannot become transaction
  evidence or a release unlock.
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
- A signed Milestone 3 iOS Release binary with an embedded Hermes bundle has
  been compiled, installed, launched, and manually smoke-tested by the project
  owner. The evidence remains limited because the detailed campaign checklist,
  recording, performance/lifecycle observations, and native Maestro flows are
  still pending, so the campaign is not yet device-complete.
- `npm audit --omit=dev` currently reports 14 transitive findings (10 moderate,
  4 high) in the Expo
  57 build chain (`metro`/`image-size` and `xcode`/`uuid`). A non-mutating
  `npm audit fix --dry-run` proposes no compatible lockfile change, while the
  force path proposes a breaking Expo 46 downgrade, so no incompatible fix was
  applied; this should be rechecked when Expo publishes an updated compatible
  chain.
- `npm audit --omit=dev --prefix functions` reports seven moderate transitive
  findings in the current Firebase Admin/Functions chain. The proposed change
  is an incompatible downgrade, so the pinned working backend was retained and
  the advisory set remains a dependency-upgrade gate rather than being hidden.
- Milestone 3 stores per-level best runs locally. Scored achievements merge
  across successful attempts so an earned thread target or collectible patch
  is not lost when a different run supplies better comparison metrics.
- AsyncStorage and SDK patch changes are native dependency changes. The recorded
  Milestone 3 Release build contains its then-current dependency set, but it
  predates the latest Milestone 4 patch alignment; rebuild before relying on
  later phone evidence.
- `react-native-purchases` is another native dependency change. The recorded
  Milestone 3 binary predates it and cannot prove Milestone 4 RevenueCat
  behavior even when it loads the latest JavaScript from Metro.

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
- [`CAMPAIGN_SMOKE_TEST.md`](CAMPAIGN_SMOKE_TEST.md) on iPhone 17e / iOS 26.6 —
  limited owner-reported manual smoke passed; detailed checklist, recording,
  performance/lifecycle observations, and native Maestro remain pending.

## Milestone 4 verification snapshot — 2026-08-26

- `npm ci` — clean lockfile install and Skia web setup passed.
- `npm run lint` — passed with no warnings.
- `npm run typecheck` — passed.
- `npm test` — 31 suites and 296 tests passed.
- `npx expo-doctor@latest` — 21 of 21 checks passed after aligning the current
  Expo SDK 57 patch matrix.
- `npm run export` — web, Android, and iOS bundles exported successfully with
  `react-native-purchases` in the dependency graph.
- Maestro YAML parse — all three installed-app flows are valid YAML, including
  the new development-mock Full Atelier flow.
- `.maestro/full-atelier-mock.yaml` on an installed target — pending because the
  Maestro CLI and a rebuilt Milestone 4 native client are not available in this
  verification pass.
- Real RevenueCat iOS/Android store transactions and offline cold-launch proof —
  pending dashboard/store configuration and physical-device execution.

## Milestone 5 verification snapshot — 2026-08-27

- `npm run lint` — passed with no warnings.
- `npm run typecheck` — passed.
- `npm test` — 37 suites and 344 tests passed, including Daily domain,
  persistence, campaign isolation, screen states, Results, and replay coverage.
- `npm test --prefix functions` — 6 callable-domain tests, 3 Firestore rules
  tests, and 3 best-transaction emulator tests passed.
- `npx expo-doctor@latest` — 21 of 21 checks passed.
- `npm run export` — web, Android, and iOS bundles exported successfully with
  the lazy Firebase client in the dependency graph.
- Maestro YAML parse — all four installed-app flows are valid YAML, including
  the new local/offline Daily route smoke.
- Exported web diagnostic at 390 x 844 — Quilt Map → Daily Scrap → First Pull
  Sampler → Daily gameplay rendered with truthful local-board copy, reachable
  controls, and zero warning/error console entries.
- Firebase project/deploy and two-user remote/offline proof — pending because no
  dedicated Pullthread project existed and unrelated projects were not reused.

## Next milestone

Create a dedicated Pullthread Firebase project, enable Anonymous Auth and
Firestore, deploy the reviewed rules/index/function set, and record the
two-user plus offline/reconnect matrix in
[`FIREBASE_DAILY_SCRAP.md`](FIREBASE_DAILY_SCRAP.md). Keep that evidence
separate from the still-open RevenueCat sandbox/device matrix and the physical
campaign sections in [`CAMPAIGN_SMOKE_TEST.md`](CAMPAIGN_SMOKE_TEST.md) and
[`PHYSICAL_DEVICE_TEST.md`](PHYSICAL_DEVICE_TEST.md).
