'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { CheckoutQuote } from '@/components/OneClick';
import { useSession } from '@/components/Session';
import { Notice, StatusBadge, usePoll } from '@/components/ui';
import { usd, view, type CatalogEntry, type Challenge } from '@/lib/chain';

const failure = (r: unknown) => {
  const status = (r as { status?: { Failure?: unknown } })?.status;
  return status?.Failure ? JSON.stringify(status.Failure).slice(0, 200) : null;
};

export default function Challenges() {
  const { config, accountId, send, signIn } = useSession();
  const tenor = config.stack.tenor;
  const [plan, setPlan] = useState('classic');
  const [twoStep, setTwoStep] = useState(false);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);

  const catalog = usePoll(() => view<CatalogEntry[]>(config.rpc, tenor, 'get_catalog'), [tenor], 60_000);
  const mine = usePoll(
    () => (accountId ? view<Challenge[]>(config.rpc, tenor, 'challenges_of', { owner: accountId }) : Promise.resolve([])),
    [tenor, accountId],
  );

  const rows = useMemo(
    () => (catalog.data ?? []).filter((c) => c.plan === plan && c.two_step === twoStep),
    [catalog.data, plan, twoStep],
  );

  async function run(id: string, ok: string, fn: () => Promise<unknown>) {
    if (!accountId) return signIn();
    setBusy(id);
    setMsg(null);
    try {
      const err = failure(await fn());
      setMsg(err ? { tone: 'error', text: err } : { tone: 'info', text: ok });
    } catch (e) {
      setMsg({ tone: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy('');
    }
  }

  const faucet = () =>
    run('faucet', 'Minted 2,000 test USDC.', () =>
      send({ receiverId: config.usdc, method: 'mint', args: { account_id: accountId, amount: '2000000000' }, gas: '30000000000000' }),
    );

  const buy = (c: CatalogEntry) =>
    run(c.product, `Bought ${c.product}.`, () =>
      send({
        receiverId: config.usdc,
        method: 'ft_transfer_call',
        args: { receiver_id: tenor, amount: c.fee, msg: JSON.stringify({ action: 'buy', product: c.product }) },
        deposit: '1',
        gas: '100000000000000',
      }),
    );

  const demo = () =>
    run('demo', 'Free demo opened.', () => send({ receiverId: tenor, method: 'claim_demo', args: {}, gas: '30000000000000' }));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Challenges</h1>
        <p className="mt-1 text-sm text-mute">No time limit. 80/20 profit split. Daily loss limit 3%. Prices and rules come from the contract.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {['classic', 'turbo', 'pro'].map((p) => (
          <button key={p} onClick={() => setPlan(p)} aria-pressed={plan === p} className={`btn ${plan === p ? '' : 'btn-ghost'} capitalize`}>
            {p}
          </button>
        ))}
        <button onClick={() => setTwoStep(!twoStep)} aria-pressed={twoStep} className="btn btn-ghost">
          {twoStep ? '2-step' : '1-step'}
        </button>
        <span className="ml-auto flex gap-2">
          <button onClick={faucet} disabled={busy === 'faucet'} className="btn btn-ghost">
            Get test USDC
          </button>
          <button onClick={demo} disabled={busy === 'demo'} className="btn btn-ghost">
            Free 10K demo
          </button>
        </span>
      </div>

      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {catalog.error && <Notice tone="error">Could not read the catalog: {catalog.error}</Notice>}

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="text-left text-mute">
              {['Account', 'Target', 'Max drawdown', 'Fee', ''].map((h) => (
                <th key={h} className="px-4 py-3 font-normal">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.product} className="border-t border-line">
                <td className="num px-4 py-3">{usd(BigInt(c.size_usdc) * 1_000_000n, 0)}</td>
                <td className="num px-4 py-3">
                  {c.target_bps / 100}%{c.phase_two_target_bps ? ` then ${c.phase_two_target_bps / 100}%` : ''}
                </td>
                <td className="num px-4 py-3">{c.max_drawdown_bps / 100}%</td>
                <td className="num px-4 py-3">{usd(c.fee, 0)}</td>
                <td className="px-4 py-2 text-right">
                  <button onClick={() => buy(c)} disabled={busy === c.product} className="btn btn-ghost">
                    Buy
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <CheckoutQuote />

      {accountId && (
        <section aria-labelledby="yours">
          <h2 id="yours" className="text-sm font-semibold">
            Your evaluations
          </h2>
          {mine.data?.length === 0 && <p className="mt-2 text-sm text-mute">None yet.</p>}
          <ul className="mt-3 space-y-2">
            {mine.data?.map((c) => (
              <li key={c.id} className="panel flex flex-wrap items-center justify-between gap-3">
                <span className="num text-sm">
                  #{c.id} {c.product}
                </span>
                <StatusBadge status={c.status} />
                <Link className="btn btn-ghost" href={c.guard ? `/funded/${c.guard}` : `/trade/${c.id}`}>
                  Open
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
