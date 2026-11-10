import { NextResponse } from 'next/server';

// Kraken's public depth endpoint: light, no key, and it lists every market Tenor trades.
// https://docs.kraken.com/api/docs/rest-api/get-order-book
const PAIRS: Record<string, string> = { BTC: 'XBTUSD', ETH: 'ETHUSD', SOL: 'SOLUSD', NEAR: 'NEARUSD' };
const LEVELS = 14;

type Level = [string, string, number];

export async function GET(req: Request) {
  const symbol = new URL(req.url).searchParams.get('symbol') ?? 'BTC';
  const pair = PAIRS[symbol];
  if (!pair) return NextResponse.json({ message: 'Unknown symbol' }, { status: 400 });
  const r = await fetch(`https://api.kraken.com/0/public/Depth?pair=${pair}&count=${LEVELS}`, {
    headers: { 'user-agent': 'tenor' },
    next: { revalidate: 2 },
  });
  if (!r.ok) return NextResponse.json({ message: `Book: HTTP ${r.status}` }, { status: 502 });
  const body = (await r.json()) as { error: string[]; result?: Record<string, { asks: Level[]; bids: Level[] }> };
  const book = body.result ? Object.values(body.result)[0] : null;
  if (!book || body.error?.length) return NextResponse.json({ message: body.error?.join(', ') || 'Book unavailable' }, { status: 502 });
  const levels = (rows: Level[]) => rows.map(([p, s]) => [Number(p), Number(s)] as [number, number]);
  return NextResponse.json({ asks: levels(book.asks), bids: levels(book.bids) });
}
