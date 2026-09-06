# Archived classic and transition game design

Archived on 2026-09-06 before removing the old mode from the app. This snapshot
preserves historical mechanics, persistence, purchase, and backend contracts.
Its routes, source paths, configuration steps, and availability claims describe
that earlier version; they are not instructions for the current endless-only
app. Current documentation starts at [the repository README](../../README.md).

---

# Pullthread Game Design

## Product promise

**Pull back. Let go. Keep climbing.**

Pullthread opens directly into a portrait endless arcade game. The player
stretches a fabric pocket and launches a button through a scrolling handmade
playground. It should be understandable in seconds, comfortable in one hand,
and inviting to replay after a fall. No account, purchase, or network is required.

## Endless flight

1. Pull an occupied pocket backward to choose direction and power.
2. Release to launch. A short initial arc helps aim; there is no midair steering.
3. Bounce from stitched cushions and catch the next gold pocket from above.
4. Continue upward as new pockets and obstacles appear. Moving receivers become
   stable launch pockets after capture.
5. Falling off the fabric or touching thorns ends the run. Play again starts a
   fresh layout; there are no level breaks or checkpoint retries.

The score counts each new higher pocket actually caught, not skipped pockets
or repeat catches. Best score persists locally across app launches, independently
of classic saves. The current run stays in memory. Pause and Settings suspend
play; returning from Classic puzzles resumes the existing endless screen.

Sound, haptics, hints, high contrast, and reduced motion use shared Settings.
Reduced motion removes decorative animation without changing physical motion
or the camera needed to follow play.

## Classic puzzles

**Settings → Classic puzzles** opens the preserved stitch-puzzle campaign and
Daily Scrap. Draw stitches into a handmade quilt, watch the fabric tighten into
ridges or pockets, then release the traveler and let deterministic gravity
resolve the plan. A normal classic level lasts roughly 20–60 seconds.

The remaining puzzle mechanics, progression, monetization, and replay rules in
this document describe classic play. Full Atelier applies to that campaign;
endless flight is free.

## Classic core loop

1. Read the fabric, traveler, goal, hazards, materials, stitch/thread limits,
   required route conditions, and optional patch.
2. Drag between two eligible fabric points to place a stitch.
3. Read the live deformation and predicted route.
4. Undo, remove, reset, or add another stitch while within the level limits.
5. Release the traveler; editing locks while fixed-step gravity runs.
6. Succeed, fail and retry immediately, or review the deterministic result.
7. Improve thimbles, thread usage, patch collection, or replay the route.

The player never steers the traveler after release. Placement is the decision;
the simulation is the consequence.

## Classic controls and tactile language

- **Drag:** place the selected pinch or pocket stitch.
- **Tap a stitch:** remove it during planning.
- **Undo:** remove only the latest planning stitch.
- **Reset:** restore the canonical level surface and traveler.
- **Release:** freeze the plan and start gravity.
- **Retry:** return from a terminal run to planning without a loading screen.
- **Results / Replay:** inspect the successful run without recording progress a
  second time.

Thread tightening, restrained sound, and one intentional haptic communicate
commitment. Reduced motion can remove decorative transitions without changing
physics. High contrast changes visual indicators without changing the puzzle.

## Classic mechanics

### Stitches

- **Pinch:** raises a ridge along a dragged segment and pulls nearby cloth
  inward. It redirects, walls, and ramps the traveler.
- **Pocket:** creates a bounded concave basin around the stitch midpoint. It
  catches, slows, or turns the traveler.

Stitches have fixed predictable tension. Each consumes thread based on its
canonical fabric-space length. Extreme deformation is clamped so overlapping
stitches cannot destabilize physics.

### Fabric and objects

- **Felt:** increases friction.
- **Silk:** reduces friction.
- **Elastic:** strengthens bounded bumper response.
- **Holes and thorns:** deterministic hazards.
- **Bumpers:** swept circular collisions with authored restitution.
- **Patches:** optional collectibles retained in the best-run achievement.

### Route requirements and planning limits

Levels require a minimum stitch or thread commitment and can also require
particular stitch types, travel across named fabric types, or contact with
authored bumpers before the goal will accept the traveler. Current campaign
routes also require the traveler to ride every committed stitch, so an
off-course dummy stitch cannot satisfy a count or thread target. These
conditions reuse the existing deterministic simulation trace and are shown as
wrapping `Required` copy in the play screen's Challenge block. They are
completion rules, not hidden scoring bonuses.

Stitch and thread caps remain planning rules. A rejected drag does not consume
input: the play screen identifies whether the stitch count or thread budget
blocked it, shows the full attempted thread total and overage, and announces
the same feedback to assistive technology.

## Scoring and replay

A successful level awards:

1. one thimble for reaching the goal;
2. one thimble for meeting the inclusive target thread usage;
3. one thimble when that level contains and the traveler collects a patch.

Best runs rank by thimbles descending, then thread, stitch count, and simulated
completion time ascending. Patch and thread-target achievements merge safely
across successful attempts. Replays store only validated canonical input and
reconstruct the authored level through the same fixed-step simulation.

## Campaign progression

The campaign contains three ordered quilts and 15 levels:

- Bedroom Quilt: Levels 1–5
- Attic Quilt: Levels 6–10
- Festival Quilt: Levels 11–15

The Full Atelier route deliberately changes the direction of travel instead of
repeating the Bedroom solution. Levels 7–15 send the traveler left, right, up,
and down; mix horizontal and vertical pinch gestures; reverse the starting
corner; and turn materials, hazards, pockets, and bumpers into distinct course
shapes. The named objective and any deterministic route requirements are shown
as wrapping Challenge copy on the play screen so each layout's idea is legible
before the player draws.

The tutorial remains attached to Level 1, while the current campaign uses a
significantly narrower pinch influence radius. Both earlier campaign tunings and
immutable v1 Daily snapshots remain available for replay. Version-aware loading
therefore keeps dated challenge ids, saved replays, and server re-simulation
unchanged without forcing the live campaign to retain its old feel.

Completion unlocks only the next level. Progress is derived from saved
successful runs; there is no mutable unlock list. Purchasing Full Atelier never
marks a level complete and therefore never skips sequence.

The visible access states are:

| State | Meaning | Interaction |
| --- | --- | --- |
| `CURRENT` | Next playable level | Opens gameplay |
| `COMPLETED` | Finished and replayable | Opens gameplay |
| `LOCKED` | Predecessor incomplete | Disabled; explains progression |
| `ATELIER LOCKED` | Premium entitlement absent | Opens Full Atelier paywall |

Premium entitlement is also required to replay a completed premium level. Its
durable progress is retained while locked and becomes available again after a
verified entitlement or restore.

## Monetization: Full Atelier

Pullthread uses one optional, permanent-style campaign unlock rather than a
subscription, currency, energy system, or forced advertisement.

- **Free:** Levels 1–6, including the first silk level.
- **Full Atelier:** Levels 7–15, beginning with the first pocket-stitch level.
- **RevenueCat entitlement:** `full_atelier`
- **Store product:** `pullthread_full_game`

The boundary arrives after the player has learned the core pinch mechanic and
seen a second fabric material. It offers nine additional handcrafted levels,
pocket stitches, mixed materials, hazards, bumpers, patches, the Festival
finale, and replay of those premium levels.

The paywall follows explicit player intent: tapping a premium node or choosing
Next after Level 6. It is never shown at launch and never interrupts a free
level. It communicates **one-time unlock, no subscription**, uses the store's
localized offer price when available, and keeps Restore Purchases visible.

Purchase outcomes are humane and reversible:

- success unlocks the entitlement but preserves normal sequence;
- cancellation states that nothing was charged;
- errors retain existing access and campaign progress;
- restore is initiated only by the player and reports restored, not found, or
  failed without ambiguity;
- an unavailable offer disables purchase but not Restore.

## Offline and account policy

No account is required. Preferences, tutorial completion, classic campaign
progress, endless best score, and the last verified Full Atelier entitlement
live in separate versioned local stores.
Navigation waits for local hydration, not RevenueCat network work. A verified
entitlement may therefore keep premium play available during a refresh failure.

A new purchase or restore still needs the platform store transaction path and
may fail offline. Offer price/copy is presentation data rather than proof of
ownership. The game must not manufacture access merely because configuration
or a network is unavailable.

The development mock starts locked and exists to prove application behavior.
Its purchase, restore-not-found, error/cancellation injection, and debug
override do not prove StoreKit, Play Billing, RevenueCat receipt validation, or
a real offline entitlement. Production builds reject mock mode and cannot grant
new access; a previously RevenueCat-verified offline cache remains available.

## Daily Scrap

Daily Scrap is an optional classic mode reached through Settings → Classic
puzzles, then from the Quilt Map. One global UTC date produces one immutable challenge identity and selects
one handcrafted template from the effective, append-only free-level pool. Pool
ranges are finite and contiguous so an older build asks for an update instead
of generating a superseded challenge after its last shipped date. A new scrap
begins at 00:00 UTC. Attempts are unlimited and local play never requires an
account, purchase, service configuration, or network.

The Daily ranking contract is deliberately different from campaign thimbles:

1. lower thread used
2. fewer stitches
3. lower deterministic completion time

Patch collection does not change Daily rank. Exact ties retain the incumbent.
The personal best is saved on-device first and a compact, versioned stitch
replay remains watchable without submitting or changing campaign progress.

Firebase is an optional shared-board enhancement. Opening Daily Scrap may
lazily create an anonymous guest; there is no account screen and campaign launch
never initializes Firebase. Clients cannot author challenge definitions or
write leaderboard rows directly. An authenticated callable function validates
and re-simulates the replay, ignores claimed metrics, and transactionally keeps
one best row per challenge/player.

Truthful failure behavior is part of the design: local mode says it is local,
remote loading never disables Play, an outage retains the device best, and a
pending result says it was saved on this device rather than claiming upload.
Daily play must not unlock a campaign level, change Full Atelier entitlement,
show the paywall, or expose campaign Next Level behavior.

## Acceptance boundary

Automated tests prove access rules, cache sanitization, service result handling,
and UI routing. The development Maestro flow proves only the mock experience.
Production monetization is not complete until a rebuilt native app passes real
iOS and Android test-store purchase, cancellation, restore, and offline cold
launch checks with the configured product and entitlement.
