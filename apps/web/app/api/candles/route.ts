// Public market candles for the charts, from Coinbase Exchange (no key needed).
// https://docs.cdp.coinbase.com/exchange/reference/exchangerestapi_getproductcandles
import { NextResponse } from 'next/server';

const GRANULARITY: Record<string, number> = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '6h': 21600, '1d': 86400 };
const SYMBOLS = new Set(['BTC', 'ETH', 'SOL', 'NEAR']);

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get('symbol') ?? 'BTC';
  const interval = searchParams.get('interval') ?? '5m';
  const granularity = GRANULARITY[interval];
  if (!SYMBOLS.has(symbol) || !granularity) return NextResponse.json({ message: 'Unknown symbol or interval' }, { status: 400 });
  const r = await fetch(`https://api.exchange.coinbase.com/products/${symbol}-USD/candles?granularity=${granularity}`, {
    headers: { 'user-agent': 'tenor' },
    next: { revalidate: 5 },
  });
  if (!r.ok) return NextResponse.json({ message: `Candles: HTTP ${r.status}` }, { status: 502 });
  const rows = (await r.json()) as number[][];
  const candles = rows
    .map(([time, low, high, open, close, volume]) => ({ time, open, high, low, close, volume }))
    .sort((a, b) => a.time - b.time);
  return NextResponse.json(candles);
}
