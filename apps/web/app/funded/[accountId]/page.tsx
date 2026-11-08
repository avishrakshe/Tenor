'use client';

import { use, useEffect, useState } from 'react';
import { useCounterparty, Verdict } from '@/components/CounterpartyBadge';
import { PayoutQuote } from '@/components/OneClick';
import { sendWithKey, useSession, type Call } from '@/components/Session';
import { TradeTerminal } from '@/components/TradeTerminal';
import { Notice, Stat, usePoll } from '@/components/ui';
import { accessKeys, usd, view, type Funded, type GuardState } from '@/lib/chain';

function storedKey(challengeId: number | null): string | null {
  if (challengeId === null) return null;
  try {
    return localStorage.getItem(`tenor.trader.${challengeId}`);
  } catch {
    return null;
  }
}

export default function FundedPage({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId: guard } = use(params);
  const { config, accountId, send } = useSession();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const [recipient, setRecipient] = useState('');
  const [traderKey, setTraderKey] = useState<string | null>(null);

  const [walletBusy, setWalletBusy] = useState(false);
  const check = useCounterparty(recipient, accountId ?? undefined);
  const state = usePoll(() => view<GuardState>(config.rpc, guard, 'get_state'), [guard], 4000);
  const keys = usePoll(() => accessKeys(config.rpc, guard), [guard], 4000);
  const record = usePoll(
    async () => (await view<Funded[]>(config.rpc, config.stack.tenor, 'list_funded', { from_index: 0, limit: 500 })).find((f) => f.guard === guard) ?? null,
    [guard, config.stack.tenor],
    30_000,
  );

  useEffect(() => {
    setTraderKey(storedKey(record.data?.challenge_id ?? null));
  }, [record.data]);

  const s = state.data;
  if (state.error) return <div className="p-6"><Notice tone="error">{state.error}</Notice></div>;
  if (!s) return <div className="p-6"><Notice>Loading…</Notice></div>;

  const active = s.status === 'Active';
  const profit = BigInt(s.cash) > BigInt(s.initial_balance) ? BigInt(s.cash) - BigInt(s.initial_balance) : 0n;
  const traderShare = (profit * 8n) / 10n;
  const canTrade = Boolean(traderKey) && active;

  const target = recipient.trim();
  const allowed = target === s.trader || (s.approved_recipients ?? []).includes(target);

  async function walletCall(ok: string, method: string, who: string) {
    setWalletBusy(true);
    setMsg(null);
    try {
      const r = (await send({ receiverId: guard, method, args: { recipient: who }, deposit: '1', gas: '30000000000000' })) as { status?: { Failure?: unknown } };
      setMsg(r?.status?.Failure ? { tone: 'error', text: JSON.stringify(r.status.Failure).slice(0, 200) } : { tone: 'info', text: ok });
    } catch (e) {
      setMsg({ tone: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setWalletBusy(false);
    }
  }

  async function trade(ok: string, call: Omit<Call, 'receiverId'>) {
    if (!traderKey) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = (await sendWithKey(config.rpc, guard, traderKey, { ...call, receiverId: guard })) as unknown as { status?: { Failure?: unknown } };
      setMsg(r?.status?.Failure ? { tone: 'error', text: JSON.stringify(r.status.Failure).slice(0, 200) } : { tone: 'info', text: ok });
    } catch (e) {
      setMsg({ tone: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <TradeTerminal
      account={{
        title: `Funded ${guard.split('.')[0]}`,
        status: s.status,
        reason: s.breach_reason,
        phase: 'funded',
        initial: BigInt(s.initial_balance),
        dayStart: BigInt(s.day_start_equity),
        cash: BigInt(s.cash),
        positions: s.positions,
        rules: { phaseOneTargetBps: 0n, phaseTwoTargetBps: null, maxDrawdownBps: BigInt(s.max_drawdown_bps), dailyLossBps: BigInt(s.daily_loss_bps) },
      }}
      canTrade={canTrade}
      history={{ account: guard, receiver: guard }}
      busy={busy}
      message={msg ?? (!traderKey && active ? { tone: 'info', text: 'This browser does not hold the trader key for this account, so it is read-only here.' } : null)}
      onBuy={(symbol, usdc, tp, sl) => trade('Swap executed. The book is rebuilt from token balances.', { method: 'place_order', args: { symbol, usdc, tp_e8: tp, sl_e8: sl } })}
      onClose={(symbol) => trade('Position sold.', { method: 'close_position', args: { symbol } })}
    >
      <div className="grid gap-2 lg:grid-cols-2">
        <section className="panel" aria-labelledby="keys">
          <h2 id="keys" className="text-sm font-semibold">Access keys on this account, read from the chain</h2>
          {keys.data?.length === 0 && <p className="mt-2 text-sm text-down">No keys remain. Nobody can sign for this account.</p>}
          <ul className="mt-2 space-y-1">
            {keys.data?.map((k) => (
              <li key={k.public_key} className="num text-xs break-all text-mute">
                {k.public_key} · {k.access_key.permission === 'FullAccess' ? 'FULL ACCESS' : JSON.stringify(k.access_key.permission)}
              </li>
            ))}
          </ul>
          {config.explorer && <a className="mt-2 inline-block text-xs underline underline-offset-2" href={`${config.explorer}/address/${guard}`}>View on explorer</a>}
        </section>

        <section className="panel grid gap-6 md:grid-cols-2" aria-labelledby="payout">
          <div className="space-y-3">
            <h2 id="payout" className="text-sm font-semibold">Payout</h2>
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Your 80%" value={usd(traderShare)} tone="up" />
              <Stat label="Paid so far" value={usd(s.paid_to_trader)} />
            </div>
            <div>
              <label className="label" htmlFor="recipient">NEAR recipient or 1Click deposit address</label>
              <input id="recipient" className="field num" value={recipient} onChange={(e) => setRecipient(e.target.value)} />
            </div>
            {check.loading && <Notice>Checking this address…</Notice>}
            {check.error && <Notice tone="error">{check.error}</Notice>}
            {check.result && <Verdict result={check.result} />}
            {recipient && !allowed && (
              <div className="space-y-2 rounded-lg border border-line p-3">
                <p className="text-sm text-mute">Payouts only go to your own account or an address your wallet approved, so an agent holding the trade key can't redirect them.</p>
                {accountId === s.trader ? (
                  <button className="btn btn-ghost w-full" disabled={walletBusy || check.result?.verdict === 'block'} onClick={() => walletCall('Address approved.', 'approve_payout_recipient', recipient)}>
                    Approve this address in my wallet
                  </button>
                ) : (
                  <Notice>Log in with {s.trader} to approve it.</Notice>
                )}
              </div>
            )}
            <button className="btn w-full" disabled={!canTrade || busy || profit === 0n || s.positions.length > 0 || !recipient || !allowed || check.result?.verdict === 'block'} onClick={() => trade('Payout sent.', { method: 'request_payout', args: { recipient } })}>
              {check.result?.verdict === 'warn' ? 'Pay anyway' : 'Request payout'}
            </button>
            {(s.approved_recipients?.length ?? 0) > 0 && (
              <ul className="space-y-1 border-t border-line pt-2 text-xs text-mute">
                {s.approved_recipients.map((r) => (
                  <li key={r} className="num flex items-center justify-between gap-2">
                    <span className="truncate">{r}</span>
                    {accountId === s.trader && <button className="underline underline-offset-2" disabled={walletBusy} onClick={() => walletCall('Address removed.', 'revoke_payout_recipient', r)}>Revoke</button>}
                  </li>
                ))}
              </ul>
            )}
            {s.positions.length > 0 && <Notice>Close all positions before requesting a payout.</Notice>}
          </div>
          <PayoutQuote amountMicro={String(traderShare)} />
        </section>
      </div>
    </TradeTerminal>
  );
}
