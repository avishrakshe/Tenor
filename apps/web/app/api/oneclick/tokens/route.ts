import { NextResponse } from 'next/server';
import { oneClickHeaders, ONECLICK_URL } from '@/lib/oneclick';

const SYMBOLS = new Set(['USDC', 'USDT', 'ETH', 'BTC', 'SOL', 'wNEAR']);

export async function GET() {
  const r = await fetch(`${ONECLICK_URL}/v0/tokens`, { headers: oneClickHeaders(), next: { revalidate: 300 } });
  if (!r.ok) return NextResponse.json({ message: `1Click tokens: HTTP ${r.status}` }, { status: 502 });
  const tokens = (await r.json()) as { symbol: string; blockchain: string; assetId: string; decimals: number }[];
  const out = tokens
    .filter((t) => SYMBOLS.has(t.symbol))
    .map(({ symbol, blockchain, assetId, decimals }) => ({ symbol, blockchain, assetId, decimals }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol) || a.blockchain.localeCompare(b.blockchain));
  return NextResponse.json(out);
}
