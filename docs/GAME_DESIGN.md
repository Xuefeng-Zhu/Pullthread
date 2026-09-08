# Pullthread Game Design

**Pull back. Let go. Keep climbing.**

Pullthread is one portrait endless arcade game. A button climbs a handmade
fabric playground through short launches, cushion bounces, and pocket catches.
It should be understandable in seconds, comfortable in one hand, and inviting
to replay after a fall. It requires no account, purchase, or network.

## Core loop

1. Pull the occupied pocket backward to choose direction and power.
2. Release to launch. Read a short initial arc, then discover the flight.
3. Choose and catch a pocket above while descending, with no midair steering.
4. Pull again as the playground scrolls upward and presents new geometry. Padded
   side walls bounce the button back into play; lower pockets can catch a miss.
5. A thorn, closed sharp shutter, or a fall below the remaining pockets ends the run. Play again starts a fresh layout immediately;
   a Revive tool can restore the previous catch once per run.

The button follows the pull; short taps and cancelled gestures do not launch.
Pockets catch automatically when the button descends relative to their mouths.
Rotating hoops carry occupied pockets throughout aiming; release inherits their
tangential velocity. The handle preserves its initial finger offset, and only an
intentional drag arms a shot. Stitched cushions redirect flights through elastic
bounces. Historical swaying pockets still freeze on catch.

The playfield leaves extra fabric below the occupied pocket for a full downward
pull and the player's finger, above the device's bottom safe area. The same
projection positions the artwork and maps touch input, including after recovery.

New climbs use padded side walls that retain 80% of horizontal speed while
preserving vertical motion. The camera follows a falling button back down, and
the failure floor stays below the lowest retained pocket instead of rising with
each flight's peak. The current and previous complete sections remain available
for recovery. Returning to an earlier catch never adds score or restores a
collected tool. Saved runs keep the physics rules with which they began.

## Challenge and scoring

Two generous catches lead into branching, authored sections. Double stitching
marks the wider route and a star
marks the narrower reward route. Paths rejoin at broad, untimed recovery
pockets after two or three launches. Free tools appear along the reward route
in every other newly generated section, rotating Preview, Revive, and Teleport.
The opening Preview remains available, and generated gifts in saved runs stay
in place. Hints mention a tool only while one remains in that section; no
section requires a tool. New version-four layouts include three cloth corridors,
three teaching sections for each new mechanic, and six pairs of interactions,
all with exact mirrors. After teaching, both routes contain obstacles; the
roomier route has broader openings and simpler sequences.

Solid cloth rebounds with 0.55 restitution. Thorn-lined barriers are lethal.
Strong impacts tear loose cloth permanently: at least 400 units/second into the
surface, retaining 75% of normal velocity and all tangential velocity. A failed
attempt can return to a lower pocket and use the new passage on its next shot.
Snap buttons open matching section-owned doors permanently without scoring or
using tools. A switch hit applies before a later door collision in the same tick.

Timed shutters are open for two seconds, visibly warn for 0.75 seconds, then
close with lethal teeth for 1.25 seconds. Hoops, shutters and other gameplay
motion share the active 120 Hz simulation clock. Every obstacle stays outside
the entire occupied-pocket pull envelope, including all hoop phases. A broad,
untimed recovery pocket ends each section.

The score counts newly reached higher ascent ranks. Both branches share ranks;
a sibling catch or revisit scores nothing, and skipping a rank earns no credit
for it. Legal shortcuts remain legal, with no hidden bank-count or route rules.
Teleport uses the same scoring and starts a loose pocket's first-arrival timer.
Revive restores the previous catch's exact world clock and remaining lifetime,
while retaining the ledger of tools already collected and consumed.

A seed chooses authored section geometry, orientation, and eligible ordering.
Visible sections remain in place. The game retains whole sections independently
of scoring so the unchosen branch remains available. Obstacles begin after five
catches. Ordinary sections contain 1–2 barriers/hazards initially, 2–3 after 20,
3–4 after 40, 4–5 after 60 and 5–6 after 80; teaching sections override density.
Version-one linear saves, version-two sections and version-three stitched worlds
continue under their original rules. New runs use generation/save version four.
Broken panels and activated switches persist with their sections. Revive restores
the previous catch's exact interaction state.

## Stitched worlds

The current run's scored-catch count changes scenery every 20 catches:

| Score | World | Newly introduced interaction |
| --- | --- | --- |
| 0–19 | Sewing Table, cream linen | Fabric walls and thorn-lined corridors after five catches |
| 20–39 | Felt Garden, sage leaves and flowers | Rotating hoops carry occupied pockets |
| 40–59 | Patchwork Sky, pale blue clouds and ribbons | Strong shots tear permanent cloth passages |
| 60–79 | Bobbin Workshop, peach bobbins and gears | Snap buttons open linked zipper doors |
| 80–99 | Moonlit Quilt, lavender moons and stars | Timed zipper shutters and learned combinations |

At 100 the five fabrics repeat every 20 scored catches. All unlocked elements
remain eligible. Two-thirds of selections favor combinations and one-third use
obstacle corridors, with bounded speed and density. Revisits, sibling pockets, skipped ranks, height, and previous runs do
not advance these milestones. Teleport still awards at most one scored catch.

Backgrounds crossfade over 0.8 seconds of active play and a brief world name
appears without blocking gestures. Reduced motion switches fabrics immediately;
hoops and shutters retain their gameplay motion. Stitched edge motifs
leave the center clear, and high contrast retains distinct object boundaries.

Scenery changes never replace generated geometry. The next eligible ungenerated
section introduces the new interaction; an additional calm section may separate
it from pressure. Existing lookahead means the encounter can occur several
catches after its world begins. Each new element gets three introductory
sections on an optional branch, with a wide stationary untimed alternative and
recovery afterward. Only then may it combine with previously taught elements.
Sections contain at most two interactions, counting gates and fraying pockets.
No stage selector or mandatory tool is added.

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
