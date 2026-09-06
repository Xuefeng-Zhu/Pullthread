# Milestone 3 Physical Campaign Smoke Test

## Status and evidence boundary

**Status: LIMITED iOS MANUAL SMOKE PASS / FULL CHECKLIST PENDING**

This checklist validates the JavaScript/TypeScript Milestone 3 campaign on an
installed native build. It supplements, and does not replace, the longer
mechanic, feedback, lifecycle, repetition, and performance checks in
[`PHYSICAL_DEVICE_TEST.md`](PHYSICAL_DEVICE_TEST.md).

On 2026-08-26, a locally signed iOS Release build of commit
`84d73bcda9d8b147516147ee55852f89de859640` was built, installed, and launched
on an Apple iPhone 17e running iOS 26.6. The Release app contained its embedded
Hermes bundle and remained in the device process table for more than 15 minutes.
The project owner then manually verified the installed app. This records a
limited Milestone 3 campaign smoke pass on that phone only. The owner did not
enumerate the checklist items below, and no screen recording,
performance/lifecycle run, or native Maestro report was recorded, so those
items remain unchecked and the full physical-device gate remains pending.

Fill this header without recording credentials, signing material, or device
identifiers:

| Field | Evidence |
| --- | --- |
| Date and tester | 2026-08-26 — project owner |
| Commit SHA/change set | `84d73bcda9d8b147516147ee55852f89de859640` |
| Phone and OS | Apple iPhone 17e / iOS 26.6 |
| Development-client/native build | Locally signed iOS Release build; build, install, and launch succeeded |
| Metro URL required | No; the Release app used its embedded Hermes bundle |
| Screen recording | Not captured |
| Maestro report/video | Not run on the physical phone |
| Result | LIMITED manual smoke pass; full checklist pending |

## Preconditions

- [ ] The installed native build is compatible with Expo SDK 57 and the
      current native dependencies.
- [ ] Metro is serving the exact change set recorded above when required, or
      the installed Release app contains the embedded bundle for that change
      set.
- [ ] `npm run lint`, `npm run typecheck`, `npm test`, `npx expo-doctor@latest`,
      and `npm run export` pass on that change set.
- [ ] Capture starts before clearing campaign data or beginning a clean run.
- [ ] No RevenueCat, Firebase, account, paywall, or network-backed gameplay
      service is expected in this milestone.

## 1. Clean Quilt Map and Level 1

Start from cleared app storage.

- [ ] Launch reaches `Quilt Journey` / `quilt-map-screen`, not gameplay.
- [ ] The horizontal chapter pager starts on Bedroom and shows five level
      nodes; swipe left to Attic, then Festival, and confirm each chapter snaps
      fully into place with five nodes and the correct chapter indicator.
- [ ] Swipe or use the chapter tabs to return to Bedroom. Confirm Level 1 is
      current/available and Levels 2–5 are locked. Page through Attic and
      Festival to verify Levels 6–15 are locked and cannot be opened.
- [ ] The summary starts at zero thimbles and zero patches.
- [ ] Open `level-node-bedroom-01-first-pull` and confirm the First Pull title,
      wrapping Challenge copy, stitch/thread limits, playfield, and controls
      fit the safe area without truncation at the largest supported text size.
- [ ] Complete the three tutorial beats with the authored pinch route and reach
      Results.

Notes:

```text
Pending.
```

## 2. Results, scoring, replay, and unlock

- [ ] Results show exact thread, stitch, and simulated completion-time values.
- [ ] Completion earns the completion thimble; meeting the inclusive target
      earns the thread thimble.
- [ ] Watch Replay reconstructs the saved Level 1 stitches and reaches the same
      deterministic result.
- [ ] Tap the Results map action and verify Level 1 is completed and Level 2 is
      current/available.
- [ ] The Quilt Map total matches the thimbles displayed for Level 1.
- [ ] Level 3 remains locked until Level 2 is completed.

Observed Level 1 metrics and thimbles:

```text
Pending.
```

## 3. Durable progress and best-run comparison

- [ ] Cold-relaunch without clearing storage; Level 1 completion, Level 2
      availability, thimbles, and patch totals remain unchanged.
- [ ] Re-enter Level 1; the completed tutorial does not reappear.
- [ ] Complete the same level with a worse run; the durable best does not
      regress.
- [ ] Complete it with a better run; comparison ranks thimbles first, then less
      thread, fewer stitches, and shorter simulated time.
- [ ] Force-close and relaunch once more; the updated best remains visible.
- [ ] Gameplay stays usable if local persistence is unavailable; record the
      storage failure separately rather than treating in-memory state as saved.

Notes:

```text
Pending.
```

## 4. Fifteen-level campaign route

Progress normally through the map; do not inject progress directly into
AsyncStorage for this gate.

- [ ] Bedroom Levels 1–5 unlock sequentially and teach ridge, boundary redirect,
      felt, hole, and thread-budget behavior.
- [ ] Completing Level 5 moves the pager directly to Attic and makes Level 6
      available.
- [ ] Attic Levels 6–10 unlock sequentially and teach silk, pocket, mixed
      felt/silk, two-stitch planning, and the hidden patch.
- [ ] Completing Level 10 moves the pager directly to Festival and makes Level
      11 available.
- [ ] Festival Levels 11–15 unlock sequentially and exercise thorn, elastic,
      pinch-plus-pocket, a tight stitch limit, and the combined finale.
- [ ] Every authored `Required` route condition appears in the Challenge block;
      a direct route that skips one remains incomplete, while the reference
      route satisfies all of them.
- [ ] Every level can fail, Retry, return to planning, and succeed without stale
      geometry, route, outcome, or active-level data from the previous level.
- [ ] Completing Level 15 leaves all 15 nodes completed after a cold relaunch.

Completion notes by quilt:

```text
Bedroom:
Attic:
Festival:
```

## 5. Materials, hazards, bumpers, and stitch types

- [ ] Felt visibly identifies a high-friction area and slows the traveler.
- [ ] Silk visibly identifies a low-friction area and preserves more speed.
- [ ] Elastic visibly identifies its region and produces the authored bumper
      response without tunneling or an unstable collision loop.
- [ ] Touching a hole or thorn produces a deterministic hazard failure with a
      readable outcome and working Retry.
- [ ] Static bumpers redirect the swept traveler consistently on repeated runs.
- [ ] Pocket-only Level 7 accepts pocket input and renders a bounded depression
      rather than a pinch ridge.
- [ ] Levels 13 and 15 expose both `stitch-type-pinch` and
      `stitch-type-pocket`; changing the selection affects only new stitches.
- [ ] A stitch-count rejection leaves the plan unchanged, says which limit was
      reached, and announces the same message to assistive technology.
- [ ] A thread-budget rejection leaves the plan unchanged and shows the full
      attempted total and exact overage instead of clamping the HUD to the cap.

Notes:

```text
Pending.
```

## 6. Collectible patches and merged achievements

- [ ] Attic Level 10 exposes an uncollected patch state on the map before play.
- [ ] A route that intersects the patch records it once and Results awards the
      patch thimble.
- [ ] The map changes the level to `PATCH FOUND` and increments the patch total.
- [ ] A later faster or lower-thread run that misses the patch does not erase
      the collected-patch achievement.
- [ ] Festival Level 15 repeats the same collection and persistence behavior.
- [ ] Patch collection does not change a success/failure outcome except through
      the route's normal physics interactions.

Notes:

```text
Pending.
```

## 7. Installed-app Maestro

With the app installed and Metro reachable when required:

```sh
maestro test .maestro/spike-smoke.yaml
maestro test .maestro/failure-retry.yaml
```

- [ ] The main flow starts at Quilt Map, enters Level 1, succeeds, reaches
      Results, completes replay, returns to the map, and observes Level 2 as
      `CURRENT`.
- [ ] A cold relaunch preserves the Level 2 unlock and tutorial completion.
- [ ] The regression flow starts at Quilt Map, enters Level 1, and covers
      baseline failure, Retry, Undo, and Reset.
- [ ] Report and video paths are recorded in the header.

## Sign-off

Choose exactly one result and copy it into the evidence header:

- [ ] **PASS — Milestone 3 physical campaign smoke complete.**
- [x] **PROVISIONAL — limited manual iOS smoke passed; the detailed campaign
      checklist and native Maestro evidence remain incomplete.**
- [ ] **FAIL — a blocking campaign/device regression was recorded above.**
