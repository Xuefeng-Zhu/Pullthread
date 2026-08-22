# Physical-Device Test and Evidence Record

## Gate status

**Status: NOT RUN / UNVERIFIED**

Milestone 1 is not device-complete until a human completes this document on at
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
| Date and tester | _pending_ |
| Commit SHA | _pending_ |
| Working tree clean or changes recorded | _pending_ |
| Platform | _pending: iOS or Android_ |
| Phone make/model | _pending_ |
| OS version | _pending_ |
| Build type | _pending: local development build, EAS development build, preview, or release_ |
| Install source/command | _pending_ |
| Expo Go used | **Must be No for acceptance** |
| Metro required during run | _pending_ |
| Screen-recording path/link | _pending_ |
| Maestro result path/link | _pending_ |
| Performance/debug capture path/link | _pending_ |

## Preconditions

- [ ] The exact commit/change set under test is recorded above.
- [ ] `npm ci` completed with Node 24.x.
- [ ] `npm run lint`, `npm run typecheck`, `npm test`, and `npm run export` pass.
- [ ] The project development build, not Expo Go, is installed.
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
- [ ] A clean launch reaches the spike directly; no account, network service,
      paywall, or credential is required.
- [ ] The app remains locked to portrait.
- [ ] The playfield and all controls avoid the notch, Dynamic Island/camera
      cutout, status area, and home/navigation indicator.
- [ ] Traveler, goal, stitch preview, committed thread, and fabric deformation
      are visible at normal viewing distance.
- [ ] Release, Undo, Reset, and Retry labels are readable and their targets feel
      at least 48 dp/comfortable under a thumb.
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

## 5. Repeated outcome check

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

## 6. Audio and haptics

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

## 7. Performance and lifecycle

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

## 8. Maestro installed-app smoke

With the development build installed and available to Maestro:

```sh
maestro test .maestro/spike-smoke.yaml
```

- [ ] The flow launches a clean app state.
- [ ] It finds the screen, playfield, planning status, counter, and four controls
      by stable IDs.
- [ ] The percentage drag commits one stitch.
- [ ] Release reaches a terminal outcome before timeout.
- [ ] Retry, Undo, a second placement, and Reset complete.
- [ ] The final stitch counter is zero.
- [ ] The Maestro report/video path is recorded in the evidence header.

If the percentage drag no longer represents the authored reference stitch after
a deliberate layout/level change, update the flow and record why. Do not weaken
terminal assertions merely to make the smoke flow green.

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
PROVISIONAL — no physical-device run has been recorded yet.
```
