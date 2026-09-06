# Pullthread Game Design

**Pull back. Let go. Keep climbing.**

Pullthread is one portrait endless arcade game. A button climbs a handmade
fabric playground through short launches, cushion bounces, and pocket catches.
It should be understandable in seconds, comfortable in one hand, and inviting
to replay after a fall. It requires no account, purchase, or network.

## Core loop

1. Pull the occupied pocket backward to choose direction and power.
2. Release to launch. Read a short initial arc, then discover the flight.
3. Catch the next gold pocket while descending, with no midair steering.
4. Pull again as the playground scrolls upward and presents new geometry.
5. A thorn or a fall ends the run. Play again starts a fresh layout immediately.

The button follows the pull; short taps and cancelled gestures do not launch.
Pockets catch automatically. A moving receiver keeps moving during aiming but
becomes stationary after the catch. Stitched cushions redirect flights through
elastic bounces.

## Challenge and scoring

The first two catches are generous. Catches three through five introduce an
arc around thorns, a necessary cushion bounce, and a moving receiver in a
remixed order. Catch six provides a wide recovery pocket. Later runs mix those
families with flat and steep direction reversals, with a recovery every fourth
catch through fourteen and every fifth catch thereafter. Difficulty caps after
catch fifteen. There is always unlimited time to aim.

Authored layouts and their mirrors replace independent random object placement.
Some thorn arrangements reward a shallow arc; others require more height.
Return banks send the button sideways into a fully visible cushion and back
above a thorn. Moving receivers travel horizontally while the player aims,
making release timing matter. Their openings narrow from 100 to 76 world units;
recovery openings remain 120–144 units. Brief first-bank and first-timing cues
follow the tutorial-hints preference and disappear when the player begins a pull.

At capped difficulty, the timing layouts add an overhead thorn: a controlled
launch must meet the moving receiver, while an excessively high arc hits the
ceiling. The next connector crosses away from that thorn for the entire moving
receiver catch range.

The game generates ahead continuously, with no level breaks, finish screen, or
checkpoint retry. Visible geometry stays in place, including after a moving
receiver freezes at its actual caught location. Legal alternative catches count;
there is no hidden bounce-count or route requirement.

The score counts each new higher pocket actually caught. Skipping an intermediate
pocket earns only the one catch; returning to a previously reached area does not
farm points. Best score saves locally across runs and app launches. The active
run stays in memory, so a cold launch starts a fresh attempt.

## Controls and preferences

- **Pause** suspends the current run; **Resume** continues it.
- **New run** while paused and **Play again** after death start fresh attempts.
- **Settings** pauses gameplay and offers sound, haptics, reduced motion, high
  contrast, and tutorial hints. **Done** returns to the same run.
- Backgrounding cancels an active pull and pauses flight without consuming
  background time.

Use cloth stretch/snap, cushion compression, catch motion, restrained sounds,
and haptics to make actions legible. High contrast improves object separation.
Reduced motion removes decorative effects without changing physics or the camera
needed to follow the player. The short aim arc should help direction and power
without revealing the complete route.

## Success criteria

A new player should understand the first launch within 30 seconds. After several
catches, aiming, release timing, and changes in direction should remain distinct
decisions. Misses should invite another attempt. Evaluate these through real
play, alongside checks for compact portrait layouts, readable enlarged text,
responsive gestures after scrolling, and reliable pause/restart behavior.

Use [the device checklist](ENDLESS_SMOKE_TEST.md) for observations and dated
evidence. Earlier puzzle mechanics and commercial contracts are preserved only
as [historical references](archive/README.md).
