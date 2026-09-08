# Weekly leaderboard

The pause and game-over screens now offer a weekly competition ranked by each guest's best verified single run. Weeks begin Monday at 00:00 UTC. Equal scores retain first-server-acceptance order. The top three prizes are 100, 50 and 25 existing points, with automatic settlement and no claim button.

## Implementation

- Online registration supplies the seed, Firebase guest UID, environment, week and immutable ruleset. The next registration is prefetched; unavailable registration falls back to a local run after 1.8 seconds.
- The client records simulation ticks, aiming/cancellation, launch vectors and tools. Ordered batches contain at most 240 ticks, 64 commands and eight paid actions. Only a durable checkpoint's batches upload. Retries use identical sequence numbers; a changed batch cannot reuse a sequence.
- The server simulates v4 gameplay from its own checkpoint. Client scores and snapshots are never accepted. Paid actions require an applied receipt bound to that run, tool and exact tick/pocket context. Receipts cannot be reused. Free tools consume simulated inventory.
- Snapshot/replay pairs survive app restarts. Interrupted paid deliveries retain their before/after snapshots until reconciled. Previous runs remain queued for retry before their deadline. The local queue is bounded to 32 runs and 1,800 batches per run; failure preserves the last verified score and reports local/pending status.
- Existing v1–v3 saves and local best scores retain their formats. Revive's rewound game tick does not rewind the replay's elapsed clock.
- The top 50 and the player's own rank are returned separately. Aliases are generated without collecting names. The UI localizes the deadline, supports scrolling and larger text, and refreshes upload status while open. Opening cancels aiming and pauses the run; closing resumes it.
- Firebase authentication works without initializing RevenueCat. Reward wallet reads and tool spending can work while the purchase provider is unavailable. Purchase verification still requires the configured provider.
- Reward lots are separate from store transactions. FIFO spending and refunds distinguish reward and purchase allocations; legacy allocations default to purchase lots. Award, reward lot and wallet credit commit atomically under a revision guard.
- A five-minute Worker cron freezes positive-score winners at the deadline and grants each eligible award once. Practice weeks cannot later receive retroactive prizes. Expired replay payloads are pruned in bounded batches after eight weeks; standings and reward history remain.
- The server uses the frozen engine in `worker/rulesets`; the CI source manifest prevents accidental client physics drift. Treat this initial sandbox ruleset as frozen before enabling production competition. Future physics versions must retain the old engine and dispatch old registrations to it.

## Configuration and delivery

The additive migration is `worker/migrations/0002_weekly.sql`. The deployed Worker is `pullthread-commerce`, backed by the existing D1 database. `LEADERBOARD_ENABLED_ENVIRONMENTS=sandbox`; `LEADERBOARD_PRIZES_ENABLED` remains empty. Production competition and payouts are not enabled by this release's verification gate.

Firebase Authentication was initialized and Anonymous sign-in enabled in `pullthread-xuefeng-zhu` using the existing project. The Firebase console still showed Spark / no-cost. Automatic anonymous-account deletion was left off to preserve guest identities. No billing upgrade was performed.

The board requires a native connected build using the existing public Firebase and Worker configuration. The web export intentionally displays its mobile availability message. No fake entries, world selectors or production stage controls were added to the app.

## Evidence and remaining gates

- Full app suite, lint, TypeScript and iOS/Android/web exports passed. Final counts and build paths are recorded below after delivery.
- Worker/D1 suite: 63 tests passed, including duplicate submissions, wrong-account/environment rejection, real paid-teleport verification, concurrent settlement, tie order, reward spending/refunds and disabled-prize weeks.
- A 105-pocket deterministic run matched replayed state after every chunk and restored checkpoint across all five worlds. The local Node replay plus codec peak was approximately 3 ms; this is not a Cloudflare CPU measurement.
- Actual game-hook journaling matched server replay at 30, 60 and 120 FPS, including backgrounding during a drag.
- Connected Firebase/Worker checks each verified six catches and three exact duplicate-batch retries with no duplicate score or reward. Sandbox guest fixtures remain on the practice board; no production scores were inserted.
- The exported app's pause entry, unavailable state and close behavior were inspected at 320×568. A separate temporary fixture rendered the actual leaderboard component with 50 rows, an own rank outside the top 50, previous winners and high contrast; scrolling reached all content. Fixture data was not included in the production export.
- Cloudflare traces initially showed successful requests using 1–24 ms CPU, above the 10 ms free-tier target for some calls. Trusted checkpoint decoding, combined D1 reads, bounded short-lived verified-token caching and minification were added. Payouts must remain off until deployed CPU headroom is demonstrated reliably; successful HTTP responses alone are not that proof.
- The iPhone has repeatedly appeared as unavailable in CoreDevice. A signed artifact is prepared, but installation, launch and physical play must be confirmed separately.

### Final verification snapshot, September 7, 2026

- Full app run: **65 suites / 1,095 tests passed**. Subsequent focused UI, journal and native-auth regressions: **131 tests passed**, plus the added expired-week continuation regression.
- Final Worker/D1 run: **63 tests passed**. Deployed version: `99506d97-2fd7-492b-996c-927d655248f1`.
- Final connected check: six scored catches, three upload batches and three exact retries; own score verified, prizes disabled and wallet unchanged. All seven captured Worker trace outcomes were `ok`; CPU values were **18, 18, 2, 11, 2, 7, 3 ms**. The free-tier performance gate remains unmet, so payouts were not enabled.
- Final source staging: `/private/tmp/pullthread-weekly-native/20260907T234237Z`; verification artifacts and logs remain under `/private/tmp/pullthread-weekly-*`.

No physical-play or successful iPhone installation claim is made while CoreDevice reports the phone unavailable. Sandbox verification does not certify production payouts.

Final native package: `/private/tmp/pullthread-weekly-native/20260907T234237Z/Pullthread.app`. All 100 packaged source files matched the repository; strict code-signature verification passed; embedded Hermes bundle was 6,019,549 bytes. Installation was attempted and failed with CoreDevice error **1011**, because the previously selected iPhone could not be located. The update has not been installed or launched on that phone.
