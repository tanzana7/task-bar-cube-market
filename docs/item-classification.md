# Item classification and recommendations

## Classification contract

Classification is derived from the Steam `marketHashName`; it does not alter market observations, price history, or product identity.

- Type is a whole-word match against the ten supported equipment labels. `Chestplate` is checked independently from `Chest`, and `Chest Lv.N` is a Chest.
- Quality is recognized only as a trailing integer percentage from 5% through 95% in 5-point steps. A level such as `Chest Lv.1` is not a quality.
- Grade is recognized only when one of the seven supported grade names is an explicit leading token. Material/prefix words such as Rusty, Cobalt, Arcane, and Celestial are not mapped to Grade without an authoritative mapping. The Steam store page confirms the game has seven rarities from Common to Divine, but does not map individual market names or prefixes to a rarity. See [grade and refresh operations](grade-and-refresh-operations.md).
- Missing classification stays unknown. Minimum Grade and minimum Quality filters intentionally exclude unknown values when those thresholds are active.

## Saved observation check

The 131 products in `public/market-observations.json` were classified from the saved 2026-10-25 observations. The retained raw queryAction page at `.market/source-preview/capture/response.json` has `asset_description` keys `appid`, `market_hash_name`, `name`, and `icon_url`; it has no tags or description text. The 131-product stored queryAction observation likewise retains only product identity, icon, and market observations, so Grade cannot be recovered from these files:

| Attribute | Classified | Unknown |
| --- | ---: | ---: |
| Grade | 0 / 131 | 131 |
| Type | 131 / 131 | 0 |
| Quality | 126 / 131 | 5 |

All five unknown Quality values are the `Chest Lv.1` through `Chest Lv.5` products. The market names do not contain explicit Grade tokens, and the stored queryAction products omit asset tags/descriptions that could establish Grade. Since all 131 current products have unknown Grade, the Grade filters and recommendation threshold are disabled with an explicit “Grade情報未取得” status. They automatically become available when at least one verifiable Grade appears in a later item set.

## Recommendations

Recommendations match one Type, then apply optional minimum Grade, minimum Quality, and a same-currency budget. Currency-specific comparison values are used only if the value currency matches the selected currency. Reference prices remain reference-only and are not copied into canonical price history.

- Price priority orders by comparable price ascending; unknown prices come last.
- Quality priority orders by Quality descending, then comparable price ascending.
- Balance priority is within the chosen Type, using original weights of Grade 45, Quality 35, and affordability 20. Affordability is scaled against known prices among current candidates. Missing attributes are excluded and each candidate’s remaining weights are normalized to 100%; the UI shows the actual weights used for each result. A stale-observation label appears on results older than 24 hours. The score is only an ordering aid and does not estimate combat power.

Product comparison requires two to four products of the same Type. It shows the saved reference price, listings, available classification, and each product's actual observation time. The saved market snapshot is historical and does not imply a live quote.
