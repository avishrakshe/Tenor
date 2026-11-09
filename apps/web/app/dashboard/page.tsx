'use client';

import Link from 'next/link';
import { useSession } from '@/components/Session';
import { Notice, Stat, StatusBadge, usePoll } from '@/components/ui';
import { equityWith, isLive, objectives, readAccounts, type AccountRow } from '@/lib/accounts';
import { readQuotes, usd, type LiveQuote } from '@/lib/chain';
import { useLoginUser } from '@/lib/login';

type Quotes = Record<string, LiveQuote> | null;

const isClosed = (r: AccountRow) => r.status === 'Breached' || r.status === 'Settled';

const GROUPS: { title: string; note: string; match: (r: AccountRow) => boolean }[] = [
  { title: 'Funded accounts', note: 'Trading capital on its own Guard account. You keep 80% of the profit.', match: (r) => r.funded && !isClosed(r) },
  { title: 'Passed, ready to fund', note: 'You hit the target. Fund the account to trade capital.', match: (r) => !r.funded && r.status === 'Passed' },
  { title: 'Challenges in progress', note: 'Reach the profit target without crossing a loss limit.', match: (r) => !r.funded && !isClosed(r) && r.status !== 'Passed' },
  { title: 'Closed', note: 'Breached or settled accounts, kept for your records.', match: isClosed },
];

const COLUMNS = 'lg:grid-cols-[minmax(0,1.6fr)_minmax(0,0.9fr)_minmax(0,0.8fr)_minmax(0,0.5fr)_minmax(0,1.5fr)_72px]';

function signedUsd(n: bigint) {
  return `${n >= 0n ? '+' : '−'}${usd(n < 0n ? -n : n)}`;
}

function action(r: AccountRow) {
  if (isClosed(r)) return 'View';
  return r.status === 'Passed' ? 'Fund' : 'Trade';
}

export default function Dashboard() {
  const { config, accountId } = useSession();
  const user = useLoginUser();
  const accounts = usePoll(() => (accountId ? readAccounts(config.rpc, config.stack.tenor, accountId) : Promise.resolve([])), [accountId, config.stack.tenor], 6000);
  const quotes = usePoll(() => readQuotes(config.rpc, config.stack.oracle), [config.stack.oracle], 6000);
  const mode = config.stackName === 'demo' ? 'demo' : 'live';

  if (!accountId) {
    return (
      <div className="pt-24 text-center">
        <h1 className="text-3xl font-medium tracking-tight">Welcome{user?.firstName ? `, ${user.firstName}` : ''}</h1>
        {user?.primaryEmailAddress && <p className="mt-2 text-sm text-mute">Signed in as {user.primaryEmailAddress.emailAddress}</p>}
        <p className="mt-6 text-mute">Connect your NEAR wallet at the bottom right to see your accounts and start trading.</p>
      </div>
    );
  }

  const rows = accounts.data;
  const all = rows ?? [];
  const live = all.filter(isLive);
  const equityOf = (r: AccountRow) => equityWith(r, quotes.data) ?? r.cash;
  const totalEquity = live.reduce((a, r) => a + equityOf(r), 0n);
  const totalStart = live.reduce((a, r) => a + r.initial, 0n);
  const openTrades = live.reduce((a, r) => a + r.positions.length, 0);
  const paying = all.filter((r) => r.funded && isLive(r) && r.cash > r.initial && r.positions.length === 0);
  const withdrawable = paying.reduce((a, r) => a + ((r.cash - r.initial) * 8n) / 10n, 0n);
  const pnl = totalEquity - totalStart;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-medium tracking-tight">Your accounts</h1>
          <p className="mt-1 text-sm text-mute">
            {all.length} {all.length === 1 ? 'account' : 'accounts'} in {mode} mode. Live and demo accounts are listed separately.
          </p>
        </div>
        <div className="flex gap-2">
          {live[0] && <Link className="btn btn-ghost" href={live[0].href}>Trade</Link>}
          <Link className="btn" href="/challenges">Buy challenge</Link>
        </div>
      </header>

      <section className="panel grid grid-cols-2 gap-6 lg:grid-cols-4" aria-label="Summary">
        <Stat label="Equity in active accounts" value={usd(totalEquity)} />
        <Stat label="Unrealised + realised P&L" value={signedUsd(pnl)} tone={pnl < 0n ? 'down' : pnl > 0n ? 'up' : undefined} />
        <Stat label="Open trades" value={String(openTrades)} />
        <div>
          <Stat label="Available to withdraw" value={usd(withdrawable)} tone={withdrawable > 0n ? 'up' : undefined} />
          {paying[0] && <Link className="mt-1 inline-block text-xs text-mute underline underline-offset-2 hover:text-text" href={paying[0].href}>Request payout</Link>}
        </div>
      </section>

      {accounts.error && <Notice tone="error">{accounts.error}</Notice>}
      {rows === null && !accounts.error && <Notice>Loading your accounts…</Notice>}

      {rows !== null && all.length === 0 && (
        <section className="panel py-14 text-center">
          <h2 className="text-lg font-medium">No {mode} accounts yet</h2>
          <p className="mt-2 text-sm text-mute">Buy a challenge to start trading. Pass it and you can fund the account.</p>
          <Link className="btn mt-6 inline-flex" href="/challenges">Buy challenge</Link>
        </section>
      )}

      {GROUPS.map((g) => {
        const members = all.filter(g.match);
        if (members.length === 0) return null;
        return (
          <section key={g.title} aria-label={g.title}>
            <div className="mb-3 flex flex-wrap items-baseline gap-x-3">
              <h2 className="font-medium">{g.title} <span className="num text-sm text-mute">{members.length}</span></h2>
              <p className="text-sm text-mute">{g.note}</p>
            </div>
            <div className="overflow-hidden rounded-xl border border-line bg-panel">
              <div className={`label hidden gap-4 border-b border-line px-4 py-2 lg:grid ${COLUMNS}`}>
                <span>Account</span>
                <span>Equity</span>
                <span>P&amp;L</span>
                <span>Trades</span>
                <span>Rules used</span>
                <span />
              </div>
              {members.map((r) => <Row key={r.key} row={r} quotes={quotes.data} />)}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function Row({ row: r, quotes }: { row: AccountRow; quotes: Quotes }) {
  const equity = equityWith(r, quotes) ?? r.cash;
  const settled = r.status === 'Settled';
  const profit = equity - r.initial;
  const o = objectives(r, equity);
  return (
    <Link href={r.href} className={`grid grid-cols-2 items-center gap-x-4 gap-y-3 border-b border-line px-4 py-4 transition-colors last:border-0 hover:bg-white/[0.03] ${COLUMNS}`}>
      <div className="col-span-2 min-w-0 lg:col-span-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{r.title}</span>
          <StatusBadge status={r.status} />
        </div>
        <div className="label mt-0.5">{usd(r.initial, 0)} account</div>
      </div>
      <Cell label="Equity">{settled ? '—' : usd(equity)}</Cell>
      <Cell label="P&L" tone={settled ? '' : profit < 0n ? 'text-down' : 'text-up'}>{settled ? '—' : signedUsd(profit)}</Cell>
      <Cell label="Trades">{r.positions.length}</Cell>
      <div className="col-span-2 space-y-1.5 lg:col-span-1">
        {isClosed(r) ? (
          <span className="text-sm text-mute">Closed</span>
        ) : (
          <>
            {o.target && <Bar label="Target" bps={o.target.progressBps} tone="bg-up" />}
            <Bar label="Daily" bps={o.daily.progressBps} tone="bg-down" />
            <Bar label="Drawdown" bps={o.maxDrawdown.progressBps} tone="bg-down" />
          </>
        )}
      </div>
      <span className="col-span-2 text-right text-sm underline underline-offset-2 lg:col-span-1">{action(r)}</span>
    </Link>
  );
}

function Cell({ label, tone = '', children }: { label: string; tone?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="label lg:hidden">{label}</div>
      <div className={`num text-sm ${tone}`}>{children}</div>
    </div>
  );
}

function Bar({ label, bps, tone }: { label: string; bps: bigint; tone: string }) {
  return (
    <div className="grid grid-cols-[60px_1fr] items-center gap-2 text-xs text-mute">
      <span>{label}</span>
      <span className="h-1.5 rounded-sm bg-line">
        <span className={`block h-1.5 rounded-sm ${tone}`} style={{ width: `${Number(bps) / 100}%` }} />
      </span>
    </div>
  );
}
