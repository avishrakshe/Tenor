import { NextResponse } from 'next/server';
import { liveQuotesEnabled, oneClickHeaders, ONECLICK_URL } from '@/lib/oneclick';

export async function POST(req: Request) {
  const body = await req.json();
  if (body.dry !== true && !liveQuotesEnabled()) {
    return NextResponse.json({ message: 'Live quotes are disabled. Set ONECLICK_ALLOW_LIVE=1 to enable them.' }, { status: 403 });
  }
  const r = await fetch(`${ONECLICK_URL}/v0/quote`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...oneClickHeaders() },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  return NextResponse.json(await r.json(), { status: r.status });
}
