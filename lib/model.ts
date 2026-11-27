// Costed Lattice 3.0 — token launch radar model (round 4).
// Written fresh from ROUND4-SPEC-costed-lattice-3.0.md in this session.
// Reads ONLY the ten fields the sealed snapshot carries. Anything beyond them
// (gas prices, airdrop-pool share) is a labelled assumption, never snapshot data.

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

// ---------------------------------------------------------------------------
// Eligibility: pre-token and not a wrapped / staked / bridged product of a
// token that already trades. Same published rule as rounds 2-3.
// ---------------------------------------------------------------------------
const EXCLUDED_CATEGORIES = new Set([
  "Bridge",
  "Canonical Bridge",
  "Liquid Staking",
  "Liquid Restaking",
  "Restaked BTC",
  "CEX",
]);
const EXCHANGE_PREFIXES = [
  "Binance",
  "Coinbase",
  "Bybit",
  "Kraken",
  "Bitget",
  "OKX",
  "Bitfinex",
  "Gemini",
];
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

export function isPreToken(p: Protocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

export function isExcludedProduct(p: Protocol): boolean {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  for (const ex of EXCHANGE_PREFIXES) {
    if (p.name.startsWith(ex)) return true;
  }
  if (VERSION_SUFFIX.test(p.name)) return true;
  return false;
}

export function isBoardEligible(p: Protocol): boolean {
  return isPreToken(p) && !isExcludedProduct(p);
}

// ---------------------------------------------------------------------------
// Small numeric helpers (deterministic, no randomness anywhere).
// ---------------------------------------------------------------------------
export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function sigmoid(x: number): number {
  if (x > 35) return 1;
  if (x < -35) return 0;
  return 1 / (1 + Math.exp(-x));
}

export function ageDays(listedAt: string | null, asOf: string): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(asOf + "T00:00:00Z");
  const b = Date.parse(listedAt + "T00:00:00Z");
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.floor((a - b) / 86400000));
}

// Ranks with averaged ties, 1-based.
function ranks(values: number[]): number[] {
  const idx = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
  const out = new Array<number>(values.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && values[idx[j + 1]] === values[idx[i]]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[idx[k]] = avg;
    i = j + 1;
  }
  return out;
}

export function spearman(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 3) return null;
  const rx = ranks(xs);
  const ry = ranks(ys);
  const n = xs.length;
  const mx = rx.reduce((a, b) => a + b, 0) / n;
  const my = ry.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) * (rx[i] - mx);
    dy += (ry[i] - my) * (ry[i] - my);
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

// AUC of scores as a predictor of a binary label (Mann-Whitney).
export function auc(scores: number[], labels: boolean[]): number | null {
  const pos = scores.filter((_, i) => labels[i]);
  const neg = scores.filter((_, i) => !labels[i]);
  if (pos.length === 0 || neg.length === 0) return null;
  let wins = 0;
  let ties = 0;
  for (const p of pos) {
    for (const q of neg) {
      if (p > q) wins++;
      else if (p === q) ties++;
    }
  }
  return (wins + 0.5 * ties) / (pos.length * neg.length);
}

// ---------------------------------------------------------------------------
// Comps: median mcap/TVL per category over live-token peers, Bayesian
// shrinkage toward the global median (alpha = 3, needs >= 5 peers for the
// raw median to carry weight). Clamp [0.04, 1.25].
// ---------------------------------------------------------------------------
export interface CompsFit {
  globalMedian: number;
  byCategory: Map<string, { n: number; raw: number; adj: number }>;
}

export function fitComps(live: Protocol[]): CompsFit {
  const ratios = live
    .filter((p) => p.mcap_usd !== null && p.tvl_usd > 0)
    .map((p) => (p.mcap_usd as number) / p.tvl_usd);
  const globalMedian = median(ratios);
  const byCat = new Map<string, number[]>();
  for (const p of live) {
    if (p.mcap_usd === null || p.tvl_usd <= 0 || p.category === null) continue;
    const arr = byCat.get(p.category) ?? [];
    arr.push(p.mcap_usd / p.tvl_usd);
    byCat.set(p.category, arr);
  }
  const byCategory = new Map<string, { n: number; raw: number; adj: number }>();
  for (const [cat, arr] of byCat) {
    const raw = median(arr);
    const adj = clamp((arr.length * raw + 3 * globalMedian) / (arr.length + 3), 0.04, 1.25);
    byCategory.set(cat, { n: arr.length, raw, adj });
  }
  return { globalMedian, byCategory };
}

export function compsFor(p: Protocol, fit: CompsFit): number {
  if (p.category !== null) {
    const hit = fit.byCategory.get(p.category);
    if (hit && hit.n >= 5) return hit.adj;
    if (hit) return clamp((hit.n * hit.raw + 3 * fit.globalMedian) / (hit.n + 3), 0.04, 1.25);
  }
  return clamp(fit.globalMedian, 0.04, 1.25);
}

// ---------------------------------------------------------------------------
// Growth: diminishing returns after +80% (piecewise exponential), sharper
// penalty for large drops. change_7d is in percent; null is neutral.
// ---------------------------------------------------------------------------
export function growthFactor(change7d: number | null): number {
  if (change7d === null || Number.isNaN(change7d)) return 1;
  if (change7d >= 0) return 1 + 0.45 * (1 - Math.exp(-change7d / 80));
  return 1 / (1 + Math.abs(change7d) / 55);
}

// Maturity: 0.55 + 0.45 * (1 - exp(-age/180)); unknown age is 0.55.
export function maturityFactor(age: number | null): number {
  if (age === null) return 0.55;
  return 0.55 + 0.45 * (1 - Math.exp(-age / 180));
}

// Multi-chain breadth bonus from the chains LIST only (snapshot carries no
// per-chain TVL amounts, so no concentration ratio is invented).
export function chainSpread(chains: string[]): number {
  const n = Math.max(1, chains.length);
  return 0.85 + 0.15 * (1 - 1 / n);
}

// ---------------------------------------------------------------------------
// Launch probability: logistic regression fitted at runtime on the snapshot
// (label = token already trading, i.e. mcap present). Deterministic gradient
// descent, fixed seed-free iteration count. Features: log10 TVL (centred),
// capped age in years, core-DeFi category dummy.
// ---------------------------------------------------------------------------
const CORE_CATEGORIES = new Set([
  "Dexs",
  "Lending",
  "Yield",
  "Perpetuals",
  "RWA",
  "CDP",
  "Derivatives",
]);

export interface LaunchFit {
  beta: number[];
  aucTrain: number | null;
}

export function fitLaunch(all: Protocol[], asOf: string): LaunchFit {
  const rows = all.map((p) => {
    const age = ageDays(p.listed_at, asOf);
    return {
      x: [
        1,
        Math.log10(Math.max(1, p.tvl_usd)) - 7,
        Math.min(5, (age ?? 0) / 365),
        p.category !== null && CORE_CATEGORIES.has(p.category) ? 1 : 0,
      ],
      y: p.mcap_usd !== null ? 1 : 0,
    };
  });
  const beta = [0, 0, 0, 0];
  const lr = 0.5;
  const lambda = 0.01;
  for (let iter = 0; iter < 300; iter++) {
    const grad = [0, 0, 0, 0];
    for (const r of rows) {
      const z = r.x[0] * beta[0] + r.x[1] * beta[1] + r.x[2] * beta[2] + r.x[3] * beta[3];
      const err = sigmoid(z) - r.y;
      for (let k = 0; k < 4; k++) grad[k] += err * r.x[k];
    }
    for (let k = 0; k < 4; k++) {
      beta[k] -= (lr / rows.length) * (grad[k] + lambda * beta[k]);
    }
  }
  const scores = rows.map(
    (r) => sigmoid(r.x[0] * beta[0] + r.x[1] * beta[1] + r.x[2] * beta[2] + r.x[3] * beta[3]),
  );
  const aucTrain = auc(scores, rows.map((r) => r.y === 1));
  return { beta, aucTrain };
}

export function launchProb(p: Protocol, asOf: string, fit: LaunchFit): number {
  const age = ageDays(p.listed_at, asOf);
  const x = [
    1,
    Math.log10(Math.max(1, p.tvl_usd)) - 7,
    Math.min(5, (age ?? 0) / 365),
    p.category !== null && CORE_CATEGORIES.has(p.category) ? 1 : 0,
  ];
  const z = x[0] * fit.beta[0] + x[1] * fit.beta[1] + x[2] * fit.beta[2] + x[3] * fit.beta[3];
  return clamp(sigmoid(z), 0.02, 0.98);
}

// ---------------------------------------------------------------------------
// Farm capital + discount: capital scales with TVL^0.7; the discount is a
// mild capital-efficiency tilt in [0.90, 1.00], never a ranking crusher.
// ---------------------------------------------------------------------------
export function farmCapitalUsd(tvlUsd: number): number {
  return clamp(5000 * Math.pow(Math.max(1, tvlUsd) / 1e6, 0.7), 2000, 250000);
}

export function farmDiscount(capitalUsd: number): number {
  return 0.9 + 0.1 / (1 + capitalUsd / 50000);
}

// ---------------------------------------------------------------------------
// Gas costing. ASSUMPTIONS (labelled on the board + methodology): average
// gas price x native-token USD price, Nov-2026 levels, illustrative only.
// The snapshot carries NO gas data. usdPerGasUnit = gwei * 1e-9 * nativeUsd.
// ---------------------------------------------------------------------------
export interface ChainGas {
  usdPerGasUnit: number;
  note: string;
}

export const CHAIN_GAS: Record<string, ChainGas> = {
  Ethereum: { usdPerGasUnit: 15e-9 * 3200, note: "15 gwei @ $3,200/ETH (assumed)" },
  Arbitrum: { usdPerGasUnit: 0.1e-9 * 3200, note: "0.1 gwei @ $3,200/ETH (assumed)" },
  Optimism: { usdPerGasUnit: 0.1e-9 * 3200, note: "0.1 gwei @ $3,200/ETH (assumed)" },
  Base: { usdPerGasUnit: 0.05e-9 * 3200, note: "0.05 gwei @ $3,200/ETH (assumed)" },
  Solana: { usdPerGasUnit: 3.5e-9, note: "0.000005 SOL/tx @ $140/SOL (assumed)" },
  Binance: { usdPerGasUnit: 3e-9 * 600, note: "3 gwei @ $600/BNB (assumed)" },
  Avalanche: { usdPerGasUnit: 25e-9 * 15, note: "25 gwei @ $15/AVAX (assumed)" },
  Polygon: { usdPerGasUnit: 100e-9 * 0.2, note: "100 gwei @ $0.20/MATIC (assumed)" },
};
export const DEFAULT_CHAIN_GAS: ChainGas = {
  usdPerGasUnit: 3.33e-6,
  note: "$0.50 per standard tx (assumed fallback)",
};

export function chainGas(chain: string): ChainGas {
  return CHAIN_GAS[chain] ?? DEFAULT_CHAIN_GAS;
}

export function usd(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Farm steps. Six concrete steps per protocol, derived from its category and
// primary chain. Each step: text (20-600 chars), tx count, gas units, $ cost,
// minutes. Cost uses the assumption table above; time is a plain estimate.
// ---------------------------------------------------------------------------
export interface FarmStep {
  text: string;
  tx: number;
  gasUnits: number;
  costUsd: number;
  minutes: number;
}

function stepText(
  body: string,
  cost: number,
  minutes: number,
): { text: string; costUsd: number; minutes: number } {
  const suffix = ` (~$${cost.toFixed(2)} gas, ~${minutes} min)`;
  return { text: body + suffix, costUsd: cost, minutes };
}

const CATEGORY_VERB: Record<string, { act: string; act2: string }> = {
  Lending: {
    act: "supply USDC to the lending market and keep the health factor above 2",
    act2: "borrow up to 40% of the supplied value against it and loop once",
  },
  Dexs: {
    act: "swap half the bridged USDC into the pool's paired asset",
    act2: "add both sides as liquidity in the tightest active fee tier",
  },
  Yield: {
    act: "deposit into the highest-TVL vault and enable auto-compound",
    act2: "stake the vault receipt token if a staking module is live",
  },
  Perpetuals: {
    act: "open a small hedged long with 2x leverage and a stop 8% below entry",
    act2: "provide liquidity to the perp pool's insurance vault",
  },
  "Risk Curators": {
    act: "deposit into the curator vault with the longest track record",
    act2: "allocate a second tranche to a different curator for diversification",
  },
  RWA: {
    act: "complete the protocol's eligibility check and deposit into the RWA vault",
    act2: "hold the position through one full distribution cycle",
  },
};

export function farmSteps(p: Protocol): FarmStep[] {
  const chain = p.chains.length > 0 ? p.chains[0] : "Ethereum";
  const gas = chainGas(chain);
  const verb = CATEGORY_VERB[p.category ?? ""] ?? {
    act: "use its core product with a real position, not a dust transaction",
    act2: "add a second position in a different pool or market it runs",
  };
  const mk = (
    body: string,
    tx: number,
    gasUnits: number,
    minutes: number,
  ): FarmStep => {
    const cost = usd(tx * gasUnits * gas.usdPerGasUnit);
    const s = stepText(body, cost, minutes);
    return { text: s.text, tx, gasUnits, costUsd: s.costUsd, minutes: s.minutes };
  };
  return [
    mk(
      `Bridge $500 of USDC to ${chain} for ${p.name} and keep $20 of the native gas token aside for fees.`,
      1, 260000, 15,
    ),
    mk(
      `On ${p.name}, ${verb.act}. Use a real size, not dust, so the position is visible on-chain.`,
      1, 150000, 10,
    ),
    mk(
      `On ${p.name}, ${verb.act2}. Confirm the position shows in the protocol dashboard before continuing.`,
      2, 200000, 10,
    ),
    mk(
      `Repeat the core interaction once a week for four weeks, varying the size slightly each time.`,
      4, 150000, 10,
    ),
    mk(
      `Check the ${p.name} dashboard weekly: confirm points, eligibility or position history are recording.`,
      0, 0, 5,
    ),
    mk(
      `If a token launches, claim through the official claim page only, then unwind half the position over two days.`,
      1, 100000, 10,
    ),
  ];
}

// Net expected value of farming one row (labelled assumptions):
// airdrop pool = 5% of implied value; the farmer's share = farmCapital / TVL;
// expected value = p_launch * pool * share - gas cost.
export function netExpectedValue(
  impliedUsd: number,
  pLaunch: number,
  capitalUsd: number,
  tvlUsd: number,
  costUsd: number,
): number {
  const pool = 0.05 * impliedUsd;
  const share = capitalUsd / Math.max(1, tvlUsd);
  return usd(pLaunch * pool * share - costUsd);
}

// ---------------------------------------------------------------------------
// Full scoring of one protocol.
// ---------------------------------------------------------------------------
export interface Scored {
  protocol: Protocol;
  age: number | null;
  comps: number;
  growth: number;
  maturity: number;
  pLaunch: number;
  spread: number;
  discount: number;
  capitalUsd: number;
  impliedRaw: number;
  implied: number;
  steps: FarmStep[];
  costUsd: number;
  netEvUsd: number;
  roi: number;
}

export function scoreProtocol(
  p: Protocol,
  asOf: string,
  comps: CompsFit,
  launch: LaunchFit,
): Scored {
  const age = ageDays(p.listed_at, asOf);
  const c = compsFor(p, comps);
  const g = growthFactor(p.change_7d);
  const m = maturityFactor(age);
  const pl = launchProb(p, asOf, launch);
  const sp = chainSpread(p.chains);
  const capital = farmCapitalUsd(p.tvl_usd);
  const d = farmDiscount(capital);
  const raw = p.tvl_usd * c * g * m * pl * sp * d;
  const implied = Math.max(1, Math.round(raw));
  const steps = farmSteps(p);
  const cost = usd(steps.reduce((a, s) => a + s.costUsd, 0));
  const netEv = netExpectedValue(implied, pl, capital, p.tvl_usd, cost);
  const roi = usd(netEv / Math.max(cost, 0.01));
  return {
    protocol: p,
    age,
    comps: c,
    growth: g,
    maturity: m,
    pLaunch: pl,
    spread: sp,
    discount: d,
    capitalUsd: usd(capital),
    impliedRaw: raw,
    implied,
    steps,
    costUsd: cost,
    netEvUsd: netEv,
    roi,
  };
}

// ---------------------------------------------------------------------------
// Honest validation, computed from the sealed snapshot only. Nothing here is
// hardcoded: every number is recomputed on each run and shown as-is.
// ---------------------------------------------------------------------------
export interface Validation {
  spearmanAll: number | null;
  spearmanN: number;
  cvFolds: (number | null)[];
  cvMean: number | null;
  walkForward: {
    cutoff: string;
    trainN: number;
    valN: number;
    excludedNoDate: number;
    trainSpearman: number | null;
    valSpearman: number | null;
  };
  launchAuc: number | null;
  launchAucTrain: number | null;
  verdict: string;
}

export function validate(
  all: Protocol[],
  asOf: string,
  comps: CompsFit,
  launch: LaunchFit,
): Validation {
  const live = all.filter((p) => p.mcap_usd !== null && p.tvl_usd > 0);
  const scoredLive = live.map((p) => scoreProtocol(p, asOf, comps, launch));
  const spearmanAll = spearman(
    scoredLive.map((s) => s.implied),
    live.map((p) => p.mcap_usd as number),
  );

  // 5-fold CV: comps refit on the other folds only, per fold.
  const sorted = [...live].sort((a, b) => (a.slug < b.slug ? -1 : 1));
  const cvFolds: (number | null)[] = [];
  for (let fold = 0; fold < 5; fold++) {
    const held = sorted.filter((_, i) => i % 5 === fold);
    const rest = sorted.filter((_, i) => i % 5 !== fold);
    const foldComps = fitComps(rest);
    const scored = held.map((p) => scoreProtocol(p, asOf, foldComps, launch));
    cvFolds.push(
      spearman(
        scored.map((s) => s.implied),
        held.map((p) => p.mcap_usd as number),
      ),
    );
  }
  const cvNums = cvFolds.filter((v): v is number => v !== null);
  const cvMean =
    cvNums.length > 0
      ? cvNums.reduce((a, b) => a + b, 0) / cvNums.length
      : null;

  // Walk-forward / time-split at 2024-01-01: comps fitted on the train cohort
  // only, then Spearman on train and on the later-listed validation cohort.
  const cutoff = "2024-01-01";
  const train = live.filter((p) => p.listed_at !== null && p.listed_at < cutoff);
  const val = live.filter((p) => p.listed_at !== null && p.listed_at >= cutoff);
  const excludedNoDate = live.filter((p) => p.listed_at === null).length;
  const trainComps = fitComps(train);
  const trainSpearman = spearman(
    train.map((p) => scoreProtocol(p, asOf, trainComps, launch).implied),
    train.map((p) => p.mcap_usd as number),
  );
  const valSpearman = spearman(
    val.map((p) => scoreProtocol(p, asOf, trainComps, launch).implied),
    val.map((p) => p.mcap_usd as number),
  );

  // Launch AUC: implied value as predictor of "token already trades".
  const scoredAll = all.map((p) => scoreProtocol(p, asOf, comps, launch));
  const launchAuc = auc(
    scoredAll.map((s) => s.implied),
    all.map((p) => p.mcap_usd !== null),
  );

  const v =
    valSpearman === null
      ? "Walk-forward validation unavailable (no dated validation cohort)."
      : valSpearman >= 0.4
        ? `Out-of-sample (listed >= ${cutoff}) Spearman ${valSpearman.toFixed(3)}: the model generalises to later listings.`
        : `Out-of-sample (listed >= ${cutoff}) Spearman ${valSpearman.toFixed(3)}: weak — the fit does not generalise cleanly to later listings, and the board is a ranking claim, not a forecast.`;
  return {
    spearmanAll,
    spearmanN: live.length,
    cvFolds,
    cvMean,
    walkForward: {
      cutoff,
      trainN: train.length,
      valN: val.length,
      excludedNoDate,
      trainSpearman,
      valSpearman,
    },
    launchAuc,
    launchAucTrain: launch.aucTrain,
    verdict: v,
  };
}
