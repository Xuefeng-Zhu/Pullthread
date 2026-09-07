# Free pickup reference inputs

These are development/test witnesses, not inputs used by the live generator. All values are raw finger pulls in the fixed 360-wide world; the normal input clamp, 120 Hz simulation, camera, and swept contacts still apply. Wait until the held pocket settles before a side hop (the fixtures allow 120 ticks). The same collider geometry remains visible throughout the detour.

The first preview pickup is at `(250, -50)` relative to the second opening's source. Pull `(-5, 77)` from `(240, 0)` to collect it and catch the generous next pocket. All 121 integer variations within ±5 on both axes pass.

Later charges sit 40 pixels outward and 15 pixels above a static pocket, radius 14. A short pull `(8, 42)` from a left pocket, or `(-8, 42)` from a right pocket, collects the charge and returns to that pocket. This optional extra launch uses no points and changes no collider geometry. Banks offer the charge beside their entry pocket; arc-low and recovery flights offer it beside their exit pocket.

For banks, take the side hop **before** the completing shot. Canonical bank-return uses `(-30, 112)`; bank-rise uses `(-28, 112)`. Their reflected versions negate horizontal pull. These normal bank shots bypass the charge and still bounce; the optional two-launch route collects it.

For the following flights, the listed completing shot bypasses the charge. Take the short side hop **after** arriving to collect it. Rightward patterns have receiver x260; reflection maps entry x to `360 − x` and negates pull x.

| Pattern | Pull y | Pull x from entry100 | Pull x from entry180 | Pull x from entry260 |
| --- | ---: | ---: | ---: | ---: |
| Intro recovery | 76 | -18.0974301723 | -7.4518830121 | 3.1936641481 |
| Intro arc-low | 72 | -19.8799291663 | -8.1858531861 | 3.5082227940 |
| Mixed recovery | 76 | -19.5691864057 | -8.3867941739 | 2.7955980580 |
| Expert recovery | 78.5 | -18.8748279433 | -8.1657057060 | 2.5434165314 |

`src/game/launch/testing/pickupPatternHelpers.ts` supplies the exact completing pull for every entry position. `pickupPatterns.test.ts` verifies every integer ±3 pull combination, both reflections, and source positions from 100 through 260 in four-pixel steps. Both bypass and optional collecting routes complete; the side hop grants one charge and no additional pocket score. A separate seeded-run regression retains neighboring geometry for all detours through the first 20 pockets of 16 seeds.

These are simulation results. They do not replace physical-device touch, sound, haptic, or store-purchase validation.
