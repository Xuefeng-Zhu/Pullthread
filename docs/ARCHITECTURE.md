# Pullthread Campaign and Entitlement Architecture

## Scope

Milestones 3 and 4 extend the proven physics-puzzle slice into a complete local
campaign with a fail-soft one-time purchase boundary. The app launches at a
three-quilt map, runs 15 catalog-authored levels, persists per-level progress,
keeps every simulation and replay deterministic, and gates Levels 7–15 behind
the Full Atelier entitlement without making gameplay depend on a network.

The campaign does not require an account, remote level delivery, InsForge, or a
network-backed leaderboard. RevenueCat wraps the premium access boundary, but
its initialization, offer retrieval, purchase, and restore calls are never
prerequisites for Levels 1–6 or already verified offline access.

## Dependency direction

```text
App hydration / navigation
        |
        +--> Quilt Map <-------- persisted campaign progress
        |                              ^
        |                              |
        +--> access policy <----- cached effective entitlement
        |                              ^
        |                              |
        +--> Paywall / Settings --> entitlement store --> service interface
        |                                                /              \
        |                                       development mock     RevenueCat
        |
        +--> gameplay store -------- scoring
        |          |                   ^
        |          v                   |
        |     immutable level ------> pure game core <------ replay parser
        |          |                       |
        |          +--> world builder -----+
        |                                  |
        +--> input mapping ----------------+
        |                                  |
        +--> fixed-step runtime -----------+
        |          |
        |          +--> render snapshot --> Skia renderers
        |          +--> coarse outcome ---> gameplay/progress stores
        |
        +--> feedback and accessibility settings
```

Dependencies point inward toward pure TypeScript. Geometry, deformation,
physics, level validation, replay validation, and scoring do not import React,
React Native, Skia, Reanimated, Zustand, Expo APIs, storage, or the wall clock.
Rendering consumes gameplay state and never owns the rules.

## Module map

```text
App.tsx
src/
  app/navigation/RootNavigator.tsx
  screens/
    QuiltMapScreen/
    SpikeLevelScreen/
    ResultsScreen/
    PaywallScreen/
    SettingsScreen/
  game/
    core/
      types.ts
      geometry.ts
      heightField.ts
      physics.ts
      scoring.ts
      simulation.ts
    levels/
      schema.ts
      campaignLevels.ts
      campaignAccess.ts      # pure sequence + entitlement access policy
      levelLoader.ts
      spikeLevel.ts          # Level 1 compatibility exports
    input/stitchGesture.ts
    runtime/useGameSession.ts
    replay/
      levelReplay.ts
      spikeReplay.ts         # Level 1 compatibility wrapper
    tutorial/tutorialFlow.ts
    rendering/
    feedback/
  store/
    useGameStore.ts
    usePreferencesStore.ts
    useCampaignProgressStore.ts
    useEntitlementStore.ts
  services/
    entitlements/
      EntitlementService.ts
      MockEntitlementService.ts
      RevenueCatEntitlementService.ts
      createEntitlementService.ts
  accessibility/
  components/
  theme/
```

## Coordinates and level catalog

Authored and persisted gameplay inputs use canonical fabric coordinates. The
current portrait fabric spans `(0, 0)` to `(1, 1.5)`: `x` increases right, `y`
increases down, and positive height rises out of the cloth. Screen pixels,
density, and safe-area offsets never enter level or replay data.

`LevelDefinition` owns every deterministic run input:

- stable level id, version, campaign order, quilt id, and player-facing copy
- fabric bounds, height-field resolution, and base slope
- traveler and goal geometry
- material regions, hazards, bumpers, and optional collectible
- allowed stitch types, stitch limit, thread budget, and scoring target
- fixed-step physics configuration and canonical reference solution

`validateCampaignCatalog` validates all three quilts and all 15 levels when
`campaignLevels.ts` loads. It checks stable identities, contiguous ordering,
quilt references, in-bounds geometry, supported types, object-id uniqueness,
physics values, canonical thread costs, stitch limits, budgets, and reference
solutions. See [`LEVEL_FORMAT.md`](LEVEL_FORMAT.md) for the authoring contract.

`levelLoader.ts` is the only runtime construction boundary. It performs strict
catalog lookup, creates the immutable base height field, reapplies committed
stitches and an optional preview, and attaches the level's materials, hazards,
bumpers, collectible, goal, and physics configuration.

## Height field and deformation

The cloth remains a small deterministic height field rather than a soft-body
simulation. Every sample has immutable base height plus rebuildable current
height and planar offsets.

- A pinch stitch adds a smooth bounded ridge around its segment and pulls
  nearby samples toward the segment midpoint.
- A pocket stitch applies a bounded radial depression and inward pull around
  its authored stitch geometry.

Every planning edit rebuilds from base plus the ordered committed stitches.
Undo and Reset never attempt inverse deformation, avoiding accumulated mesh
drift. Planning preview, visible grid displacement, route prediction, live
simulation, and replay all consume the same reconstructed surface.

## Fixed-step physics and world mechanics

The runtime accumulates real frame time but advances the core only in the
level's fixed timestep, with bounded frame delta and maximum substeps. Traveler
position, velocity, prior position, elapsed ticks, stuck count, collected patch,
and terminal outcome are deterministic simulation state.

One fixed step:

1. Bilinearly samples surface height and gradient.
2. Applies downhill acceleration.
3. Applies friction from the first material region containing the traveler.
4. Integrates velocity and position with speed bounds.
5. Resolves swept circular bumper collisions in stable authored order; elastic
   fabric strengthens the bounded bounce response.
6. Uses swept checks for collectible, goal, and hazard intersections so a fast
   traveler cannot skip a small circle between frames.
7. Terminates on goal success, hazard contact, out-of-bounds travel, sustained
   low speed away from the goal, or maximum simulated time.

Felt increases friction, silk reduces it, and elastic retains base friction
while modifying bumper response. Collecting a patch records its stable id but
does not itself end the run. Holes and thorns produce the same deterministic
`hazard` failure class with the authored hazard id retained for diagnosis.

High-frequency traveler coordinates stay in the runtime/Reanimated boundary
instead of entering React or Zustand on every tick. The gameplay store receives
only committed input, phase changes, outcomes, and completed-run summaries.

## Session, navigation, and persistence

`useGameStore` owns the active level id, planning/running/terminal phase,
committed stitches, outcome, and latest successful replay/score snapshot.
Entering a level calls `startLevel(levelId)` and resets transient state while
loading that level's durable best metrics.

Control semantics remain explicit:

- **Undo:** remove the latest planning stitch.
- **Reset:** clear stitches and restore canonical planning state.
- **Release:** freeze editing and start the fixed-step traveler.
- **Retry:** return to planning while retaining committed stitches.
- **Results:** expose only a successful captured run.
- **Map:** return to the campaign without changing recorded progress.

`usePreferencesStore` persists feedback/accessibility settings and tutorial
completion. `useCampaignProgressStore` separately persists a versioned
`progressByLevel` record containing completion and the merged best scored run.
`useEntitlementStore` persists the last verified Full Atelier result, service
source, and verification time. All three use fail-soft AsyncStorage adapters:
gameplay remains available if storage fails, but in-memory state must not be
reported as durable.

`App.tsx` awaits explicit hydration of all three local stores before rendering
navigation. This prevents a clean-map or premium-lock flash before saved state
is known. RevenueCat initialization begins only after local hydration and is
not awaited by navigation, so a slow or unavailable network cannot hold the
campaign on its loading screen. Sanitization treats stored data as untrusted,
drops malformed values, and accepts supported legacy campaign fields through
the migration path.

The pure `campaignAccess.ts` policy derives one of four states from catalog
order, durable progress, and the effective entitlement:

- `completed`: recorded completion and, for premium levels, Full Atelier access
- `current`: Level 1 or the next incomplete level, with any required entitlement
- `sequence-locked`: the predecessor is incomplete
- `premium-locked`: Level 7–15 lacks Full Atelier; the node remains
  paywall-routable but cannot start gameplay

Premium entitlement is required even to replay a completed premium level.
After purchase, the same pure policy re-evaluates predecessor completion, so a
purchase cannot skip Levels 1–6 or any later sequence step. No separate mutable
unlock list is stored, keeping completion, entitlement, and visible access from
drifting apart.

The Quilt Map, Results `Next Level`, and `SpikeLevelScreen` direct-route guard
all use this policy. A locked premium route is replaced by Paywall; an entitled
but out-of-sequence route returns to the map. This makes the access boundary a
gameplay invariant rather than a cosmetic map state.

## Full Atelier service and offline boundary

`EntitlementService` is the platform-neutral purchase contract. The stable
identifiers are:

```text
RevenueCat entitlement: full_atelier
store product:          pullthread_full_game
```

The implementations are intentionally small:

- `MockEntitlementService` starts locked and provides deterministic offer,
  purchase, cancellation/error injection, restore, and debug state for tests
  and development.
- `RevenueCatEntitlementService` configures the process-wide SDK once, reads
  active `CustomerInfo`, selects the product from the current offering,
  rejects subscription and ambiguous metadata that contradicts the one-time
  unlock, accepts the native Android bridge's non-subscription INAPP mapping,
  rejects Apple consumables, normalizes purchase cancellation/errors, restores
  only after an explicit user action, and subscribes to customer-info updates.
- The factory selects `auto`, `mock`, or `revenuecat` from public Expo
  environment configuration. Missing production configuration resolves to an
  unavailable locked service, and production also rejects explicit mock mode;
  it never grants access by default.

The entitlement store owns UI-facing status, localized offer data, notices,
purchase/restore commands, and a development-only override. The override is
not persisted and is excluded from production UI. Purchase cancellation and
service errors retain the prior entitlement. A successfully verified purchase
or restore updates the local cache; an explicit successful restore with no
purchase records the locked result.

Offline behavior is deliberately asymmetric:

- A previously RevenueCat-verified Full Atelier entitlement is available from
  the sanitized local cache before SDK refresh finishes.
- Refresh failure retains that known result and never blocks free gameplay.
- A new purchase or restore still requires the platform store and RevenueCat
  transaction path; failure is shown without mutating campaign progress.
- Offer copy and price are presentation data, not entitlement proof. If no
  offer is available, purchase is disabled while Restore remains reachable.
- The development mock and its Maestro flow prove application state handling,
  not StoreKit, Play Billing, receipt validation, or real offline entitlement.

The custom Paywall communicates a one-time purchase with no subscription,
lists the nine premium levels and mechanics, and is only reached after player
intent. Settings exposes Restore Purchases from outside the paywall. Real SDK
testing requires rebuilding the native development client after adding
`react-native-purchases`; a JavaScript update inside an older binary is not
sufficient.

## Scoring and best-run merge

A successful run records integer thread used, stitch count, simulated
completion milliseconds, and whether its level patch was collected. Scoring
awards up to three thimbles:

1. reaching the goal
2. meeting the inclusive target thread usage
3. collecting the optional patch

Best comparison is deterministic: more thimbles first, then less thread, fewer
stitches, and shorter simulated time. Exact ties keep the incumbent. Durable
merge preserves previously earned thread-target and patch achievements even
when another attempt provides the better comparison metrics.

## Replay boundary

`LevelReplayV1` stores schema version, catalog level id/version, and detached
canonical stitch inputs. Parsing rejects unknown/stale levels, unsupported or
disallowed stitch types, non-finite/out-of-bounds points, wrong tension/radius,
forged thread costs, short drags, duplicate ids, and stitch/thread-limit
violations.

Planning, live simulation, and Results playback reconstruct the same catalog
world and run through the same fixed-step transition functions. Results keeps
playback phase local, so watching a replay cannot call `resolve`, record a
second score, or alter map progress. `spikeReplay.ts` is a compatibility wrapper
around the generic replay for existing Level 1 callers and tests; new campaign
code uses `levelReplay.ts` directly.

## Rendering, feedback, and performance

Skia draws fabric texture and deformed guides, material regions, route, goal,
hazards, bumpers, collectible, stitches, and traveler from the current level
and reconstructed world. Pinch and pocket stitches have distinct visual
language. Text and shapes communicate lock, phase, outcome, material, and patch
state without relying on color or animation alone.

Performance rules remain:

- rebuild the height field only when level/stitch/preview input changes
- keep fixed-step traveler updates out of React render cycles
- reuse bounded buffers and cap visual work before increasing grid density
- bound frame delta and simulation substeps after stalls
- keep reduced motion visual-only; it never changes deterministic physics
- treat browser and simulator performance as diagnostic, not phone evidence

The feedback service applies persisted Sound and Haptics preferences and fails
silently when an Expo capability is unavailable. High Contrast selects a full
game palette. OS reduced motion is always honored; the app toggle may add
reduction but cannot override the OS.

## Remaining service boundaries

InsForge remains outside the campaign dependency graph:

- no remote level, run, leaderboard, or guest-identity call
- no Daily Scrap generation or remote best result
- no account or network requirement for the campaign

RevenueCat production configuration and real store transactions also remain
external acceptance gates. The implemented abstraction, mock, UI, persistence,
and access policy cannot by themselves prove Apple/Google product approval,
localized offerings, purchase cancellation, restore on a fresh install, or a
physical-device offline cold launch. Those gates must be recorded separately
without weakening the working offline catalog.
