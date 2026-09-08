# Interactive climb verification

Implementation date: 2026-09-07. New runs use generation/save version 4.
Historical v1, v2 and v3 saves continue with their original selection, physics
and scenery rules. This record supersedes the new-run behavior described in
`STITCHED_WORLDS_VERIFICATION.md`; that document retains the earlier evidence.

## Delivered behavior

- Five backgrounds still change on each 20 scored catches. Geometry is reserved
  only in future sections, with three optional lessons before mixing mechanics.
- Rotating hoops keep moving after landing and throughout aiming. Their upright
  104-unit mouths orbit with radius 48 and a six-second period. Release inherits
  tangential velocity. Off-center grabs preserve their finger offset, fixed-tick
  drag updates follow a moving anchor, and stationary holds cannot arm a launch.
- Solid rectangular cloth rebounds at 0.55. A normal impact of at least 400
  tears loose cloth permanently, retaining 75% normal speed and all tangent
  speed. Failed attempts can recover and relaunch through the resulting opening.
- Nonblocking snap switches permanently open linked soft zipper doors. Swept
  switch contacts apply before subsequent collisions and simultaneous catches.
  Landing links also activate through Teleport, with no extra score or tool cost.
- Thorn-lined rectangles and closed timed shutters are lethal. Shutters use
  two seconds open, 0.75 seconds visible warning and 1.25 seconds closed. Sharp
  teeth remain inside the displayed collision boundary. Door/switch pairs share
  symbols and stitched connection lines, including in high contrast.
- Both learned routes have obstacles. Ordinary density rises from 1–2 after
  five catches to 5–6 after 80. Courses combine at most two interacting systems;
  recovery pockets remain broad and untimed. After 100, two-thirds of selections
  favor combinations with bounded speeds and density.
- Broken panels, activated switches and introductions serialize and prune with
  their owning section. Revive restores the previous catch's exact state.
- Existing bottom pull gutter, normal pocket colors, reduced pickup schedule,
  inventory, purchases, scoring and durable best scores are retained.

## Automated evidence

The full suite passed: **63 suites, 1,082 tests**, in 80.3 seconds. The final run
used two Jest workers with a 256 MB idle-memory recycling limit and the existing
30-second test timeout. All tests and behavioral assertions ran. An earlier
single-process run stopped with exit 139 after passing many suites; recycling
workers completed the suite. A separate test assumption that every random seed
must select optional fraying was replaced with a dedicated fray witness while
retaining all required-mechanic assertions for every seed.

Final command:

```sh
node node_modules/jest/bin/jest.js --config /private/tmp/pullthread-interactive-jest.config.cjs --maxWorkers=2 --silent --testTimeout=30000
```

The temporary config imports the repository Jest config unchanged, sets its
root directory, and adds `workerIdleMemoryLimit: '256MB'`.

`npm run lint`, `npm run typecheck` and `git diff --check` pass.
`npx expo export --platform all --max-workers 2` produced web, iOS and Android
bundles in `/private/tmp/pullthread-interactive-export`.
The offline authoring report also completed 128 catches, including six setup
shots, and lists all 66 layouts/mirrors in
`/private/tmp/pullthread-interactive-routes.json`.

Coverage includes:

- Full branch sequences through all authored patterns and mirrors with adjacent
  geometry retained, real tear/switch events, setup shots, recovery and varied
  hoop/shutter phases. Four seeds ×128 catches validate every offered branch in
  the assembled run. A 108-catch replay matches 30/60/120 FPS.
- Exact rectangular face/corner collisions, tunneling, overlap, weak/strong and
  glancing panel impacts, persistent openings, bidirectional switches and
  collision ordering, plus shutter cycle boundaries.
- Hoops continue while held, preserve grab offsets, reject stationary holds,
  track continuous drags each simulation tick, and add release momentum. Tests
  cover relative mouth catches, pause/background freezing and complete orbital
  framing with full bottom pull clearance.
- Short guide and Full Preview parity, including tear/recover/relaunch and
  switch-opened doors, without mutating the real run.
- Exact scored milestones, revisits, skipped ranks, Teleport, landing switches,
  restart/best scores, Revive checkpoints, saved continuation, bounded ledgers,
  malformed snapshot rejection and historical v1–v3 continuation.
- Memoized rendering, open/closed remnants, matching symbols, shutter teeth,
  reduced motion, high contrast and unchanged old-world behavior.

A separate geometry audit checked 66 authored/mirrored candidates, 61,440
seeded selections and 7,728 retained production windows. Across 3,473,148
pocket/obstacle comparisons, the minimum barrier clearance was 114.6 units and
minimum cushion clearance was 159.1 units, exceeding the 110-unit pull/button
requirement even after accounting for the full hoop orbit. The observed retained
maximum was 23 pockets, 24 barriers, 4 cushions and 6 switches.

Logs: `/private/tmp/pullthread-interactive-tests-final.log`,
`/private/tmp/pullthread-interactive-lint.log`,
`/private/tmp/pullthread-interactive-typecheck.log`,
`/private/tmp/pullthread-interactive-export.log`.

## Production browser evidence

The production export completed **200 real CDP-touch catches**: 100 normally
and 100 with high contrast/reduced motion. There were no runtime/console errors
or rejected gestures. Each mode exercised five hoop catches, five permanent
tears, five switches, three open-shutter crossings and five setup shots, and
completed all 12 introductions. Scores, world labels and simulation frames
matched an independent shadow run. Minimum measured fabric margin below tested
full pulls was 48.89 pixels.

The main run captured 62 screenshots across 320×568 and 390×844 layouts. A
separate 90-catch-per-mode focused pass captured 36 close-up images of intact and
torn panels, opened linked doors, all three shutter phases and live hoop aiming.
The focused comparisons flush Skia's paint queue before the baseline; they show
the pocket mouth moving while the dragged handle remains at the same position.
These focused images supersede the earlier baseline images taken before the
renderer had painted the pull.

All five fabrics and the focused interactions were visually inspected in normal
and accessibility modes. Neither harness modifies game state, uses paid tools,
adds production controls, or patches runtime code. Controlled external RAF and
seed/preferences fixtures are browser test infrastructure only.

Reports and images:
`/private/tmp/pullthread-interactive-browser-evidence/browser-report.json`,
`/private/tmp/pullthread-interactive-focused-evidence/browser-report.json`.

## Signed iPhone build and remaining device acceptance

The signed Release build succeeded. Strict signature, bundle identifier,
signing team and the 5,982,955-byte embedded Hermes bundle were verified. All
95 runtime files and copied build environment matched both repository and native
staging. The app uses bundle ID `com.xuefengzhu.pullthread` and team `V3ZSA5F97A`.

Artifact:
`/private/tmp/pullthread-interactive-native/20260907T214341Z/Pullthread.app`.
Manifest and build/install logs are in the same directory.

**Installation is blocked:** Apple CoreDeviceService reports Frank iPhone17
(`272351CB-1A96-5F31-982F-7F92D4AF34F0`) unavailable and installation returned
error 1011. The user has been asked to reconnect and unlock the device. No app
was uninstalled and no device data was removed. The prepared build has not been
installed or launched on the phone. Physical play remains necessary to assess
hoop control, readability, difficulty and enjoyment; browser automation does not
establish those subjective results.

## Fabric-wall stall fix — September 7, 2026

A straight downward fall onto a horizontal solid fabric wall could lose energy
until the button repeated tiny contacts indefinitely while the run remained in
the flying phase. Flat vertical contacts now add an 80-unit-per-second slide
toward the nearest wall edge only after the outward bounce and horizontal speed
both become small. Normal-speed bank shots and corner responses retain their
existing collision calculation.

The regression reproduces the former trapped state for 1,200 simulation ticks
and confirms the button now leaves the wall and resolves the flight. The full
app suite passed with 67 suites and 1,105 tests; the Worker suite passed all 68
tests. Ranked physics moved to `stitched-v4-weekly-2`, while the Worker retains
and dispatches old registrations to `stitched-v4-weekly-1`. A connected sandbox
run verified six pockets and three exact retry batches under the new ruleset.

Worker version `21b9b135-2835-47c0-ab53-eabe0b603b9a` is deployed with weekly
prizes still disabled. The signed artifact at
`/private/tmp/pullthread-cosmetics-native/20260908T022101Z/Pullthread.app` matched
all 104 staged runtime files, installed successfully, and launched on Frank
iPhone17. Installation and launch confirm delivery; the specific wall landing
still needs hands-on confirmation on the phone.

## Rail-adjacent fabric-wall lock fix — September 7, 2026

Physical retesting showed that the first resting-contact fix still failed when
a horizontal fabric wall met a side rail. Its nearest-edge response could push
the button into the closed rail corner. The regression reproduced 1,400 bounce
events in four seconds, which also flooded React, audio and haptic callbacks.

Near-resting top contacts now choose a reachable inward edge for rail-adjacent
walls and receive enough lateral and upward velocity to clear the platform. The
runtime limits bounce feedback to 10 Hz and does not request a React render for
each bounce; position and impact animation continue through shared values. Both
mirrored rail cases resolve with at most four contacts in the regression.

The clean app run passed 67 suites and 1,107 tests. TypeScript, lint, the ranked
source manifest and all 68 Worker tests passed. Ranked physics is now
`stitched-v4-weekly-3`; the deployed Worker preserves v1 and v2 runs and has
version `54f16d0d-a695-495c-8ae6-3ba5be693353`. A connected sandbox replay
verified six catches and three idempotent batches under v3.

The signed Release artifact is
`/private/tmp/pullthread-wall-fix-native/20260908T025950Z/Pullthread.app`. Its
runtime sources matched staging, it installed into a new app container on Frank
iPhone17, launched successfully, and remained present in the device process
list. The exact physical wall landing remains the final acceptance check.
