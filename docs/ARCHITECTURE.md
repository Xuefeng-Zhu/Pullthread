# Pullthread Architecture

## Application boundary

The app has two routes: `EndlessGame` and `Settings`. It starts directly in the
endless game. Settings exposes five feedback/accessibility preferences and Done,
which returns to the existing run. There is no alternate game, campaign map,
replay browser, Daily Scrap, paywall, or purchase setup in the application.

`App.tsx` hydrates preferences and the endless best before mounting navigation.
Gameplay is entirely local. Archived backend contracts and historical replay
code, where retained for compatibility, are outside the active client graph.

```text
App hydration
  ├── preferences store ─────────── Settings / feedback
  └── endless best store ───────── score display

EndlessGameScreen
  └── useLaunchSession
        ├── gesture mapping / lifecycle
        ├── endless generation / camera / score
        │     └── pure ballistic simulation
        └── shared traveler / pull / camera values
              └── LaunchCanvas / Skia
```

## Simulation and generation

`src/game/launch/simulation.ts` advances downward ballistic gravity at a fixed
120 Hz and normal playback speed. Pull direction is reversed at release; pull
length controls power up to a maximum. Taps and cancelled gestures do not launch.
Swept contacts resolve in earliest-contact order for bumpers, thorns, boundaries,
and descending pocket captures. Source-pocket immunity prevents instant recapture.

`endless.ts` owns the seed, generation window, camera, and score. `challenges.ts`
selects compatible authored layouts from `flightPatterns.ts` and `bankPatterns.ts`
using index-addressed randomness. `ChallengePattern` declares its family, band,
entry/exit ranges, receiver, and owned obstacles. Mirrors are exact reflections;
there is no random coordinate jitter or runtime trajectory search. The ordering
grammar keeps adjacent geometry compatible and avoids repeated families.

The generator considers the full moving-receiver exit range before selecting a
successor, rather than relocating future geometry after a catch. It generates
five pockets ahead and retains two recent challenges plus the occupied source.
Obstacle ownership bounds retention independently of camera movement. Every exit
range has a wide recovery connector.

`launchInput.ts` shares the exact gesture clamp with the authoring tests.
Completing inputs, phase searches, tolerance grids, and route-search utilities
live under `testing/` and `__tests__/`; the application does not import them.

A caught moving receiver becomes stationary at its captured position. Each catch
that advances beyond the prior highest pocket adds one point. Skipped pockets
and repeated lower catches do not add points. Falling off or hitting a thorn
ends the run permanently; restarting creates a new seed and zero score.

## Camera, gestures, and rendering

The logical viewport is 360 × 600, scaled uniformly. World y can become negative
as the player climbs. A monotonic camera follows ascent and determines the
bottom death boundary; it freezes while the player aims.

The fabric canvas fills the screen behind a floating score and controls. A
shared projection scales the world uniformly and anchors its floor above the
home indicator, revealing more upcoming pockets on tall screens. World entities
translate by negative camera y. Input subtracts the projection offsets, divides
by its scale, then adds camera y. Resizing cancels active pulls. Pull clamping
retains zero and never reverses a gesture at an edge.

`useLaunchSession` owns mutable physics state and frame accumulation. Shared
values carry traveler position, pull, tick, impacts, and camera movement to Skia;
React receives coarse events and geometry changes. Pause, navigation blur, and
backgrounding cancel active pulls, freeze simulation, and discard elapsed
background time.

## Local persistence

`useEndlessProgressStore` stores only `{ bestPockets }` under
`pullthread.endless-progress.v1`, version 1. Values must be nonnegative safe
integers. Hydration merges maxima, and serialized writes prevent an older score
from overwriting a newer one. A failed read does not establish a zero durable
best: play continues in memory without overwriting the unknown saved record.
A successfully read corrupt value is sanitized safely.

`usePreferencesStore` retains the existing `pullthread.preferences` key for
sound, haptics, reduced motion, high contrast, and tutorial hints. The current
run is not persisted. Starting a new run or cold-launching resets its score,
while the durable best and preferences remain.

## Verification and historical references

Use deterministic simulation/generation tests, lifecycle and store tests,
production bundle export, browser interaction checks, and a signed-device pass.
A browser or unsigned native build does not establish physical touch, haptic,
audio, or lifecycle quality. Dated evidence lives in
[ENDLESS_SMOKE_TEST.md](ENDLESS_SMOKE_TEST.md).

Earlier campaign, replay, and backend contracts are retained in
[the archive](archive/README.md). They describe historical versions and do not
add routes or service requirements to the current application.
