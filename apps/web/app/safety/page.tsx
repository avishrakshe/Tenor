'use client';

import type { BlocklistStatus } from '@tenor/counterparty';
import Link from 'next/link';
import { useState } from 'react';
import { useCounterparty, Verdict } from '@/components/CounterpartyBadge';
import { Reveal } from '@/components/motion';
import { useSession } from '@/components/Session';
import { Notice, usePoll } from '@/components/ui';
import { view } from '@/lib/chain';

const LAYERS = [
  ['NEAR protocol', 'The agent’s key is a function-call key. It cannot transfer NEAR, add keys or attach a deposit, and it only reaches its own Guard.'],
  ['Guard contract', 'Enforces loss limits, position caps and a slippage floor, and only pays the trader or an address their own wallet approved.'],
  ['Counterparty check', 'Before paying anyone, the agent asks about the receiver. It refuses to sign on block and asks a person on warn.'],
];

const SIGNALS = [
  ['Shared blocklist', 'Contract view call'],
  ['Exists, is a contract', 'NEAR RPC'],
  ['Code changed recently', 'Archival RPC, comparing code hashes'],
  ['Account age, activity', 'FastNear Transactions API'],
  ['Past interactions', 'Transactions shared by both accounts'],
];

const REPORT_DEPOSIT = '10000000000000000000000';

export default function Safety() {
  const { config, accountId, send } = useSession();
  const [address, setAddress] = useState('');
  const [evidence, setEvidence] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const { result, error, loading } = useCounterparty(address, accountId ?? undefined);
  const list = usePoll(
    () => (config.blocklist ? view<BlocklistStatus[]>(config.rpc, config.blocklist, 'list', { from_index: 0, limit: 50 }) : Promise.resolve([])),
    [config.blocklist],
    20_000,
  );

  async function report() {
    setBusy(true);
    setMsg(null);
    try {
      const r = (await send({
        receiverId: config.blocklist,
        method: 'report',
        args: { account: address.trim().toLowerCase(), evidence: evidence.trim() },
        deposit: REPORT_DEPOSIT,
        gas: '30000000000000',
      })) as { status?: { Failure?: unknown } };
      setMsg(r?.status?.Failure ? { tone: 'error', text: JSON.stringify(r.status.Failure).slice(0, 200) } : { tone: 'info', text: 'Report added to the shared list.' });
      if (!r?.status?.Failure) setEvidence('');
    } catch (e) {
      setMsg({ tone: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <header className="pt-8 text-center">
        <h1 className="text-4xl font-medium tracking-tight md:text-5xl">Give an agent money, not the keys</h1>
        <p className="mx-auto mt-3 max-w-xl text-mute">Three independent layers stand between a compromised trading agent and your funds.</p>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        {LAYERS.map(([title, body], i) => (
          <Reveal key={title} delay={i * 0.08}>
            <article className="panel h-full rounded-2xl">
              <span className="num text-sm text-mute">Layer {i + 1}</span>
              <h2 className="mt-2 text-lg font-medium">{title}</h2>
              <p className="mt-2 text-sm text-mute">{body}</p>
            </article>
          </Reveal>
        ))}
      </div>

      <section className="grid gap-4 md:grid-cols-2" aria-label="Counterparty check">
        <div className="panel space-y-3">
          <h2 className="text-sm font-semibold">Check an account</h2>
          <div>
            <label className="label" htmlFor="check">NEAR account</label>
            <input id="check" className="field num" placeholder="someone.testnet" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          {loading && <Notice>Checking…</Notice>}
          {error && <Notice tone="error">{error}</Notice>}
          {result && <Verdict result={result} />}
          {address.trim() && accountId && (
            <div className="space-y-2 border-t border-line pt-3">
              <label className="label" htmlFor="evidence">Report this account: transaction hash or link as evidence</label>
              <input id="evidence" className="field num" maxLength={256} value={evidence} onChange={(e) => setEvidence(e.target.value)} />
              <button className="btn btn-ghost w-full" disabled={busy || !evidence.trim() || !config.blocklist} onClick={report}>Report for 0.01 NEAR</button>
            </div>
          )}
          {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        </div>
        <div className="panel">
          <h2 className="text-sm font-semibold">What is checked</h2>
          <table className="mt-3 w-full text-sm">
            <tbody>
              {SIGNALS.map(([a, b]) => (
                <tr key={a} className="border-t border-line first:border-0">
                  <td className="py-2 pr-3">{a}</td>
                  <td className="py-2 text-right text-mute">{b}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="label mt-3">If a source can&apos;t be read, the answer is a warning, never a silent pass.</p>
        </div>
      </section>

      <section aria-labelledby="list">
        <h2 id="list" className="text-sm font-semibold">Shared blocklist ({list.data?.length ?? 0})</h2>
        <p className="mt-1 text-sm text-mute">One report warns. Two reporters, or a confirmation, block.</p>
        {list.error && <Notice tone="error">{list.error}</Notice>}
        {list.data?.length === 0 ? (
          <p className="panel mt-3 text-center text-sm text-mute">Nothing reported yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-panel">
            <table className="w-full min-w-[620px] text-sm">
              <thead>
                <tr className="text-left text-mute">
                  {['Account', 'Reports', 'State', 'Latest evidence'].map((h) => <th key={h} className="px-4 py-3 font-normal">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {list.data?.map((s) => (
                  <tr key={s.account} className="border-t border-line">
                    <td className="num px-4 py-3">{s.account}</td>
                    <td className="num px-4 py-3">{s.reports}</td>
                    <td className={`px-4 py-3 ${s.blocked ? 'text-down' : 'text-warn'}`}>{s.blocked ? 'Blocked' : 'Warning'}</td>
                    <td className="max-w-64 truncate px-4 py-3 text-mute">{s.evidence[s.evidence.length - 1]?.evidence ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="text-center text-sm text-mute">
        Limits of each layer are written up in the <Link className="underline underline-offset-2" href="https://github.com/avishrakshe/Tenor#what-the-agents-key-can-and-cant-do">README</Link>.
      </p>
    </div>
  );
}
