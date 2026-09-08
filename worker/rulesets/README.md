# Immutable competition engine

Each `stitched-v4-weekly-N.js` file is a bundled pure replay engine, including v4 generation, physics and the trusted checkpoint codec. It contains no native UI, credentials or route solver. The Worker dispatches each recorded run to its original archive so later gameplay changes cannot reinterpret accepted runs.

The active source manifest pins the matching client engine. `node scripts/check-weekly-ruleset.cjs` fails CI if those sources change. For a future physics release, retain every prior engine, introduce a new ruleset identifier with `node scripts/create-weekly-ruleset.cjs stitched-v4-weekly-N`, dispatch registrations to their recorded version, and update the client/source manifest together. The generator refuses to overwrite a released archive.
