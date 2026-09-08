# Stitched-world progression verification

Implementation date: 2026-09-07. New runs use generation/save version 3. Historical
v1 linear runs and v2 section runs retain their original generators and physics.

## Behavior delivered

- Fabrics change on scored catch 20, 40, 60, 80, 100 and subsequent multiples of 20.
  The five themes cycle; score is independent of height, skipped ranks, sibling
  catches, revisits and best scores. Fresh runs reset progression.
- The four new mechanics are swaying pockets, horizontal wind ribbons, spring
  spools and sweeping scissors. Each has three standalone introductory sections,
  a sheltered/wide/stationary/untimed alternative and recovery afterward.
- Visible geometry is preserved. Lessons are reserved only when future sections
  are generated; pressure can insert a calm section before a lesson. Section
  metadata and introduction counters persist through save, revive and recovery.
- Sections combine at most two mechanics, including existing gates and fraying
  pockets. Combination frequency rises after 100 while speeds remain bounded.
- Memoized stitched scenery crossfades for 96 active simulation ticks (0.8s).
  Reduced motion switches backgrounds immediately. World-name announcements
  never block input or cover fraying deadlines, and hidden lessons are not
  consumed by a pull. Paid/free tools preserve appropriate transition state.
- Short guidance uses the same 120 Hz wind integration as flight.
  Full Preview clones and simulates the actual run, including all new mechanics.
- Existing bottom pull gutter, normal pocket colors, reduced pickup schedule,
  inventory, purchase flow and durable best scores are retained.

## Automated evidence

Final command: `npm test -- --silent --testTimeout=30000`.
Result: **57 suites, 873 tests passed**. A 30-second wall-time allowance was used
because concurrent Mac builds caused earlier 5-second test timeouts; simulation
clocks and behavioral assertions were unchanged.

`npm run lint`, `npm run typecheck`, and `git diff --check` pass.
`npx expo export --platform all --max-workers 2` produced web, iOS and Android
bundles in `/private/tmp/pullthread-worlds-export`.

Coverage includes:

- Exact real-catch milestones through 120, unchanged retained object identities,
  revisit and skipped-rank scoring, one-catch teleport, revive, restart and best
  score persistence, plus 360-catch save/clone/continuation and bounded objects.
- v1/v2 journal rejection of unsupported v3 physics; v3 ownership, nonoverlapping
  wind regions, intro counters, stage metadata, deep cloning and corrupt saves.
- Every offered branch across 16 seeds× 128 catches. Both branches and mirrors of
  every new authored pattern, adjacent sections, entry extremes and motion phases.
- Actual wind exposure with a sheltered alternative, real spring contacts,
  scissors timing windows, and full held-pocket pull clearance including entry
  and recovery pockets in neighboring sections.
- A 112-catch all-world replay with identical outcomes at 30/60/120 FPS.
- Wind boundary crossings, mirroring, held immunity, once-per-tick force with
  pickups and wall contacts, ordinary cushion parity and bounded spring rebounds.
- Full Preview parity for wind, real spring banks, and scissors catches/failures
  across 20 sweep phases. Short guide coordinates match the simulation.
- 0.8-second crossfades at 30/60/120 FPS; reduced motion, high contrast, small-phone
  rendering harnesses, static scenery path reuse, session pause/background clocks,
  restoration without duplicate banners, and unseen-lesson consumption prevention.

Logs: `/private/tmp/pullthread-worlds-tests-final.log`,
`/private/tmp/pullthread-worlds-lint.log`,
`/private/tmp/pullthread-worlds-typecheck.log`,
`/private/tmp/pullthread-worlds-export.log`.

## Production browser and device acceptance

Production browser verification passed with 200 real CDP-touch catches:
100 in normal mode and 100 with high contrast/reduced motion. Each scored catch
and world label matched an independent shadow simulation. All five fabrics,
the 100-pocket cycle, all four elements and 12 completed lessons were observed.
There were no browser errors, horizontal overflow or rejected gestures in the
final run. Minimum measured bottom margin below a full pull was 48.9 pixels.

The 50 screenshots include 320×568 and 390×844 views of each world, midpoint and
settled transitions, immediate reduced-motion changes and visible mechanics.
Screenshots were visually inspected. Seven launches per mode crossed wind, and
a scissors reward route passed after waiting for its sweep. These browser routes
did not hit springs; actual spring rebound witnesses are covered by route and
Preview tests. The external harness uses no game-state fixtures, runtime state
access, stage selectors, paid tools or production debug controls.

Report and screenshots: `/private/tmp/pullthread-worlds-browser-evidence`.

The signed Release build succeeded. All 90 runtime source files and copied build
environment matched the repository and native staging. Strict signature, bundle
identifier, signing team and embedded Hermes bundle were verified. The update
installed successfully on Frank iPhone 17 without uninstalling the previous app.

Artifact and device reports:
`/private/tmp/pullthread-worlds-native/20260907T201729Z/manifest.json`.
The installed app launched successfully after the iPhone was unlocked and its
process remained running more than a minute later.
Physical play is still needed to judge readability, difficulty and enjoyment; automated routes are not subjective fun
validation.
