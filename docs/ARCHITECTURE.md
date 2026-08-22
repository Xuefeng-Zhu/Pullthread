# Milestone 1 Architecture

## Scope

Milestone 1 is a single-level mechanic proof, not a small version of the entire
product. It must demonstrate one causal statement:

> Given the same level and traveler state, the zero-stitch route fails and a
> recorded pinch stitch deforms the fabric enough to make the route succeed.

The spike includes a rectangular playfield, one traveler, one goal, one pinch
stitch type, planning and simulation phases, terminal outcomes, Undo, Reset,
Retry, and placeholder feedback. Menus, progression, persistence, RevenueCat,
InsForge, Daily Scrap, campaign content, and the pocket stitch are deferred.

## Dependency direction

```text
App / screen composition
        |
        +--> planning store ------> pure game core <------ immutable level
        |          |                     |
        |          |                     v
        |          +--------------> height field
        |                                |
        +--> input mapping --------------+
        |                                |
        +--> simulation runtime <---------+
        |          |
        |          +--> render snapshot --> Skia renderers
        |          +--> coarse outcome ---> planning store / controls
        |
        +--> feedback service
```

The dependency arrows point inward toward the pure game core. Geometry,
deformation, and physics do not import React, React Native, Skia, Reanimated,
Zustand, Expo APIs, or the wall clock. Rendering consumes state and never owns
gameplay rules.

## Spike modules

```text
App.tsx
src/
  app/
    navigation/RootNavigator.tsx
  screens/
    SpikeLevelScreen/SpikeLevelScreen.tsx
  game/
    core/
      types.ts
      geometry.ts
      heightField.ts
      physics.ts
      scoring.ts
      simulation.ts
      __tests__/
    levels/
      spikeLevel.ts
    input/
      stitchGesture.ts
    runtime/
      useGameSession.ts
    rendering/
      FabricCanvas.tsx
      FabricTexture.tsx
      StitchRenderer.tsx
      Traveler.tsx
      GoalRenderer.tsx
      coordinates.ts
    feedback/
      FeedbackService.ts
      ExpoFeedbackService.ts
      __tests__/
  store/
    useGameStore.ts
  theme/
    tokens.ts
    typography.ts
```

This reflects the spike's intended responsibility map. Keep a responsibility
together until it becomes large enough to justify the next boundary; do not add
empty service or future-feature files merely to mirror the full product brief.

## Coordinate systems

All authored and persisted game inputs use canonical fabric coordinates. The
technical-spike surface preserves its portrait aspect instead of squeezing both
axes into a unit square:

```text
top-left     = (0, 0)
bottom-right = (1, 1.5)
x increases right; y increases down; positive height rises out of the cloth
```

The input layer is the only layer that converts screen pixels into canonical
fabric points. Safe-area insets, display density, and playfield layout must not
leak into level or simulation data. A committed stitch stores canonical start
and end points, fixed tension, radius, and deterministic thread cost.

The renderer converts normalized coordinates to canvas coordinates. The core
converts normalized coordinates to height-field grid coordinates. Both use the
same fabric bounds and orientation.

## Height field and deformation

The cloth is a small height field, initially around 24 columns by 36 rows. It is
not a soft-body simulation. Each sample has a rest/base height and a current
height. The spike may use contour shading, displaced guide lines, highlights,
and shadows instead of a dynamically textured vertex mesh.

For each grid point, the pinch stitch:

1. Calculates distance to the committed stitch segment.
2. Converts distance to a smooth, bounded falloff inside the stitch radius.
3. Adds a ridge contribution using fixed tension.
4. Optionally applies a small deterministic planar pull toward the midpoint for
   rendering.
5. Clamps the combined value to the documented safe range.

Every planning edit rebuilds the current field from the immutable base field
plus all remaining stitches. Undo and Reset must not attempt to apply an inverse
deformation; rebuilding avoids accumulated floating-point and mesh drift.

The physics gradient and the visible deformation must derive from this same
field. Maintaining separate "pretty" and "physical" surfaces would invalidate
the mechanic proof.

## Fixed-step simulation

The simulation state owned by `useGameSession` contains mutable, high-frequency
state:

- traveler position and velocity
- fixed-step accumulator
- simulated elapsed time
- below-speed/stuck duration
- current terminal result
- optional sampled route used for diagnostics

The render loop contributes real elapsed time to an accumulator, but state only
advances in fixed increments:

```ts
accumulator += clampFrameDelta(frameDelta);

while (accumulator >= FIXED_STEP && substeps < MAX_SUBSTEPS) {
  simulation.step(FIXED_STEP);
  accumulator -= FIXED_STEP;
  substeps += 1;
}

publishRenderSnapshot(simulation.state);
```

One step bilinearly samples height and gradient, calculates downhill
acceleration, applies the local friction model, integrates velocity and
position, and checks terminal conditions. The renderer may interpolate between
snapshots, but interpolated draw positions never feed back into physics.

The spike terminates deterministically when one of these conditions occurs:

- the traveler enters the goal under the accepted-speed rule
- the traveler leaves the rectangular fabric bounds
- it remains below the movement threshold away from the goal for the configured
  stuck duration
- it reaches the maximum simulated duration

The maximum substep limit protects the UI after a frame stall. Any policy for
discarding excess real time changes wall-clock playback speed only; it must not
change the ordered fixed-step state transitions.

## State boundaries

Zustand holds coarse, user-observable session state:

- `planning`, `running`, `succeeded`, or `failed`
- committed stitches and current preview metadata
- outcome reason and low-frequency summary
- development overlay flags

Zustand does not receive traveler coordinates or mesh arrays every simulation
step. `useGameSession` publishes traveler render values through Reanimated to
Skia and reports only phase/outcome transitions back to the store. Pure
`simulateRoute` output supplies the planning-route preview without coupling the
physics rules to the canvas.

Control semantics are deliberately distinct:

- **Undo:** remove the most recent planning stitch and rebuild the field.
- **Reset:** clear all stitches, rebuild the base field, and restore the traveler.
- **Release:** freeze editing and start from the canonical traveler state.
- **Retry:** restore the traveler and return to planning while retaining stitches.

Editing gestures are ignored outside `planning`.

## Determinism contract

A deterministic run is defined by:

- a versioned immutable level definition
- normalized committed stitch data in a stable order
- fixed initial position and velocity
- fixed timestep and physics constants
- no `Date`, `Math.random`, render-frame delta, animation callback, or device
  pixel coordinate in the state transition function

The core proof should execute in Jest without React Native or a renderer:

1. Construct the spike level and canonical initial state.
2. Run the zero-stitch input to termination at least 30 times.
3. Assert the same failure reason, fixed-step count, and final state/path within
   the documented numeric tolerance.
4. Run the exported reference pinch stitch from the identical initial state at
   least 30 times.
5. Assert the same success result and equivalent path/final state.
6. Assert that the baseline and stitched paths diverge by a meaningful amount,
   rather than merely producing different terminal labels.

Exact equality is appropriate for discrete outcomes and step counts. For
floating-point positions, use one small documented tolerance consistently; do
not widen it until a flaky test passes.

The automated proof establishes core repeatability. The phone recording must
separately show the baseline failure and reference-stitch success so the visible
surface, interaction, and tested core are demonstrably connected.

## Rendering and performance

Skia draws the textile background, readable height contours or displaced guide
lines, committed/preview thread, traveler, goal, and optional diagnostics. The
canvas should remain the visual focus.

Performance rules for the spike:

- recompute the height field only when planning stitches change
- reuse fixed-size buffers where practical
- avoid allocating mesh-sized arrays every frame
- keep simulation updates out of React render cycles
- cap visual effects before increasing mesh density
- pause or safely reset the loop when the app backgrounds
- expose development-only FPS, fixed-step, velocity, and contour diagnostics

Stable, predictable motion on a mid-range phone matters more than a dense cloth
mesh. Simulator and web measurements are diagnostic only.

## Feedback and accessibility boundary

The gameplay screen depends on a small feedback interface rather than Expo
modules directly. Haptics and audio are best-effort and must fail silently when
unsupported. Final sound assets and nuanced haptic tuning are deferred, but the
spike provides distinct placement and terminal cues.

Release, Undo, Reset, and Retry remain normal accessible controls with labels,
disabled states, and at least 48 dp targets. Outcome and phase are communicated
with text/shape as well as animation or color. Full screen-reader gameplay for
the Skia canvas is outside the Milestone 1 scope.

## Deferred service boundaries

RevenueCat and InsForge are not dependencies of the technical spike:

- no SDK initialization
- no production keys or environment variables
- no purchase or restore UI
- no remote level or leaderboard calls
- no account or guest identity

Entitlement and Daily Scrap abstractions belong to later milestones after the
physical-device mechanic gate passes. The one-level core must remain runnable
without either service and without a network-backed game dependency.
