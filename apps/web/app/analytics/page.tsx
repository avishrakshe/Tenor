'use client';

import { MARKETS, market, markValue } from '@tenor/rules';
import Link from 'next/link';
import { AllocationBar, PriceArea, ReturnBars, type Slice } from '@/components/Charts';
import { useSession } from '@/components/Session';
import { Meter, Notice, Stat, usePoll } from '@/components/ui';
import { equityWith, isLive, objectives, readAccounts } from '@/lib/accounts';
import { readQuotes, usd } from '@/lib/chain';

// Fixed by market so a colour never changes meaning. Checked with the palette validator.
const COLORS: Record<string, string> = { BTC: '#4a86e8', ETH: '#1f9e70', SOL: '#c08a1e', NEAR: '#a463dc', Cash: '#c9537e' };

export default function Analytics() {
  const { config, accountId } = useSession();
  const accounts = usePoll(() => (accountId ? readAccounts(config.rpc, config.stack.tenor, accountId) : Promise.resolve([])), [accountId, config.stack.tenor], 8000);
  const quotes = usePoll(() => readQuotes(config.rpc, config.stack.oracle), [config.stack.oracle], 8000);

  if (!accountId) {
    return (
      <div className="pt-24 text-center">
        <h1 className="text-3xl font-medium tracking-tight">Connect your wallet to see your analytics</h1>
        <p className="mt-6 text-mute">Use the button at the bottom right.</p>
      </div>
    );
  }

  const live = (accounts.data ?? []).filter(isLive);
  const equities = live.map((a) => ({ a, equity: equityWith(a, quotes.data) ?? a.cash }));
  const totalEquity = equities.reduce((s, r) => s + r.equity, 0n);
  const totalStart = live.reduce((s, a) => s + a.initial, 0n);
  const pnl = totalEquity - totalStart;

  const totals: Record<string, bigint> = { Cash: 0n };
  MARKETS.forEach((m) => (totals[m.symbol] = 0n));
  for (const a of live) {
    totals.Cash += a.cash;
    for (const p of a.positions) {
      const q = quotes.data?.[p.symbol];
      if (q) totals[p.symbol] += markValue(BigInt(p.qty), q, market(p.symbol).decimals);
    }
  }
  const slices: Slice[] = [...MARKETS.map((m) => m.symbol), 'Cash'].map((label) => ({ label, value: Number(totals[label]) / 1e6, color: COLORS[label] }));
  const fmt = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-medium tracking-tight">Analytics</h1>
      {accounts.error && <Notice tone="error">{accounts.error}</Notice>}

      <section className="panel grid grid-cols-2 gap-6 md:grid-cols-4" aria-label="Summary">
        <Stat label="Total equity" value={usd(totalEquity)} />
        <Stat label="Total P&L" value={usd(pnl)} tone={pnl < 0n ? 'down' : 'up'} />
        <Stat label="Return" value={totalStart > 0n ? `${(Number(pnl) / Number(totalStart) * 100).toFixed(2)}%` : '0.00%'} tone={pnl < 0n ? 'down' : 'up'} />
        <Stat label="Active accounts" value={String(live.length)} />
      </section>

      {live.length === 0 ? (
        <section className="panel text-center">
          <p className="text-mute">No active accounts yet.</p>
          <Link href="/challenges" className="btn mt-4">Buy a challenge</Link>
        </section>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <section className="panel" aria-labelledby="alloc">
            <h2 id="alloc" className="mb-4 text-sm font-semibold">Where your equity sits</h2>
            <AllocationBar slices={slices} format={fmt} />
          </section>
          <section className="panel" aria-labelledby="ret">
            <h2 id="ret" className="mb-4 text-sm font-semibold">Return by account</h2>
            <ReturnBars rows={equities.map(({ a, equity }) => ({ label: a.title, pct: (Number(equity - a.initial) / Number(a.initial)) * 100 }))} />
          </section>
          <section className="panel md:col-span-2" aria-labelledby="risk">
            <h2 id="risk" className="mb-4 text-sm font-semibold">Risk used</h2>
            <div className="grid gap-6 md:grid-cols-2">
              {equities.map(({ a, equity }) => {
                const o = objectives(a, equity);
                return (
                  <div key={a.key} className="space-y-3">
                    <div className="num text-sm text-mute">{a.title}</div>
                    <Meter label="Daily loss" tone="down" progressBps={o.daily.progressBps} caption={`${usd(o.daily.remaining)} left`} />
                    <Meter label="Max drawdown" tone="down" progressBps={o.maxDrawdown.progressBps} caption={`${usd(o.maxDrawdown.remaining)} left`} />
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      )}

      <section className="panel" aria-label="BTC market"><PriceArea symbol="BTC" days={30} /></section>
    </div>
  );
}
