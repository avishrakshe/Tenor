// Recent trading transactions for one account, from the FastNear Transactions API.
import { NETWORKS } from '@tenor/counterparty';
import { NextResponse } from 'next/server';
import { getConfig } from '@/lib/config';

const ACCOUNT = /^[a-z0-9._-]{2,64}$/;
const METHODS = new Set(['place_order', 'close_position', 'request_payout', 'fund']);
const PAGE = 20;

type Summary = { transaction_hash: string; tx_block_timestamp: string; is_success: boolean };
type RawTx = { transaction: { hash?: string; receiver_id: string; actions: { FunctionCall?: { method_name: string; args: string } }[] }; execution_outcome?: { id?: string } };

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const account = searchParams.get('account') ?? '';
  const receiver = searchParams.get('receiver') ?? '';
  if (!ACCOUNT.test(account) || !ACCOUNT.test(receiver)) return NextResponse.json({ message: 'Invalid account' }, { status: 400 });
  const { txApi } = NETWORKS[getConfig().network];
  if (!txApi) return NextResponse.json({ unavailable: true, rows: [] });

  const post = (path: string, body: object) =>
    fetch(`${txApi}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), next: { revalidate: 10 } });

  const listed = await post('account', { account_id: account, is_signer: true, limit: PAGE });
  if (!listed.ok) return NextResponse.json({ message: `History: HTTP ${listed.status}` }, { status: 502 });
  const { account_txs: txs } = (await listed.json()) as { account_txs: Summary[] };
  if (txs.length === 0) return NextResponse.json({ rows: [] });

  const details = await post('transactions', { tx_hashes: txs.map((t) => t.transaction_hash) });
  if (!details.ok) return NextResponse.json({ message: `History: HTTP ${details.status}` }, { status: 502 });
  const { transactions } = (await details.json()) as { transactions: RawTx[] };

  const rows = transactions.flatMap((raw, i) => {
    const call = raw.transaction.actions[0]?.FunctionCall;
    if (!call || raw.transaction.receiver_id !== receiver || !METHODS.has(call.method_name)) return [];
    const args = JSON.parse(Buffer.from(call.args, 'base64').toString() || '{}');
    const summary = txs[i];
    return [{
      hash: summary.transaction_hash,
      time: Number(BigInt(summary.tx_block_timestamp) / 1_000_000_000n),
      method: call.method_name,
      symbol: args.symbol ?? null,
      usdc: args.usdc ?? null,
      ok: summary.is_success,
    }];
  });
  return NextResponse.json({ rows });
}
