# Milestone 2 Design Contract

Reference: `docs/design/pullthread-milestone-2-concept-sheet.png`

Milestone 2 extends the existing gameplay surface with three code-native states:
a non-blocking tutorial card, a successful-run results and replay screen, and a
persisted settings screen. The concept is a direction reference rather than a
pixel asset; all controls, copy, toggles, statistics, and replay behavior remain
native React Native or Skia UI.

## Visual inventory

- **Foundation:** deep indigo textile surround, oatmeal woven surfaces, warm
  cream raised panels, indigo stitched frames, and cranberry primary actions.
- **Typography:** Fraunces bold for level and outcome titles; Nunito Sans bold
  or semibold for controls, statistics, settings, and instructional copy.
- **Gameplay primitives:** title plaque, paired HUD pills, framed quilt canvas,
  teal button traveler, cranberry pinch stitch, green embroidered goal, and
  dotted route preview.
- **New components:** tutorial coach card with step progress and Skip action;
  replay-ready quilt panel; three results statistic tiles; best-result badge;
  accessible settings rows with explicit on/off switches.
- **Control hierarchy:** cranberry filled primary action, cream bordered
  secondary action, and compact cream icon action. All targets are at least 44
  dp and use text or icon labels in addition to color.
- **Motion:** short fades and cloth/traveler playback by default. Reduced motion
  removes decorative entrances and shows the replay end state without autoplay.
- **High contrast:** deepens thread, goal, focus, and fabric outlines while
  preserving text labels and shapes as the primary status signals.

## Exact visible copy

### Tutorial

1. `Pull the cloth` — `Drag a long stitch beside the button.`
2. `Read the route` — `The dotted path shows where the button will roll.`
3. `Let gravity work` — `Tap Release and watch the cloth solve it.`

The card also exposes `SKIP` and a code-native `1 of 3` style progress label.
The route-reading step adds `NEXT` so it remains visible long enough to learn;
an in-field cranberry guide marks the device-independent automated pull. A
successful Release completes the guide whether the player first taps Next or
follows the gameplay status directly.

### Results

- `Perfect pull!`
- `The button found the embroidery.`
- `REPLAY READY`
- `THREAD`, `STITCHES`, `TIME`
- `NEW BEST`
- `WATCH REPLAY`, `TRY AGAIN`

### Settings

- `Settings`
- `Sound`, `Haptics`, `Reduced motion`, `High contrast`, `Tutorial hints`
- `Changes save on this device.`
- `DONE`

## Behavior contract

- Tutorial hints never block the stitch gesture area or require completion to
  play. The first committed stitch advances the guide; the player may
  acknowledge the successful route with Next, while a successful direct
  Release also completes and persists it.
- A successful terminal state keeps the authored stitch list and exact
  deterministic outcome available for the results route.
- A replay is versioned level input, not recorded screen coordinates or frame
  timing. Re-running it reconstructs canonical stitches and the same fixed-step
  outcome.
- Replay playback visibly draws/tightens the saved thread before releasing the
  traveler. Reduced motion keeps the final route and skips autoplay.
- Settings persist locally, apply immediately, and never change the deterministic
  core simulation.
- The gameplay failure path retains immediate Retry; only success presents the
  dedicated results action.

## Fidelity checklist

- Preserve the existing framed fabric as the visual focus on gameplay/replay.
- Keep the tutorial card compact and outside the central gesture path.
- Use the existing palette and typography instead of introducing new gradients
  or platform-default surfaces.
- Keep the three result statistics legible at a 390 x 844 viewport.
- Make every settings state readable as text and switch position, not color alone.
- Preserve safe-area spacing and avoid clipped bottom actions on short devices.

## Implemented visual QA

The accepted direction sheet is
`docs/design/pullthread-milestone-2-concept-sheet.png`. Final implementation
captures were taken from the Codex in-app Browser with
`tab.screenshot({ fullPage: false })` at 390 x 844, plus a compact 320 x 568
pass:

- `docs/design/pullthread-m2-tutorial-guide-phone.png`
- `docs/design/pullthread-m2-compact-320x568.png`
- `docs/design/pullthread-m2-results-phone.png`
- `docs/design/pullthread-m2-replay-tightening-phone.png`
- `docs/design/pullthread-m2-settings-phone.png`
- `docs/design/pullthread-m2-high-contrast-phone.png`

Fidelity comparison:

1. The deep indigo surround, oatmeal fabric, cream plaques, cranberry primary
   controls, mustard goal, and teal traveler retain the concept hierarchy.
2. Fraunces headings and Nunito Sans labels preserve the concept's editorial
   title/sturdy-control contrast.
3. Results retains the framed replay, three equal statistics, best badge,
   dominant Watch Replay action, Try Again, and compact Settings action.
4. Settings retains five explicit labelled rows, icon-plus-text meaning,
   switch state, one dominant Done action, and the device-save explanation.
5. Tutorial progress, Skip, large bottom controls, and the fabric-first gesture
   surface remain legible at both tested phone sizes with no page overflow.
6. Replay visibly draws the saved thread before traveler motion; busy primary
   and Settings actions are visibly disabled during that interval.

Copy differences and intentional deviations:

- All contracted tutorial, Results, and Settings copy is preserved. `NEXT`,
  `TIGHTENING THREAD`, `WATCHING REPLAY`, `REPLAY COMPLETE`, and
  `BEST {thread} THREAD` are state-specific implementation additions.
- The tutorial card sits above the fabric rather than below it so the gesture
  and controls never overlap on a compact phone. A small cranberry in-field
  guide was added for learnability and device-independent Maestro input.
- Procedural Skia weave, contour, thread, and flower/icon details replace the
  concept's painted textile ornament so gameplay stays code-native and driven
  by the deterministic height field.
- Settings uses a single Done action instead of the concept's redundant close
  and Done controls. Native switches preserve platform semantics while their
  adjacent ON/OFF text keeps state independent of color.
