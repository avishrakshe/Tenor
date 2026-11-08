import { checkCounterparty, NETWORKS } from '@tenor/counterparty';
import { NextResponse } from 'next/server';
import { getConfig } from '@/lib/config';

const ACCOUNT = /^[a-z0-9._-]{2,64}$/;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const receiver = (searchParams.get('receiver') ?? '').trim().toLowerCase();
  const actor = searchParams.get('actor') ?? undefined;
  if (!ACCOUNT.test(receiver)) return NextResponse.json({ message: 'Enter a valid NEAR account' }, { status: 400 });
  if (actor && !ACCOUNT.test(actor)) return NextResponse.json({ message: 'Invalid actor' }, { status: 400 });
  const config = getConfig();
  const result = await checkCounterparty(NETWORKS[config.network], {
    blocklist: config.blocklist || undefined,
    actor,
    receiver,
    trusted: actor ? [actor] : [],
  });
  return NextResponse.json(result);
}
