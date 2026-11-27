# token-radar-01-round4

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/MBOLANG30/token-radar-01-round4/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/MBOLANG30/token-radar-01-round4/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Costed Lattice 3.0 — the best token launch radar: every pre-token protocol in the sealed snapshot, ranked by what its launch would be worth, with each farm plan costed to the dollar.

## What it does

- Reads the sealed DefiLlama snapshot (`snapshot.json`, as of 2026-11-14, 758 protocols) and ranks all 198 board-eligible pre-token protocols — 40 watchlist + 158 below the floor — by an implied launch value: TVL × category comps (Bayesian-shrunk median mcap/TVL) × growth × maturity × launch probability × chain spread × farm discount.
- Costs every row's 6-step farm plan: gas per step from an assumed average gas-price table (labelled as an assumption — the snapshot carries no gas data), plus a net expected value and ROI per row, and a KPI strip over the whole board.
- Validates honestly, computed from the snapshot only: Spearman vs live-token market caps, 5-fold CV, a walk-forward time-split (listed before vs after 2024-01-01), and launch AUC — shown as-is, good or bad.
- Coverage is accounted for on the board: 198 of 198 eligible pre-token protocols, from 342 pre-token in the snapshot (144 excluded by the published wrapped/staked/bridged rule).

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Node 22.18+ runs the TypeScript as-is. The run writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` into the output directory. Two runs on the same snapshot produce byte-identical outputs.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)</sub>
