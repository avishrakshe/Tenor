import { NextResponse } from 'next/server';

const SYMBOLS = new Set(['BTC', 'ETH', 'SOL', 'NEAR']);

export async function GET(req: Request) {
  const symbol = new URL(req.url).searchParams.get('symbol') ?? 'BTC';
  if (!SYMBOLS.has(symbol)) return NextResponse.json({ message: 'Unknown symbol' }, { status: 400 });
  const r = await fetch(`https://api.exchange.coinbase.com/products/${symbol}-USD/stats`, {
    headers: { 'user-agent': 'tenor' },
    next: { revalidate: 10 },
  });
  if (!r.ok) return NextResponse.json({ message: `Stats: HTTP ${r.status}` }, { status: 502 });
  const s = await r.json();
  const last = Number(s.last);
  const open = Number(s.open);
  return NextResponse.json({ last, open, high: Number(s.high), low: Number(s.low), volumeUsd: Number(s.volume) * last, changePct: ((last - open) / open) * 100 });
}
