# Earned tools and points shop

Implemented September 6, 2026. This keeps the fullscreen endless climb and its existing launch physics. Free tools work without Firebase or RevenueCat configuration.

## Play

- **Preview** draws the simulated next flight, including bounces, moving receivers and its first landing or failure. The dotted path stops at eight seconds; an ellipsis marks a continuing flight. Cancelling a pull or pausing keeps it armed until a launch.
- **Land** pauses the world and highlights unobstructed, fully visible pocket openings. Choosing a pocket lands immediately at its current position. Cancelling costs nothing; a paid landing asks for confirmation after selecting its destination. Skipping several pockets counts as one catch.
- **Revive** returns to the most recent caught pocket once per run. It restores the saved room, camera and moving-target clock while retaining collected tools and pickup history.
- Free charges are used first. Additional uses cost 10 / 25 / 50 points respectively. Buying points never activates a tool automatically. Free charges reset on a new run; verified points belong to the guest wallet.

The welcoming Preview is collected on the normal second shot. Later tools invite optional side hops. Completing and bypass input sequences, mirrors, and variation grids are documented in [PICKUP_VERIFICATION.md](PICKUP_VERIFICATION.md). Trajectory-search and verification helpers are outside the production import graph.

## Verification completed

- `npm run typecheck`, `npm run lint`, and `git diff --check` pass.
- `npm test -- --silent`: **40 suites, 491 tests pass**. This includes existing challenge grids, long seeded runs, fixed 30/60/120 FPS outcomes, pickups without physical trajectory changes, moving-target prediction, tool state, lifecycle, saved-run recovery, and rendered shop flows.
- Backend typecheck/build and 15 provider/domain unit tests pass. The complete 34-case Firestore emulator suite passed, followed by the added missing-quantity purchase regression. Checks cover exact transaction deduplication, concurrent debits, request binding, environment and user isolation, FIFO refunds, refund-before-purchase, once-per-run revive reservations, denied client writes, and purchase reconciliation without optimistic credit.
- iOS, Android and web Expo bundles exported successfully to `/private/tmp/pullthread-tools-export`.
- Browser checks at **320×568** and **390×844** covered the full playfield, drag/release, catches, free Preview collection/activation, pause, run-over/restart, unavailable checkout, and shop scrolling. A separate, explicitly labeled demo wallet completed Preview, Land and Revive: 100 → 90 → 65 → 15 points; landing scored once, and Revive became unavailable after use. No real store purchase was made. The temporary demo server/tab was closed afterward.
- Automated interaction tests additionally cover cancelled/pending purchases, localized prices, disclosure storage failures, double taps, selected-pocket cancellation, backgrounding with no intervening animation frame, and process interruption between debit and delivery.

Machine-local test logs: `/private/tmp/pullthread-tools-jest-final.log`, `/private/tmp/pullthread-tools-firebase-final.log`, and `/private/tmp/pullthread-commerce-quantity-emulator.log`.

## Store and device acceptance

Live checkout is disabled by default in source-controlled example configuration. The current connected web sandbox status is tracked in [IPHONE_SHOP_SETUP_STATUS.md](IPHONE_SHOP_SETUP_STATUS.md): the Worker and D1 are deployed, RevenueCat Billing is connected in Stripe Test mode, and the local browser opens sandbox checkout. No sandbox payment or App Store / Google Play product has been verified.

The signed **iOS Release build succeeded**, with RevenueCat's native dependency restored. Strict signature verification passed, and its production runtime hashes match the verified checkout. The installable app and verification record are at `/private/tmp/pullthread-tools-native-artifact/20260906T230103Z/Pullthread.app` and `verification.json` in that same directory. On September 6, 2026, the update was installed on Frank iPhone17 and launched successfully after unlocking; a subsequent device process check confirmed Pullthread remained running. Existing app data was preserved. Physical touch feel, sound/haptics, actual Apple sandbox checkout, and Google Play license-tester checkout remain unverified; no Android SDK or test device was available locally.

The browser interaction makes the tool states and recovery choices readable. The optional pickup detours add another aiming decision. These observations and simulation results do not establish purchase readiness or physical-device feel.
