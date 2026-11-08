// Read-only chain access. Every number in the UI comes from these calls.
import { MARKETS, normalize, type Quote } from '@tenor/rules';

async function rpc(url: string, params: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: '1', method: 'query', params }),
    cache: 'no-store',
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.cause?.name ?? json.error.message);
  if (json.result.error) throw new Error(json.result.error);
  return json.result;
}

export async function view<T>(url: string, accountId: string, method: string, args: object = {}): Promise<T> {
  const bytes = new TextEncoder().encode(JSON.stringify(args));
  const args_base64 = btoa(String.fromCharCode(...bytes));
  const result = await rpc(url, {
    request_type: 'call_function',
    finality: 'final',
    account_id: accountId,
    method_name: method,
    args_base64,
  });
  return JSON.parse(new TextDecoder().decode(new Uint8Array(result.result)));
}

export type AccessKey = { public_key: string; access_key: { permission: unknown } };

export async function accessKeys(url: string, accountId: string): Promise<AccessKey[]> {
  const result = await rpc(url, { request_type: 'view_access_key_list', finality: 'final', account_id: accountId });
  return result.keys;
}

type OraclePrice = { price: string; conf: string; expo: number; publish_time: number } | null;

export type LiveQuote = Quote & { publishTime: number; fresh: boolean };

/** Reads the book of prices without the staleness filter, and marks stale ones. */
export async function readQuotes(url: string, oracle: string): Promise<Record<string, LiveQuote>> {
  const ids = MARKETS.map((m) => m.feedId);
  const prices = await view<Record<string, OraclePrice>>(url, oracle, 'list_prices_unsafe', { price_ids: ids });
  const now = Date.now() / 1000;
  const out: Record<string, LiveQuote> = {};
  for (const m of MARKETS) {
    const p = prices[m.feedId];
    if (p) {
      out[m.symbol] = {
        ...normalize(p.price, p.conf, p.expo),
        publishTime: p.publish_time,
        fresh: now - p.publish_time <= 60,
      };
    }
  }
  return out;
}

export type Position = { symbol: string; qty: string; cost: string; tp_e8: string | null; sl_e8: string | null };

export type Challenge = {
  id: number;
  owner: string;
  product: string;
  phase: number;
  status: 'Active' | 'Passed' | 'Breached' | 'Funding' | 'Funded';
  breach_reason: string | null;
  initial_balance: string;
  cash: string;
  positions: Position[];
  day_key: number;
  day_start_equity: string;
  last_equity: string;
  fee_paid: string;
  guard: string | null;
};

export type GuardState = {
  status: 'Pending' | 'Active' | 'Closing' | 'Breached' | 'Settled';
  breach_reason: string | null;
  trader: string;
  trader_public_key: string;
  venue: string;
  venue_kind: string;
  oracle: string;
  initial_balance: string;
  cash: string;
  positions: Position[];
  day_key: number;
  day_start_equity: string;
  max_drawdown_bps: number;
  daily_loss_bps: number;
  locked: boolean;
  paid_to_trader: string;
  paid_to_firm: string;
  approved_recipients: string[];
};

export type ReserveState = {
  reserve: string;
  vault: string;
  live_max_loss: string;
  capital_deployed: string;
  coverage_bps: string | null;
  required_coverage_bps: string;
};

export type Funded = {
  guard: string;
  challenge_id: number;
  trader: string;
  capital: string;
  max_loss: string;
  created_at: number;
  settled: boolean;
  returned: string;
};

export type Breach = {
  account: string;
  funded: boolean;
  reason: string;
  equity: string;
  timestamp: number;
  block_height: number;
};

export type CatalogEntry = {
  product: string;
  plan: string;
  two_step: boolean;
  size_usdc: string;
  fee: string;
  max_loss: string;
  target_bps: number;
  phase_two_target_bps: number | null;
  max_drawdown_bps: number;
  daily_loss_bps: number;
};

export const usd = (micro: string | bigint, digits = 2) =>
  (Number(BigInt(micro)) / 1e6).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

export const priceUsd = (e8: bigint) =>
  (Number(e8) / 1e8).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 });
