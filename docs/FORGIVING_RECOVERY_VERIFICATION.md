# Forgiving walls and lower-pocket recovery — September 7, 2026

New climbs have padded side walls that return 80% of horizontal speed and
preserve vertical motion. Wall contacts share the fixed 120 Hz simulation and
the Preview tool's prediction. Stitched rails mark the bouncy sides and a short
hint after the first catch explains recovery.

The camera now follows a missed shot back down. Its highest position no longer
raises the failure floor: the floor remains 110 world pixels below the lowest
retained pocket. Current and previous complete sections stay available for
lower catches, including a return to the launch pocket after clearing its lip.
Thorns and falls past the retained pockets still end the run.

Lower catches preserve the score, generation cursor, and collected-tool ledger.
Revive restores the lower catch's exact checkpoint and clock. Saved runs retain
their existing wall rules, including earlier version-two journals and the
version-one generator.

## Regressions

- Both walls, multiple contacts within a tick, inward launches stretched beyond
  a wall, zero restitution, thorn contact order, and 30/60/120 FPS parity.
- Actual launch inputs that bounce into a pocket or recover below the old
  camera floor. For seed zero, pull `{x: 6, y: 95}` from the second opening:
  the button misses high, then catches the first opening with score still two.
- Repeated rescue and reclimbing without duplicate points or tools, bounded
  section retention, serialization, Preview parity, and exact checkpoint revive.
- Older journals preserve their physics; invalid or inconsistent wall settings
  fail validation before recovery.

Lint and TypeScript pass. The full suite passes **667 tests across 50 suites**.
Production iOS, Android, and web export passes.

Reproduce with `npm run lint`, `npm run typecheck`, `npm test -- --silent`,
and `npm run export`. The final test log is
[available locally](/private/tmp/pullthread-forgiving-final-tests.log).

## Browser touch evidence

The exported production app passed nine actions driven through real CDP touch
gestures, with an externally controlled animation clock and no injected game
state. Both wall directions, lower rescue, reclimbing, a high missed shot,
failure, and one-tap retry were exercised. The actual teleport-target menu
confirmed the recovered pocket; revisits left the score at two.

Twenty-four screenshots cover 320×568, 390×844, and 1022×1280, including high
contrast and reduced motion. Inspected rails, hints, and recovered views remain
readable. No browser errors or horizontal overflow were observed.

- [Browser report](/private/tmp/pullthread-forgiving-evidence/browser-report.json)
- [Padded walls on a small phone](/private/tmp/pullthread-forgiving-evidence/padded-walls-opening-320.png)
- [Wall bounce](/private/tmp/pullthread-forgiving-evidence/left-wall-opening-wall-impact-390.png)
- [Lower-pocket rescue](/private/tmp/pullthread-forgiving-evidence/lower-pocket-rescue-390.png)
- [High missed shot recovered](/private/tmp/pullthread-forgiving-evidence/high-shot-recovered-390.png)
- [Browser harness](/private/tmp/pullthread-forgiving-browser.cjs)

## iPhone delivery

The signed Release app passed strict signature verification. All 86 frozen
runtime/configuration/asset hashes match the final checkout. Installation and
launch succeeded on Frank iPhone17, preserving existing app data. The first
install attempt disconnected; retry succeeded after the user unlocked and
connected the phone.

- [Native build and delivery record](/private/tmp/pullthread-forgiving-native/20260907T132052Z/manifest.json)
- [Installable app](/private/tmp/pullthread-forgiving-native/20260907T132052Z/Pullthread.app)

Physical touch feel has not been tested by automation. The installed build is
ready for the user's playtest; browser gestures and deterministic checks verify
the new recovery behavior separately.
