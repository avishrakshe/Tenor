import { NextResponse } from 'next/server';
import { oneClickHeaders, ONECLICK_URL } from '@/lib/oneclick';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const depositAddress = searchParams.get('depositAddress');
  if (!depositAddress) return NextResponse.json({ message: 'depositAddress is required' }, { status: 400 });
  const query = new URLSearchParams({ depositAddress });
  const memo = searchParams.get('depositMemo');
  if (memo) query.set('depositMemo', memo);
  const r = await fetch(`${ONECLICK_URL}/v0/status?${query}`, { headers: oneClickHeaders(), cache: 'no-store' });
  return NextResponse.json(await r.json(), { status: r.status });
}
