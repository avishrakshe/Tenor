'use client';

import { useSession } from '@/components/Session';
import { Notice, StatusBadge, usePoll } from '@/components/ui';
import { usd, view, type Challenge } from '@/lib/chain';

export default function Leaderboard() {
  const { config, accountId } = useSession();
  const tenor = config.stack.tenor;
  const board = usePoll(
    async () => {
      const ids = await view<number[]>(config.rpc, tenor, 'active_challenge_ids', { from_index: 0, limit: 100 });
      const all = await Promise.all(ids.map((id) => view<Challenge>(config.rpc, tenor, 'get_challenge', { id })));
      return all
        .map((c) => ({ c, pct: (Number(BigInt(c.last_equity) - BigInt(c.initial_balance)) / Number(c.initial_balance)) * 100 }))
        .sort((a, b) => b.pct - a.pct);
    },
    [tenor],
    20_000,
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-medium tracking-tight">Leaderboard</h1>
        <p className="mt-1 text-sm text-mute">Active evaluations ranked by return, using equity recorded onchain at each trader&apos;s last action.</p>
      </div>
      {board.error && <Notice tone="error">{board.error}</Notice>}
      {board.data?.length === 0 ? (
        <p className="panel text-center text-mute">No active evaluations yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-panel">
          <table className="w-full min-w-[620px] text-sm">
            <thead>
              <tr className="text-left text-mute">
                {['Rank', 'Trader', 'Product', 'Equity', 'Return', 'Status'].map((h) => <th key={h} className="px-4 py-3 font-normal">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {board.data?.map(({ c, pct }, i) => (
                <tr key={c.id} className={`num border-t border-line ${c.owner === accountId ? 'bg-white/5' : ''}`}>
                  <td className="px-4 py-3">{i + 1}</td>
                  <td className="max-w-56 truncate px-4 py-3">{c.owner}</td>
                  <td className="px-4 py-3">{c.product}</td>
                  <td className="px-4 py-3">{usd(c.last_equity)}</td>
                  <td className={`px-4 py-3 ${pct < 0 ? 'text-down' : 'text-up'}`}>{pct >= 0 ? '+' : ''}{pct.toFixed(2)}%</td>
                  <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
