# Button Studio

Players can open Button Studio from pause, game over, or Points & tools. The studio previews any combination without spending. Buying unlocks a part permanently; Equip look applies a fully owned combination immediately while the game remains paused. Get points returns to the same customization draft.

The original color, rim and plain face are free. Coral, Sky, Lavender, Sunflower, Cream and Midnight cost 25 points each. Brass, Pearl and Scalloped rims cost 50. Cross-stitch, Daisies and Stars cost 75. A complete paid combination costs 150 points.

## Persistence and commerce

- Stable IDs and prices live in `src/cosmetics/catalog.ts`, shared with the Worker.
- `/cosmeticAccount` returns authenticated ownership, the current catalog and wallet. `/cosmeticPurchase` validates the server price and binds an operation ID to an item and price. Retrying that operation recovers its outcome.
- Migration `0003_cosmetics.sql` adds account/environment-scoped ownership and purchase records. The existing wallet revision assertion commits allocations, debit and ownership together. Concurrent purchases of an already owned part cost zero. Tool receipts and store purchase products are unchanged.
- The client durably records intent before requesting a purchase. Unknown outcomes retry that same operation before another purchase. Only an operation-bound insufficient-funds refusal clears an unsuccessful intent. Ownership never unlocks optimistically.
- Verified ownership and equipped parts are cached separately for each guest UID and environment. Cached owned parts can be equipped offline; new purchases need connectivity. Unknown and unowned selections fall back per category to original parts. Mock commerce cannot make connected cosmetic purchases.
- Connected sandbox builds use the same authenticated Worker wallet on iOS, Android, and web. Browser purchases spend points already verified for that browser guest profile; clearing site data or changing browsers can change that identity and its collection.
- Cosmetics remain outside run snapshots and replay commands. The frozen weekly physics manifest still matches. Collision radius, inventories, scoring, revive and historical runs are unchanged by customization.
- Unlocks belong to the existing guest identity. The current reinstall/device-change recovery limitations remain. Store refunds remove unspent purchased points under the existing policy; already unlocked cosmetics remain owned.

## Verification — September 7, 2026

- Full app suite: 66 suites / 1,101 tests passed. Subsequent focused collection/UI/auth/transport run: 4 suites / 71 tests passed, including two new studio interaction tests.
- Worker suite: 67 tests passed, including simultaneous same-item purchases, duplicate operations, forged prices, insufficient funds, account/environment isolation, reward/purchase allocation, store refunds and authenticated endpoint gates.
- TypeScript (app and Worker), lint, diff whitespace checks, frozen weekly engine verification, and iOS/Android/web exports passed.
- Remote additive migration applied. Sandbox deployment: `f5838198-0ec3-4caf-9b4a-941ab5e5ec0a`. `COSMETICS_ENABLED_ENVIRONMENTS=sandbox`; production cosmetics and weekly payouts remain disabled. Infrastructure billing was not changed.
- Connected Firebase/Worker check returned all 12 paid parts, rejected missing authentication and production access, and rejected two identical insufficient-funds requests without changing ownership or wallet. No test funds were inserted remotely. Successful spending is D1 fixture evidence, not a funded live purchase.
- Visual checks were blocked because the Mac was locked. Small-phone, larger-text, all-world and accessibility visual acceptance remain open. The studio uses safe-area insets, scrolling, static vector decoration and explicit selection/ownership labels, but these implementations do not substitute for visual inspection.
- The iPhone remains unavailable in CoreDevice. Installation, launch and physical checks remain open. Signed artifact details are recorded below after final source verification.

Local evidence logs are under `/private/tmp/pullthread-cosmetics-*`; these are development artifacts, not production game data.

Final native package: `/private/tmp/pullthread-cosmetics-native/20260908T002728Z/Pullthread.app`. All 104 packaged runtime files matched the workspace and staging; strict signature verification passed for team `V3ZSA5F97A` and bundle `com.xuefengzhu.pullthread`. Embedded Hermes bundle: 6,046,611 bytes. Installation was attempted and failed with CoreDevice error **1011** (device unavailable); the update has not been installed or launched on the phone. Final platform exports: `/private/tmp/pullthread-cosmetics-final-export`.

### Device delivery update — September 7, 2026, 18:50 Pacific

The same verified final artifact was successfully installed and launched on Frank iPhone17 (`com.xuefengzhu.pullthread`). CoreDevice reported the device paired, connected, and using **wired** transport during delivery. This confirms installation and launch, not wireless delivery, physical play, visual acceptance, or a funded live purchase.

### Web purchase update — September 11, 2026

Button Studio now permits cosmetic redemptions through the existing authenticated web runtime and Worker endpoints. The platform gate has regression coverage, and browser verification confirms that the funded sandbox collection loads through the web service.
