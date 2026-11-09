'use client';

import { useLoginUser } from '@/lib/login';
import Link from 'next/link';
import { Reveal } from '@/components/motion';
import { useSession } from '@/components/Session';
import { Notice, StatusBadge, usePoll } from '@/components/ui';
import { equityWith, isLive, objectives, readAccounts } from '@/lib/accounts';
import { readQuotes, usd } from '@/lib/chain';

export default function Dashboard() {
  const { config, accountId } = useSession();
  const user = useLoginUser();
  const accounts = usePoll(() => (accountId ? readAccounts(config.rpc, config.stack.tenor, accountId) : Promise.resolve([])), [accountId, config.stack.tenor], 6000);
  const quotes = usePoll(() => readQuotes(config.rpc, config.stack.oracle), [config.stack.oracle], 6000);

  if (!accountId) {
    return (
      <div className="pt-24 text-center">
        <h1 className="text-3xl font-medium tracking-tight">Welcome{user?.firstName ? `, ${user.firstName}` : ''}</h1>
        {user?.primaryEmailAddress && <p className="mt-2 text-sm text-mute">Signed in as {user.primaryEmailAddress.emailAddress}</p>}
        <p className="mt-6 text-mute">Connect your NEAR wallet at the bottom right to see your accounts and start trading.</p>
      </div>
    );
  }

  const rows = accounts.data ?? [];
  const live = rows.filter(isLive);
  const total = live.reduce((a, r) => a + (equityWith(r, quotes.data) ?? r.cash), 0n);
  const [whole, cents] = usd(total).split('.');
  const paying = rows.filter((r) => r.funded && isLive(r) && r.cash > r.initial && r.positions.length === 0);
  const available = paying.reduce((a, r) => a + ((r.cash - r.initial) * 8n) / 10n, 0n);
  const firstLive = live[0];

  return (
    <div>
      <header className="pt-6 text-center">
        <div className="num text-5xl font-semibold">
          {whole}
          <span className="text-mute">.{cents}</span>
        </div>
        <p className="mt-1 text-sm text-mute">Equity across {live.length} active {live.length === 1 ? 'account' : 'accounts'}</p>
      </header>

      <div className="mx-auto mt-8 grid max-w-xl grid-cols-2 gap-3">
        <Link className="btn" href={firstLive ? firstLive.href : '/trade'}>Trade</Link>
        <Link className="btn btn-ghost" href="/challenges">Buy Challenge</Link>
      </div>
      <div className="mx-auto mt-4 flex max-w-xl items-center justify-between text-sm text-mute">
        <span>Available profits for withdrawal: <b className="num text-up">{usd(available)}</b></span>
        {paying[0] ? <Link className="hover:text-text" href={paying[0].href}>Request Payout ›</Link> : <span className="opacity-50">Request Payout ›</span>}
      </div>

      {accounts.error && <div className="mt-6"><Notice tone="error">{accounts.error}</Notice></div>}

      <section className="mt-12" aria-labelledby="your">
        <h2 id="your" className="text-mute">Challenges ({rows.length})</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r, i) => {
            const equity = equityWith(r, quotes.data) ?? r.cash;
            const o = objectives(r, equity);
            const pnl = equity - r.initial;
            return (
              <Reveal key={r.key} delay={i * 0.04}>
                <Link href={r.href} className="panel block transition-colors hover:border-white/30">
                  <div className="flex items-center justify-between gap-2">
                    <span className="num truncate text-sm">{r.title}</span>
                    <StatusBadge status={r.status} />
                  </div>
                  <div className="num mt-4 text-2xl">{usd(equity)}</div>
                  <div className={`num text-sm ${pnl < 0n ? 'text-down' : 'text-up'}`}>{pnl >= 0n ? '+' : ''}{usd(pnl)}</div>
                  <div className="mt-4 space-y-2">
                    {o.target && <Bar label="Target" bps={o.target.progressBps} tone="bg-up" />}
                    <Bar label="Daily" bps={o.daily.progressBps} tone="bg-down" />
                    <Bar label="Drawdown" bps={o.maxDrawdown.progressBps} tone="bg-down" />
                  </div>
                </Link>
              </Reveal>
            );
          })}
          <Link href="/challenges" className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line text-mute hover:text-text">
            <span className="text-xl" aria-hidden="true">+</span>
            Buy Challenge
          </Link>
        </div>
      </section>
    </div>
  );
}

function Bar({ label, bps, tone }: { label: string; bps: bigint; tone: string }) {
  return (
    <div className="grid grid-cols-[64px_1fr] items-center gap-2 text-xs text-mute">
      <span>{label}</span>
      <span className="h-1.5 rounded-sm bg-line">
        <span className={`block h-1.5 rounded-sm ${tone}`} style={{ width: `${Number(bps) / 100}%` }} />
      </span>
    </div>
  );
}
