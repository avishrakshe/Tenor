// Keeps the oracle fresh while someone has a trading screen open, so prices don't depend on a
// separate process staying alive. The signing key can only call `push_prices` on one oracle.
// Prices come from 1Click on the server; only the demo stack accepts a scripted BTC move.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextResponse } from 'next/server';
import { Account, JsonRpcProvider, actions, teraToGas, type KeyPairString } from 'near-api-js';
import { MARKETS } from '@tenor/rules';
import { view } from '@/lib/chain';
import { getRequestConfig, type AppConfig } from '@/lib/config';

const MIN_AGE_SECS = 15;
const MAX_MOVE = 1.2;
const MIN_MOVE = 0.8;

function signer(config: AppConfig): Account | null {
  const provider = new JsonRpcProvider({ url: config.rpc });
  if (config.network === 'sandbox') {
    const d = JSON.parse(readFileSync(join(process.cwd(), '..', '..', '.sandbox', 'deployer.json'), 'utf8'));
    return new Account(d.accountId, provider, d.secretKey as KeyPairString);
  }
  const accountId = process.env.KEEPER_ACCOUNT;
  const key = config.stackName === 'demo' ? process.env.KEEPER_KEY_DEMO : process.env.KEEPER_KEY_LIVE;
  return accountId && key ? new Account(accountId, provider, key as KeyPairString) : null;
}

async function marketPrices(): Promise<Record<string, number>> {
  const r = await fetch('https://1click.chaindefuser.com/v0/tokens', { cache: 'no-store' });
  if (!r.ok) throw new Error(`1Click tokens: HTTP ${r.status}`);
  const tokens: { symbol: string; blockchain: string; price: number }[] = await r.json();
  const out: Record<string, number> = {};
  for (const m of MARKETS) {
    const symbol = m.symbol === 'NEAR' ? 'wNEAR' : m.symbol;
    const t = tokens.find((x) => x.symbol === symbol && x.blockchain === m.symbol.toLowerCase());
    if (t && t.price > 0) out[m.symbol] = t.price;
  }
  return out;
}

export async function POST(req: Request) {
  const config = await getRequestConfig();
  if (!config.deployed) return NextResponse.json({ message: 'Not deployed' }, { status: 404 });
  const body: { btcMove?: number; force?: boolean } = await req.json().catch(() => ({}));
  const demo = config.stackName === 'demo';
  const now = Math.floor(Date.now() / 1000);

  const feed = MARKETS.find((m) => m.symbol === 'BTC')!.feedId;
  const last = await view<{ publish_time: number } | null>(config.rpc, config.stack.oracle, 'get_price_unsafe', { price_identifier: feed });
  const age = last ? now - last.publish_time : Number.POSITIVE_INFINITY;
  if (age < MIN_AGE_SECS && !(demo && body.force)) return NextResponse.json({ pushed: false, age });

  const account = signer(config);
  if (!account) return NextResponse.json({ message: 'The price keeper is not configured on this deployment.' }, { status: 503 });

  const prices = await marketPrices();
  const move = demo && Number.isFinite(body.btcMove) ? Math.min(MAX_MOVE, Math.max(MIN_MOVE, Number(body.btcMove))) : 1;
  if (prices.BTC) prices.BTC *= move;

  const updates = MARKETS.filter((m) => prices[m.symbol]).map((m) => {
    const price = BigInt(Math.round(prices[m.symbol] * 1e8));
    return { price_id: m.feedId, price: price.toString(), conf: ((price * 3n) / 10_000n).toString(), expo: -8, publish_time: now };
  });
  try {
    await account.signAndSendTransaction({
      receiverId: config.stack.oracle,
      actions: [actions.functionCall('push_prices', { updates }, teraToGas('50'), 0n)],
      waitUntil: 'EXECUTED_OPTIMISTIC',
    });
  } catch (e) {
    // Two open screens can race for the same nonce. The next tick covers it.
    return NextResponse.json({ pushed: false, message: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
  return NextResponse.json({ pushed: true, move });
}
