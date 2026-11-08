export interface Objective { progressBps: bigint; remaining: bigint; limit: bigint }
export interface Quote { priceE8: bigint; confE8: bigint }
export interface Ruleset {
  phaseOneTargetBps: bigint;
  phaseTwoTargetBps: bigint | null;
  maxDrawdownBps: bigint;
  dailyLossBps: bigint;
}
export interface Evaluation {
  status: 'active' | 'passed' | 'advance' | 'breached';
  reason: 'daily_loss' | 'max_drawdown' | null;
  profit: bigint;
  dailyLoss: bigint;
  drawdown: bigint;
  target: Objective | null;
  daily: Objective;
  maxDrawdown: Objective;
}
export interface MarketInfo { symbol: string; decimals: number; capBps: bigint; feedId: string }
export const BPS: bigint;
export const USDC_UNIT: bigint;
export const MARKETS: MarketInfo[];
export function market(symbol: string): MarketInfo;
export function ruleset(plan: string, twoStep: boolean): Ruleset;
export function parseProduct(id: string): { plan: string; twoStep: boolean; sizeUsdc: bigint; demo: boolean };
export function evaluate(
  s: { phase: 'one' | 'two' | 'funded'; initial: bigint; dayStart: bigint; equity: bigint },
  r: Ruleset,
): Evaluation;
export function challengeFee(sizeUsdc: bigint, maxDrawdownBps: bigint, passRateBps: bigint): bigint;
export function normalize(price: string | number | bigint, conf: string | number | bigint, expo: number): Quote;
export function ask(q: Quote): bigint;
export function bid(q: Quote): bigint;
export function notional(qty: bigint, priceE8: bigint, decimals: number): bigint;
export function qtyForNotional(usdc: bigint, priceE8: bigint, decimals: number): bigint;
export function takerFee(usdc: bigint): bigint;
export function markValue(qty: bigint, q: Quote, decimals: number): bigint;
export function fillBuy(usdc: bigint, q: Quote, decimals: number): { out: bigint; fee: bigint };
export function fillSell(qty: bigint, q: Quote, decimals: number): { out: bigint; fee: bigint };
export function notionalCap(equity: bigint, symbol: string): bigint;
export function reserveCovers(reserve: bigint, live: bigint, added: bigint): boolean;
