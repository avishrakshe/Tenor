import Link from 'next/link';
import { Stat } from '@/components/ui';
import { usd, view, type Breach, type Funded, type ReserveState } from '@/lib/chain';
import { getConfig } from '@/lib/config';

export const dynamic = 'force-dynamic';

export default async function Transparency() {
  const config = getConfig();
  if (!config.deployed) return <p className="text-sm text-mute">Nothing deployed on {config.network} yet.</p>;
  const tenor = config.stack.tenor;
  const [reserve, funded, breaches] = await Promise.all([
    view<ReserveState>(config.rpc, tenor, 'reserve_state'),
    view<Funded[]>(config.rpc, tenor, 'list_funded', { from_index: 0, limit: 500 }),
    view<Breach[]>(config.rpc, tenor, 'list_breaches', { from_index: 0, limit: 500 }),
  ]);
  const coverage = reserve.coverage_bps ? `${(Number(reserve.coverage_bps) / 10_000).toFixed(2)}x` : 'No live risk';
  const healthy = !reserve.coverage_bps || BigInt(reserve.coverage_bps) >= BigInt(reserve.required_coverage_bps);
  const accountHref = (id: string) => (config.explorer ? `${config.explorer}/address/${id}` : undefined);
  const blockHref = (h: number) => (config.explorer ? `${config.explorer}/blocks/${h}` : undefined);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Transparency</h1>
        <p className="num mt-1 text-sm break-all text-mute">
          Live reads from {tenor} on {config.network}. Nothing on this page is stored off-chain.
        </p>
      </div>

      <section className="panel grid grid-cols-2 gap-6 md:grid-cols-5" aria-label="Risk reserve">
        <Stat label="Reserve assets" value={usd(reserve.reserve, 0)} />
        <Stat label="Live max loss" value={usd(reserve.live_max_loss, 0)} />
        <Stat label="Coverage (min 1.20x)" value={coverage} tone={healthy ? 'up' : 'down'} />
        <Stat label="Capital vault" value={usd(reserve.vault, 0)} />
        <Stat label="Capital deployed" value={usd(reserve.capital_deployed, 0)} />
      </section>

      <section aria-labelledby="funded">
        <h2 id="funded" className="text-sm font-semibold">
          Funded accounts ({funded.length})
        </h2>
        {funded.length === 0 ? (
          <p className="mt-2 text-sm text-mute">None yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left text-mute">
                  {['Guard', 'Trader', 'Capital', 'Max loss', 'State', 'Returned'].map((h) => (
                    <th key={h} className="px-4 py-3 font-normal">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {funded.map((f) => (
                  <tr key={f.guard} className="border-t border-line">
                    <td className="num px-4 py-3">
                      <Link className="underline underline-offset-2" href={`/funded/${f.guard}`}>
                        {f.guard}
                      </Link>
                    </td>
                    <td className="num px-4 py-3">{f.trader}</td>
                    <td className="num px-4 py-3">{usd(f.capital, 0)}</td>
                    <td className="num px-4 py-3">{usd(f.max_loss, 0)}</td>
                    <td className="px-4 py-3">{f.settled ? 'Settled' : 'Live'}</td>
                    <td className="num px-4 py-3">{f.settled ? usd(f.returned) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="breaches">
        <h2 id="breaches" className="text-sm font-semibold">
          Breaches ({breaches.length})
        </h2>
        {breaches.length === 0 ? (
          <p className="mt-2 text-sm text-mute">None yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left text-mute">
                  {['Account', 'Kind', 'Reason', 'Equity', 'When (UTC)', 'Block'].map((h) => (
                    <th key={h} className="px-4 py-3 font-normal">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {breaches.map((b) => (
                  <tr key={`${b.account}-${b.block_height}`} className="border-t border-line">
                    <td className="num px-4 py-3">
                      {b.funded && accountHref(b.account) ? (
                        <a className="underline underline-offset-2" href={accountHref(b.account)}>
                          {b.account}
                        </a>
                      ) : (
                        b.account
                      )}
                    </td>
                    <td className="px-4 py-3">{b.funded ? 'Funded' : 'Evaluation'}</td>
                    <td className="num px-4 py-3">{b.reason}</td>
                    <td className="num px-4 py-3">{usd(b.equity)}</td>
                    <td className="num px-4 py-3">{new Date(b.timestamp * 1000).toISOString().slice(0, 16).replace('T', ' ')}</td>
                    <td className="num px-4 py-3">
                      {blockHref(b.block_height) ? (
                        <a className="underline underline-offset-2" href={blockHref(b.block_height)}>
                          {b.block_height}
                        </a>
                      ) : (
                        b.block_height
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
