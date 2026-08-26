# Physical-Device Test and Evidence Record

## Gate status

**Status: LIMITED iOS SMOKE PASS / FULL CHECKLIST PENDING**

On 2026-08-25, the project owner completed a manual smoke pass on an iPhone
17e running iOS 26.6. The locally signed development build installed, launched,
loaded the Metro bundle, and the owner reported that manual gameplay was
working normally. This proves the local physical-iOS build and basic gameplay
path only. It does not complete the extended interaction, audio/haptics,
performance, lifecycle, repetition, recording, or Maestro checks below.

A separate limited Milestone 3 manual iOS smoke pass for commit `84d73bc` was
recorded on 2026-08-26 in
[`CAMPAIGN_SMOKE_TEST.md`](CAMPAIGN_SMOKE_TEST.md). That report likewise does
not complete the detailed checklist in this document.

Milestones 1 and 2 are not device-complete until a human completes this document on at
least one real iOS or Android phone. CI, Expo export, web, iOS Simulator, and
Android Emulator results are valuable but cannot replace this gate.

Testing one physical platform proves only that recorded platform/device. Record
the other platform as simulator-only, untested, or separately device-tested;
never generalize a one-phone pass to both hardware platforms.

## Required evidence header

Fill this in before testing. Do not record secrets, signing material, device
identifiers, or account credentials.

| Field | Evidence |
| --- | --- |
| Date and tester | 2026-08-25 — project owner |
| Commit SHA | `764f9f279c6ff6ca63728bdfd10399ae73d959aa` |
| Working tree clean or changes recorded | Clean `main`; generated native workspace isolated in a detached temporary worktree |
| Platform | iOS |
| Phone make/model | Apple iPhone 17e |
| OS version | iOS 26.6 (`23G71`) |
| Build type | Local development build |
| Install source/command | Signed Xcode Debug build; installed and launched with `xcrun devicectl` |
| Expo Go used | **No** |
| Metro required during run | Yes; LAN development-client URL on port 8081 |
| Screen-recording path/link | Not captured for this smoke pass |
| Maestro result path/link | Not run on the physical phone |
| Performance/debug capture path/link | Not captured for this smoke pass |

## 2026-08-25 limited smoke evidence

- [x] A local arm64 iPhoneOS development build completed with automatic signing.
- [x] The signed app installed with bundle identifier `com.xuefengzhu.pullthread`.
- [x] Developer Mode/profile trust was enabled and the app launched successfully.
- [x] Metro served the iOS bundle successfully (1,757 modules; no fatal error).
- [x] The app process remained running after bundle load.
- [x] The project owner manually exercised the app and reported that it was
      working normally.
- [ ] The detailed sections below have been completed with recordings and
      observations.
- [ ] Both installed-app Maestro flows have run on this physical phone.

## Preconditions

- [ ] The exact commit/change set under test is recorded above.
- [ ] `npm ci` completed with Node 24.x.
- [ ] `npm run lint`, `npm run typecheck`, `npm test`, and `npm run export` pass.
- [ ] The project development build, not Expo Go, is installed.
- [ ] The development build was rebuilt after the Milestone 2 AsyncStorage and
      Expo SDK 57 patch dependency changes.
- [ ] The phone trusts the development host and can reach Metro if the build
      depends on Metro.
- [ ] Screen recording is enabled before the mechanic proof.
- [ ] The development FPS/fixed-step overlay is available if implemented.
- [ ] System volume is audible and the test environment allows listening for
      feedback cues.
- [ ] Haptics are enabled at the OS level.

For first installation, use the platform command documented in `README.md`:

```sh
npx expo run:android --device
# or, on macOS with Xcode signing configured:
npx expo run:ios --device
```

For an already installed compatible development client:

```sh
npm start
```

## 1. Installation, launch, and layout

- [ ] The app installs and launches without a red screen, native crash, or
      missing-bundle error.
- [ ] A clean launch reaches the Quilt Map; no account, network service,
      paywall, or credential is required. Open Level 1 before the mechanic
      checks below.
- [ ] The app remains locked to portrait.
- [ ] The playfield and all controls avoid the notch, Dynamic Island/camera
      cutout, status area, and home/navigation indicator.
- [ ] Traveler, goal, stitch preview, committed thread, and fabric deformation
      are visible at normal viewing distance.
- [ ] Map, Release, Undo, Reset, Retry, Results, and Settings controls are
      readable and their targets feel at least 48 dp/comfortable under a thumb.
- [ ] The layout remains usable at the phone's configured text/display scale.

Notes:

```text
Pending.
```

## 2. Zero-stitch baseline

Start from Reset with no stitches.

- [ ] The stitch counter is zero and Undo is disabled.
- [ ] Tap Release.
- [ ] Stitch editing is unavailable while the traveler moves.
- [ ] The traveler follows the expected baseline route.
- [ ] The run reaches failure without hanging indefinitely.
- [ ] The failure reason is visible without relying only on color or motion.
- [ ] Retry returns to planning quickly and restores the canonical traveler
      state.
- [ ] The recording clearly captures the complete baseline route and result.

Observed outcome and simulated duration:

```text
Pending.
```

## 3. Reference pinch-stitch success

From the same reset state, draw the documented reference stitch. Use the
on-screen level solution/debug data rather than adjusting physics between runs.

- [ ] The live preview follows the finger without a visible jump at commit.
- [ ] Finger position maps correctly near both stitch endpoints.
- [ ] Thread/deformation tightens visibly when committed.
- [ ] The changed slope or ridge is readable before Release.
- [ ] The stitch counter increments exactly once.
- [ ] Tap Release.
- [ ] The stitched route visibly diverges from the baseline route.
- [ ] The traveler reaches the goal and the success state appears.
- [ ] The recording captures the stitch, deformation, changed route, and goal.

Reference stitch coordinates/version and observed outcome:

```text
Pending.
```

## 4. Planning controls and rapid iteration

- [ ] Retry after a completed run retains the committed stitch and restores the
      traveler.
- [ ] Undo removes only the latest stitch and immediately restores the expected
      surface.
- [ ] Reset removes every stitch, restores the base surface, resets the counter,
      and restores the traveler.
- [ ] An invalid or very short drag does not consume a stitch.
- [ ] Attempts to place or edit a stitch while running are ignored.
- [ ] Perform at least 25 place/release/retry/undo/reset cycles.
- [ ] No stale outcome, duplicate stitch, route corruption, mesh drift, growing
      latency, crash, or visual residue appears.

Cycle count and notes:

```text
Pending.
```

## 5. Tutorial, results, replay, and preferences

Start once from cleared app data, then repeat after relaunching without clearing
data.

- [ ] The tutorial first shows `Pull the cloth` without covering the stitch
      gesture area.
- [ ] A valid stitch advances to `Read the route`; that step remains visible
      until Next is tapped.
- [ ] Next advances to `Let gravity work`, and successful Release completes the
      tutorial.
- [ ] Results show the exact thread, stitch, and simulated completion-time
      values for the successful run.
- [ ] Watch Replay first draws/tightens the saved thread, then releases the
      traveler without player input, and finishes at the same goal.
- [ ] Watch Replay can be restarted at least five times without stale position,
      feedback stacking, or memory/latency growth.
- [ ] Reduced motion removes the tightening/traveler autoplay and presents the
      completed replay state immediately.
- [ ] High contrast visibly strengthens thread, route, goal, traveler, grid,
      and playfield outlines without hiding texture or copy.
- [ ] Sound and Haptics toggles independently suppress their corresponding
      cues, then restore them when re-enabled.
- [ ] Settings and tutorial completion survive a cold app relaunch.
- [ ] Try Again clears the completed run and returns to zero-stitch planning.
- [ ] Return to Map shows Level 1 completed and Level 2 available without
      weakening the pending extended Milestones 1/2 checks above.

Notes and replay-cycle count:

```text
Pending.
```

## 6. Repeated outcome check

The Jest suite is the authoritative 30-run deterministic core proof. Hardware
testing connects that core result to the rendered and interactive app.

- [ ] Repeat the zero-stitch baseline five times; every run has the same outcome
      and visibly equivalent route.
- [ ] Repeat the exact saved/reference stitch five times using Retry rather than
      redrawing; every run has the same outcome and visibly equivalent route.
- [ ] Record any path or terminal-result divergence as a failure, even if a
      later retry succeeds.

Observed baseline outcomes:

```text
Pending.
```

Observed stitched outcomes:

```text
Pending.
```

## 7. Audio and haptics

These checks require a human holding the phone. Simulator logs or successful API
calls are not substitutes.

- [ ] Stitch completion produces one intentional haptic, not a burst or delayed
      vibration.
- [ ] Success and failure feedback are perceptibly distinct.
- [ ] Feedback timing matches the visible event closely enough to feel causal.
- [ ] Placeholder audio is audible, free of obvious clipping, and does not stack
      uncontrollably during rapid retries.
- [ ] Unsupported/disabled feedback does not block controls or crash the run.
- [ ] Behavior with the platform's silent/ringer and media-volume controls is
      recorded, not assumed.

Notes:

```text
Pending.
```

## 8. Performance and lifecycle

- [ ] Observe at least 60 continuous seconds of planning preview and simulation.
- [ ] Frame pacing remains visually stable while drawing, tightening, rolling,
      and showing the terminal state.
- [ ] Record FPS/debug-overlay evidence and any sustained drop or hitch.
- [ ] The phone does not become unusually hot during this short test.
- [ ] Memory/interaction responsiveness does not visibly degrade during the
      25-cycle iteration test.
- [ ] Background the app while planning, return, and verify state is safe.
- [ ] Background the app while running, return, and verify the simulation did
      not jump, explode, or silently produce an invalid result.
- [ ] Lock/unlock or interrupt once and verify the app remains usable.

Observed FPS range, frame-pacing notes, and lifecycle behavior:

```text
Pending.
```

The brief prefers stable 60 FPS, but the evidence must report what the phone
actually produced. Do not turn a simulator number into a phone performance
claim.

## 9. Maestro installed-app smoke

With the development build installed and available to Maestro:

```sh
maestro test .maestro/spike-smoke.yaml
maestro test .maestro/failure-retry.yaml
```

- [ ] The flow launches a clean app state.
- [ ] The main flow enters Level 1 from Quilt Map, completes all three tutorial
      beats, the authored tutorial guide, Results, replay completion, returns
      to the map, observes Level 2 unlocked, and proves progress/tutorial
      persistence after cold relaunch.
- [ ] The regression flow enters Level 1 from Quilt Map and completes baseline
      failure, Retry, Undo, and Reset.
- [ ] The regression flow's final stitch counter is zero.
- [ ] The Maestro report/video path is recorded in the evidence header.

After entering Level 1, the flows begin at the code-authored
`tutorial-stitch-anchor` and swipe upward, so their gesture is relative to the
playfield instead of global screen percentages. If the authored guide or level
geometry changes deliberately, update both together and record why. Do not
weaken terminal assertions merely to make the smoke flow green.

## Offline evidence boundary

A development client that loads JavaScript from Metro has not proved cold
offline launch. It may still demonstrate that gameplay makes no service calls
after the bundle is loaded. Full installed-bundle airplane-mode/cold-launch
evidence belongs to a preview or release build in a later milestone.

- [ ] Record whether Metro or LAN connectivity was required.
- [ ] Do not mark campaign-offline behavior verified from this technical spike.

## Sign-off

Choose exactly one result:

- [ ] **PASS — physical-device gate complete.** All required items pass and the
      evidence links above are usable.
- [ ] **PROVISIONAL — implementation complete, hardware gate outstanding.** Use
      this when automated/simulator checks pass but phone evidence is incomplete.
- [ ] **FAIL — physical-device issue found.** Record the blocking issue below.

Result, tester, date, and blocking follow-up if any:

```text
PROVISIONAL — limited physical-iOS smoke recorded; full checklist and native
Maestro evidence remain pending.
```
