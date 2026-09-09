# Immutable competition engine

Each `stitched-v4-weekly-N.js`, `stitched-v5-weekly-N.js` or `stitched-v6-weekly-N.js` file is a bundled pure replay engine, including its generation, physics and checkpoint codec. It contains no native UI, credentials or route solver. The Worker dispatches each recorded run to its original archive so later gameplay changes cannot reinterpret accepted runs.

The active source manifest pins the matching client engine. `node scripts/check-weekly-ruleset.cjs` fails CI if those sources change. For a future physics release, retain every prior engine, introduce a new ruleset identifier with `node scripts/create-weekly-ruleset.cjs stitched-v6-weekly-N`, dispatch registrations to their recorded version, and update the client/source manifest together. The generator refuses to overwrite a released archive.

Registration accepts the active client `ruleset`, `stitched-v5-weekly-1` and `stitched-v4-weekly-3`. Requests without one retain `stitched-v4-weekly-3` for older clients; installed v5 clients can still request their original `stitched-v5-weekly-1`. Retired engines continue existing runs but cannot create new ones. A retried registration returns its existing run and ruleset regardless of the new request's preference. Deploy the Worker before releasing clients that request a newly supported ruleset, applying a schema migration first only when that release needs one.

Generation 6 introduces a three-charge free inventory with FIFO pickup replacement. Its archive preserves pickup order in checkpoints. Generations 1–5 keep their original uncapped inventory; the v5 archive is unchanged, and this release needs no database migration.
