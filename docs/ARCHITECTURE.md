# Pullthread Campaign Architecture

## Scope

Milestone 3 extends the proven physics-puzzle slice into a complete local
campaign. The app launches at a three-quilt map, runs 15 catalog-authored
levels, persists per-level progress, and keeps every simulation and replay
deterministic. It supports pinch and pocket stitches, felt/silk/elastic
materials, holes, thorns, circular bumpers, collectible patches, thimble
scoring, Results, and campaign-aware replay.

The campaign does not depend on an account, RevenueCat, InsForge, remote level
delivery, or a network-backed leaderboard. Those service boundaries remain
later milestones.

## Dependency direction

```text
App hydration / navigation
        |
        +--> Quilt Map <-------- persisted campaign progress
        |                              ^
        |                              |
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
Both stores use fail-soft AsyncStorage adapters: gameplay remains available if
storage fails, but that in-memory state must not be reported as durable.

`App.tsx` awaits explicit hydration of both stores before rendering navigation.
This prevents a clean-map lock state from flashing before saved progress is
known. Sanitization treats stored data as untrusted, drops malformed level
entries, and accepts supported legacy field names through the migration path.

The Quilt Map derives state in campaign order:

- a recorded completion is `completed`
- Level 1 or a level immediately after a completion is `current`
- every later level is `locked`

No separate mutable unlock list is stored, so completion data and visible lock
state cannot drift apart.

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

## Deferred service boundaries

RevenueCat and InsForge are not campaign dependencies:

- no SDK initialization, production keys, or entitlement cache
- no purchase/restore UI or premium level gate
- no remote level, run, leaderboard, or guest-identity call
- no Daily Scrap generation or remote best result

Those integrations begin after the local campaign passes its automated and
physical-device gates. They must wrap the working offline catalog rather than
becoming prerequisites for deterministic gameplay.
