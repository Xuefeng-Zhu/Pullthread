# Branching climb authoring

New runs use generation version four. `interactiveSections.ts` authors new
corridors, rotating hoops, tearable panels, snap switches and timed shutters;
`interactiveWindow.ts` owns their generation and pruning. Historical v2 and v3
selection remains in `sections.ts`, `sectionWindow.ts` and `worldSections.ts`.
Runtime selection is seeded and never imports the development solver.

A section owns pockets, explicit ascent ranks, connections, barriers, switches,
hazards, cushions and rewards. Broken barrier IDs and activated switch IDs are
pruned with their owning section. The final broad recovery pocket anchors the
next section. Geometry already generated never changes at a milestone.

Each template defines a collectible reward position. Runtime generation places
that gift in every other new section (starting with section zero), rotating the
tool kind per gift. Validate reward trajectories in all templates even when a
particular generated instance has no pickup.

```sh
node scripts/launch-route-report.cjs 0 > /tmp/pullthread-routes.json
npx jest src/game/launch/__tests__ --runInBand
```

The default report lists all section/mirror route connections and a validated
128-catch sequence alternating branch choices. Each input includes the source,
both available targets, chosen target, pull vector, and absolute release/catch
ticks. `testing/sectionSolver.ts` verifies individual edges in assembled worlds;
`testing/routeSolver.ts` searches the actual scrolling run. Both remain outside
the production import graph.

Acceptance requires both branches, collectible reward arrivals, small aim-error
clusters, full entry intervals, real cushion bounces, gate release-phase windows,
and all permitted section seams. Test temporary-pocket exits after three seconds
of aiming as well as immediately after a catch. Hazards must stay beyond the
entire ordinary-pocket pull/button envelope at every phase. Keep the two opening
catches forgiving with upcoming sections already present.

Scoring ranks are independent of object ownership. Retain complete sections and
pickup ledgers so alternate catches, teleport, and revive cannot erase a sibling
or duplicate a reward. V2 snapshots validate section ownership, cursors, and
lifetime state. V3 also owns wind regions and stores each section's world stage,
mechanics and optional introduction, plus four introduction counters. Every simulation change must preserve prediction parity and
30/60/120 FPS outcomes.

## Version-four interaction constraints

- Hoops have 104-unit upright mouths, radius 48, and a 720-tick period. Mirror
  pivot, phase and direction exactly. The rim is decorative. Catch uses relative
  downward crossing, including vertical mouth movement. Add analytic tangential
  velocity to release, guide and Preview. Test all phases and the full 110-unit
  pull/button envelope around the entire orbit. The camera freezes during drag.
- Rectangles use swept-disc faces and rounded corners, not an expanded box.
  Solid cloth and soft doors rebound at 0.55. Tearable cloth breaks at incoming
  normal speed >=400, keeps 75% normal velocity, and preserves tangent velocity.
  Solve sequences that tear, recover and relaunch through the permanent opening.
- Nonblocking switches activate before subsequent physical contacts, including
  simultaneous pocket catches. Door IDs and optional landing pocket links must
  belong to the same section. Teleport applies landing activation without score.
- Shutters use the shared 480-tick cycle: open [0,240), warning [240,330), closed
  [330,480). Warning is still passable; closed teeth are lethal. Reduced motion
  suppresses decoration, never this gameplay clock.
- Ordinary density counts barrier rectangles and circular hazards only. Use
  1–2 after five catches, then 2–3/3–4/4–5/5–6 at 20/40/60/80. Teaching overrides
  density. Limit interacting systems to two; static corridor walls can support
  them. Both learned routes require meaningful choices and recovery afterward.
- Three lessons per mechanic precede combinations. Preserve their progress and
  section ownership through save/load, Teleport and Revive. Save version four
  requires barrier/switch ownership and effect ledgers. Never upgrade old runs.

The v4 solver must retain changing obstacle state across setup shots and whole
section sequences, demonstrate actual interactions, and replay the witnesses in
an assembled scrolling run. A bypassing catch alone is insufficient evidence.
Keep solver setup sequences out of production release records and controls.

## Version-three world constraints

`progression.ts` defines five fabrics and milestones from scored catches only.
Keep v1/v2/v3 selection unchanged; use `createLegacyEndlessRun`,
`createSectionEndlessRun` and `createWorldEndlessRun` for historical fixtures. V3 worlds reserve
lessons only while generating future sections, never on a background transition.
Three standalone sections teach each element before it can mix. Include gates
and fraying in the maximum of two interacting elements. After 100, increase
combination frequency rather than speed.

- Sway: 104-unit opening, amplitude 22, 480-tick period; entire opening stays
  between the rails. Landing freezes the exact current position.
- Wind: nonoverlapping 100×150 regions, horizontal acceleration ±100 units/s².
  Sample button center once at the start of each 120 Hz flight tick, kick horizontal
  velocity, then integrate position. The short guide uses the same operation.
  Mirror the rectangle and reverse force. Introductory safe trajectories avoid it.
- Springs: radius 26. Reflect normally, raise outward normal speed to at least 650,
  and cap total rebound speed at 850. Bound tangential speed to satisfy both.
  Reject outward surface contacts so boosting requires another actual collision.
- Scissors: radius 18, horizontal amplitude 34, 600-tick period. Use swept moving
  circles for collisions. All artwork fits inside the displayed danger boundary;
  decorative snips never change physics. Keep its full sweep clear of held-pocket
  pull envelopes, including adjacent section entries and recovery pockets.

The route solver includes independent launch-angle/power search beyond ballistic
center targeting. Prove actual wind traversal and spring contacts as well as
successful catches; wall-only bounces do not demonstrate a spring route. Verify
both branches, mirrors, motion phases, full entry intervals and adjacent seams.
World tests also replay through all unlocks at 30/60/120 FPS and compare Full
Preview to the actual run. Rendering tests cover all fabrics, 0.8-second fades,
small layouts, reduced motion and high contrast without rebuilding static paths
on every tick. Historical saves must reject unsupported v3 physics fields.

## Historical version-one authoring

Saved version-one paid runs keep the original generator, including future
extension. The tests and authoring helpers below intentionally use
`createLegacyEndlessRun(seed)`. Reproduce their original report with:

```sh
node scripts/launch-route-report.cjs 0 --legacy > /tmp/pullthread-legacy-routes.json
```

The runtime chooses from authored geometry and exact mirrors. A seed changes
layout selection and compatible ordering; it never perturbs coordinates or
consults a solver. Each pattern declares its entry/exit interval and owns its
receiver, bumpers, and thorns. The full horizontal range of a moving receiver
must fit the following pattern's entry interval before either is shown.

## Reproduce the completing inputs

```sh
node scripts/launch-route-report.cjs 0 --legacy > /tmp/pullthread-legacy-routes.json
npx jest src/game/launch/__tests__ --runInBand
```

The report supplies a completing pull and release tick for every layout and
mirror, followed by a 128-catch sequence for the requested seed. Individual
patterns use a source at y=0, a settled camera at y=-480, and the listed entry x.
The full-run sequence starts with `createLegacyEndlessRun(seed)`. Replay recorded
releases at their absolute 120 Hz ticks; pull vectors are finger translations
before the normal gesture clamp. The script rejects any witness that fails
under the actual simulation, scrolling floor, and catch behavior.

Witnesses live in `testing/flightPatternHelpers.ts` and
`testing/bankPatternVerification.ts`. `testing/routeSolver.ts` searches complete
composed runs. None of these files is imported by the application.

## Acceptance gates

- Both opening shots use the full 11×11 integer grid within ±5 world units,
  with future geometry already present and multiple seeded orders.
- Every authored challenge and mirror uses the full 7×7 grid within ±3 units.
  Broad entry intervals are sampled every four units, including moving-pocket
  extremes. Composition tests retain neighboring obstacles during both the
  incoming catch and outgoing launch.
- Timing tests hold the pull constant and sweep every release tick. It must
  both catch and miss, with a cyclic success window of at least 60 ticks in
  the introductory band and 36 ticks thereafter.
- Expert timing combines release timing with power control. Removing its
  ceiling thorn must turn a documented high-power miss into a catch. Successors
  cross away from the ceiling's column, with their complete entry range tested.
- Banks use an analytical occlusion bound as well as adversarial simulated
  shots. The centered thorn covers every unbounced route into the same-column
  receiver. The next higher receiver exceeds the maximum unbounced rise.
  Successful references must bounce, but gameplay itself never checks a bounce
  count. Upward pulls, full stretch, and side clamps remain legal inputs.
- Sixteen seeds complete 128 catches each with bounded geometry. Recorded
  tick-indexed runs must match at simulated 30, 60, and 120 rendering FPS.

Keep the geometry, completing witnesses, variation grids, and composition
checks together when changing a pattern. Reject a new layout if its first
successful trajectory is excessively precise. Do not move visible objects,
freeze an uncaught moving target, or add a hidden route rule to rescue it.

Browser and signed-device evidence, including untested feel checks, is recorded
separately in [ENDLESS_SMOKE_TEST.md](ENDLESS_SMOKE_TEST.md).
