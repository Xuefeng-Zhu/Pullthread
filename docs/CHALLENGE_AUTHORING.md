# Endless challenge authoring

The runtime chooses from authored geometry and exact mirrors. A seed changes
layout selection and compatible ordering; it never perturbs coordinates or
consults a solver. Each pattern declares its entry/exit interval and owns its
receiver, bumpers, and thorns. The full horizontal range of a moving receiver
must fit the following pattern's entry interval before either is shown.

## Reproduce the completing inputs

```sh
node scripts/launch-route-report.cjs 0 > /tmp/pullthread-routes.json
npx jest src/game/launch/__tests__ --runInBand
```

The report supplies a completing pull and release tick for every layout and
mirror, followed by a 128-catch sequence for the requested seed. Individual
patterns use a source at y=0, a settled camera at y=-480, and the listed entry x.
The full-run sequence starts with `createEndlessRun(seed)`. Replay recorded
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
