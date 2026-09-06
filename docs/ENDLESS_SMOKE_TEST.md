# Endless Flight Device Smoke

Endless flight is Pullthread's only game in development and production builds.
This checklist covers the current game. Historical classic campaign device
records do not establish an endless gameplay pass.

## 2026-09-06 authored challenge climb verification

This update replaces independently scattered obstacles with authored arcs,
required banks, reversals, and timing layouts. Two wide opening catches precede
the difficulty ramp and scheduled recovery pockets. Capped timing combines
controlled power with moving-receiver timing. Visible geometry stays fixed;
successor selection covers the moving receiver's entire catch interval.

Final lint and TypeScript checks passed with no warnings. All 30 Jest suites
(393 tests) passed, along with iOS, Android, and web production bundle export.
Verification includes 32 seeds × two openings × 121 aim variations, every
layout and mirror's ±3 grid, bank occlusion and adversarial inputs, moving
release windows, retained-obstacle seams, 16 seeds × 128 catches, bounded
geometry, and deterministic 30/60/120 FPS replay. Lifecycle and saved-score
regressions remain green. The offline route report supplies 54 layout/mirror
witnesses plus a 128-catch input sequence; see
[challenge authoring](CHALLENGE_AUTHORING.md).

The final exported web bundle passed CDP touch playthroughs to 20 catches at
320 × 568 and 390 × 844. Both traversed all four challenge families, recovery
pockets, and expert timing. These controlled-frame checks also covered pause,
Settings, high contrast, and reduced motion. A separate real-time check at
1022 × 1280 covered a touch catch, permanent failure, immediate restart, and
best-score persistence after reload. Measured playfield bounds filled every
viewport, with no page errors or document overflow. Initial, bank, timing,
and post-catch layouts were visually inspected. The exported app contains no
trajectory-search or completing-witness tooling.

The signed Xcode Release build, signature verification, and installation on the
paired iPhone 17e passed. The first installation lost its transport connection;
the same verified app installed successfully on retry, without uninstalling or
resetting app data. Its bundled JavaScript does not require Metro. The 97-file
source/assets/config snapshot matched the staging copy throughout the build.
The JavaScript bundle SHA-256 is
`68a91c54d45c9e9751b5f5d3980eb2bdf6c8123f30daaee3c442bba64b3b9988`.

The launch request was denied by iOS because the device was locked
(`FBSOpenApplicationErrorDomain`, code 7, `Locked`). No phone launch or physical
playthrough is claimed for this update. Build, signature, installation, source
manifest, and launch records are in
`/private/tmp/pullthread-native-challenges-r0__9ph1/`.

### Feel assessment and remaining manual checks

The automated seed-zero run meets a moving receiver at catch three, a shallow
thorn arc at four, and a required bank at five. Its first ten catches include
different pull powers, direction reversals, and two cushion bounces. This is
concrete evidence that the opening ramp presents distinct actions. The banks
retain wide receivers, and the aim-variation grids check that small misses in
input do not make the intended routes excessively precise.

Whether a new player understands the first launch within 30 seconds, notices
the added challenge by catches three through six, and finds misses inviting
to retry remains a physical playtest question. Phone touch feel, sound,
haptics, real frame pacing, and the extended device checklist have not yet
been verified for this update. iPhone Mirroring currently requires the Mac
to be unlocked; automated browser inputs are not a substitute for that pass.

## 2026-09-06 fullscreen rebuild verification

The current uncommitted rebuild removes the classic app routes and fills the
screen with fabric, keeping score, pause, and Settings in a floating HUD.
Chrome CDP touch checks passed at 320 × 568, 390 × 844, and 1022 × 1280. The
playfield's measured bounds matched each full viewport. Checks covered a catch,
aiming after camera movement, pause/Settings/return, preferences, permanent
failure, restart, and a best score retained after reload, with no page errors
or viewport overflow. Initial and post-catch layouts were visually inspected.
The compact-phone smoke also passed against the exported production web bundle.

Lint, TypeScript, all 26 Jest suites (280 tests), and iOS/Android/web bundle
export passed. Tests include safe-area projection, enlarged text, resize
cancellation, and 48-point controls. The physics and background-pause behavior
are unchanged by the fullscreen projection.

The fullscreen build also passed a signed Xcode Release build, signature
verification, and installation and launch on an iPhone 17e running iOS 26.6.1.
It contains its JavaScript bundle and does not require Metro. An initial device
connection timeout was resolved after reconnecting and unlocking the phone.
This confirms native delivery and launch; physical touch feel, audio, haptics,
and the extended device checklist below have not been verified for this build.

## 2026-09-06 browser verification before old-mode removal

This dated record covers the earlier promotion of endless flight, when a
classic-mode route still existed. It is retained as prior evidence and does not
claim verification of the later removal changes.

That local, uncommitted working tree passed production bundle export and a
desktop Chrome smoke using CDP touch input at 390 × 844 and 320 × 568 viewports.
The run covered direct main-game launch, a successful catch and score of one,
pause/Settings return with the run preserved, high contrast and reduced motion,
a Classic puzzles round trip retaining the score, permanent failure, a fresh
run at zero with best one, and a page reload retaining best one. No page errors
or viewport overflow were observed in those checks.

That earlier change passed 46 Jest suites (502 tests), lint, TypeScript checking,
and iOS, Android, and web bundle export. A separate production-browser test
injected a temporary storage read failure with a saved best of 17, then played
to one pocket: play continued and the durable best stayed 17.

This earlier record is production-web evidence only. Physical iPhone play was not run because
the local Xcode setup lacked an Apple account and a Pullthread development
provisioning profile. The device checklist below remains unverified; native
touch feel, haptics, audio, lifecycle, and performance still need a manual pass.
The fullscreen rebuild above subsequently resolved signing and native delivery.

## Evidence to record

Record the date, exact change set, phone and OS, build type, and whether Metro
was required. Attach a recording when available. Mark untested behavior plainly;
web, bundle-export, and unsigned native-build results do not prove a physical
phone playthrough.

## Play and feel

- [ ] A clean launch opens Endless flight, with no account or paywall step.
- [ ] Within 30 seconds, a new player understands pulling backward and releasing.
- [ ] The button follows the finger; longer pulls visibly increase power and
      the short aim arc helps without revealing the full route.
- [ ] Taps and cancelled gestures do not launch. New touches during flight do
      not steer the button.
- [ ] Catch several pockets. The gold target changes, the view scrolls upward,
      and gestures still start at the visible button after scrolling.
- [ ] A moving receiver keeps moving during aim and becomes a stable pocket
      after the catch.
- [ ] A cushion visibly compresses on contact. Thorns or a fall end the run.
- [ ] Play again starts a fresh run immediately; there are no checkpoint retries.
- [ ] Record whether misses invite another attempt and whether later catches
      introduce meaningful changes in direction, power, and timing.

## State and navigation

- [ ] Reach a nonzero best. Pause, resume, and start a new run; best remains.
- [ ] Stop and relaunch without clearing storage: the run restarts at zero,
      while the nonzero best survives.
- [ ] Returning to an old pocket does not increase the score. Skipping a pocket
      counts the one higher pocket actually caught.
- [ ] Background during a pull: the gesture cancels. Background during flight:
      physics pauses and resumes without consuming background time.
- [ ] Settings pauses the run and shows only five preferences: sound, haptics,
      reduced motion, high contrast, and tutorial hints. Done returns to the
      existing run; an explicitly paused run stays paused.
- [ ] No map, alternate mode, account, Daily Scrap, or purchase controls appear.

## Display and preferences

- [ ] Verify a compact portrait phone and enlarged text without obscured controls.
- [ ] Toggle sound, haptics, hints, high contrast, and reduced motion in Settings.
      Cosmetic motion follows preferences; essential physics and camera follow
      remain playable.
- [ ] Repeat catches and restarts long enough to check frame pacing, touch
      responsiveness, and bounded memory during scrolling.

Run `.maestro/endless-smoke.yaml` for installed-app entry, pause, restart, and
Settings/Done coverage. Its route checks do not replace the manual
gesture, persisted nonzero score, or gameplay-feel checks above.
