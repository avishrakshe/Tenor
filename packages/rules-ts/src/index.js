// BigInt port of crates/tenor-rules for UI previews. test-vectors/rules.json runs against both
// this file and the Rust crate, so they can't drift. The contract remains the only judge.

export const BPS = 10_000n;
export const USDC_UNIT = 1_000_000n;
export const TAKER_FEE_BPS = 5n;
const GAP_BUFFER_BPS = 12_500n;
const RESERVE_COVERAGE_BPS = 12_000n;

const floorDiv = (a, b, d) => (a * b) / d;
const ceilDiv = (a, b, d) => (a * b + d - 1n) / d;
const pow10 = (n) => 10n ** BigInt(n);
const sub0 = (a, b) => (a > b ? a - b : 0n);

export const MARKETS = [
  { symbol: 'BTC', decimals: 8, capBps: 10_000n, feedId: 'e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43' },
  { symbol: 'ETH', decimals: 18, capBps: 10_000n, feedId: 'ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace' },
  { symbol: 'SOL', decimals: 9, capBps: 5_000n, feedId: 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d' },
  { symbol: 'NEAR', decimals: 24, capBps: 5_000n, feedId: 'c415de8d2eba7db216527dff4b60e8f3a5311c740dadb233e13e12547e226750' },
];

export const market = (symbol) => {
  const m = MARKETS.find((x) => x.symbol === symbol);
  if (!m) throw new Error(`Unknown market ${symbol}`);
  return m;
};

const PLANS = {
  classic: { target: 1000n, dd: 600n },
  turbo: { target: 900n, dd: 300n },
  pro: { target: 1200n, dd: 500n },
};

export function ruleset(plan, twoStep) {
  const p = PLANS[plan];
  if (!p) throw new Error(`Unknown plan ${plan}`);
  return {
    phaseOneTargetBps: twoStep ? 800n : p.target,
    phaseTwoTargetBps: twoStep ? 500n : null,
    maxDrawdownBps: p.dd,
    dailyLossBps: 300n,
  };
}

export function parseProduct(id) {
  if (id === 'demo') return { plan: 'classic', twoStep: false, sizeUsdc: 10_000n, demo: true };
  const [plan, steps, size] = id.split('-');
  return { plan, twoStep: steps === '2', sizeUsdc: BigInt(size), demo: false };
}

function objective(used, limit) {
  const capped = used < limit ? used : limit;
  return {
    progressBps: limit === 0n ? 0n : floorDiv(capped, BPS, limit),
    remaining: limit - capped,
    limit,
  };
}

/** snapshot: { phase: 'one'|'two'|'funded', initial, dayStart, equity } */
export function evaluate(s, r) {
  const profit = sub0(s.equity, s.initial);
  const dailyLoss = sub0(s.dayStart, s.equity);
  const drawdown = sub0(s.initial, s.equity);
  const dailyLimit = floorDiv(s.initial, r.dailyLossBps, BPS);
  const ddLimit = floorDiv(s.initial, r.maxDrawdownBps, BPS);
  const targetBps = s.phase === 'one' ? r.phaseOneTargetBps : s.phase === 'two' ? r.phaseTwoTargetBps : null;
  const targetLimit = targetBps === null ? null : floorDiv(s.initial, targetBps, BPS);

  let status = 'active';
  let reason = null;
  if (dailyLoss >= dailyLimit) {
    status = 'breached';
    reason = 'daily_loss';
  } else if (drawdown >= ddLimit) {
    status = 'breached';
    reason = 'max_drawdown';
  } else if (targetLimit !== null && profit >= targetLimit) {
    status = s.phase === 'one' && r.phaseTwoTargetBps !== null ? 'advance' : 'passed';
  }
  return {
    status,
    reason,
    profit,
    dailyLoss,
    drawdown,
    target: targetLimit === null ? null : objective(profit, targetLimit),
    daily: objective(dailyLoss, dailyLimit),
    maxDrawdown: objective(drawdown, ddLimit),
  };
}

export function challengeFee(sizeUsdc, maxDrawdownBps, passRateBps) {
  const denominator = BPS ** 4n;
  const numerator = sizeUsdc * maxDrawdownBps * passRateBps * GAP_BUFFER_BPS * RESERVE_COVERAGE_BPS;
  return ((numerator + denominator - 1n) / denominator) * USDC_UNIT;
}

export function normalize(price, conf, expo) {
  const p = BigInt(price);
  const c = BigInt(conf);
  if (p <= 0n) throw new Error('Invalid price');
  const shift = expo + 8;
  if (shift >= 0) return { priceE8: p * pow10(shift), confE8: c * pow10(shift) };
  const factor = pow10(-shift);
  return { priceE8: p / factor, confE8: (c + factor - 1n) / factor };
}

export const ask = (q) => q.priceE8 + q.confE8;
export const bid = (q) => sub0(q.priceE8, q.confE8);
export const notional = (qty, priceE8, decimals) => floorDiv(qty, priceE8, pow10(decimals + 2));
export const qtyForNotional = (usdc, priceE8, decimals) => floorDiv(usdc, pow10(decimals + 2), priceE8);
export const takerFee = (usdc) => ceilDiv(usdc, TAKER_FEE_BPS, BPS);
export const markValue = (qty, q, decimals) => notional(qty, bid(q), decimals);

export function fillBuy(usdc, q, decimals) {
  const fee = takerFee(usdc);
  return { out: qtyForNotional(usdc - fee, ask(q), decimals), fee };
}

export function fillSell(qty, q, decimals) {
  const gross = notional(qty, bid(q), decimals);
  const fee = takerFee(gross);
  return { out: sub0(gross, fee), fee };
}

export const notionalCap = (equity, symbol) => floorDiv(equity, market(symbol).capBps, BPS);

export function reserveCovers(reserve, live, added) {
  return reserve >= ceilDiv(live + added, RESERVE_COVERAGE_BPS, BPS);
}
