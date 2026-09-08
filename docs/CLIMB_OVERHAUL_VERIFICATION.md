# Branching climb verification — September 7, 2026

New runs use twelve authored sections plus mirrors: forgiving/reward forks,
cushion routes, moving thorn gates, and optional four-second fraying pockets.
Routes rejoin at wide recovery landings. Existing paid-tool recovery and
version-one run continuation are preserved.

## Automated verification

- Lint and TypeScript pass. The full suite passes 639 tests across 48 suites.
- Sixteen seeds complete 128 catches each. Every offered branch is exercised
  in the actual scrolling world before selecting the next route; snapshots
  round-trip throughout, with bounded section and pickup retention.
- Section tests cover twelve layouts plus mirrors, complete neighboring
  geometry, all permitted section seams, small aiming errors, collectible
  rewards, real cushion bounces, and moving-gate success/failure phases.
- Temporary exits remain reachable after three seconds of aiming. Tests cover
  expiry during a pull, expired destination hints, returning to a temporary pocket,
  pause, teleport,
  exact-time revive, prediction, and duplicate reward prevention.
- Version-one saves continue extending their original generator. Version-two
  ownership, graph, cursor, timer, and reward-ledger checks reject corrupted
  recovery data. Interrupted paid teleports recover once using real serialized
  runs and the local mock commerce service; no provider was activated.
- Recorded inputs produce matching climb outcomes at 30, 60, and 120 FPS.
  Production iOS, Android, and web export passes; the web bundles exclude the
  route solvers and authoring witnesses.

Reproduce the climb inputs with `node scripts/launch-route-report.cjs 0`.
Use `--legacy` for the historical generator. Run `npm run lint`,
`npm run typecheck`, `npm test`, and `npm run export` for the checks above.

## Browser evidence

Both the development and exported production apps completed 17 real CDP touch
catches through branch choices, reward pickups, moving gates, and the first
fraying pocket. The harness controls animation-frame timing externally; it
does not inject a saved state or add a debug interface to the app.

Twenty-three screenshots per build cover 320×568, 390×844, and 1022×1280.
Visual inspection found readable route markers, visible gate motion, clear
countdowns and expired pockets, and an unobstructed retry button. Checks also
cover paused countdowns, settings navigation, high contrast, reduced motion,
fray failure, and one-tap restart. No browser errors or horizontal overflow
were observed.

Machine-local evidence:

- [Production browser report](/private/tmp/pullthread-overhaul-evidence/production/browser-report.json)
- [Branch choice, phone](/private/tmp/pullthread-overhaul-evidence/production/branch-choice-390.png)
- [Moving gate, phone](/private/tmp/pullthread-overhaul-evidence/production/moving-gate-390.png)
- [Fraying pocket, small phone](/private/tmp/pullthread-overhaul-evidence/production/fraying-countdown-320.png)
- [Reproducible browser harness](/private/tmp/pullthread-overhaul-browser.cjs)

## Native and playtest boundary

The final signed iPhone Release build passed strict code-signature verification.
All 86 runtime/configuration/asset hashes match the final checkout. It was
installed and launched successfully on Frank iPhone17 (iPhone 17e, iOS 26.6.1),
preserving existing app data. Its bundled JavaScript runs without Metro.

[Native verification record](/private/tmp/pullthread-overhaul-native/20260907T124534Z/verification.json)
and [installable app](/private/tmp/pullthread-overhaul-native/20260907T124534Z/Pullthread.app).

The iPhone Mirroring automation stalled, so no automated physical-touch
playthrough is claimed. Browser-controlled frames and process launch do not
establish touch feel, sound/haptics, real device frame pacing, or whether a
first-time player understands the controls within 30 seconds. The user has
been asked to try the installed game and report clarity and responsiveness.
