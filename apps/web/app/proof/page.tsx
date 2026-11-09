import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Stat } from '@/components/ui';
import { usd } from '@/lib/chain';

export const dynamic = 'force-dynamic';

type Proof = {
  network: string;
  ranAt: string;
  ok: boolean;
  tenor: string;
  trader: string;
  guards: string[];
  summary: { feesPaid: string; traderReceived: string; firmReceived: string; reserveCoveredLoss: string };
  steps: { step: number; title: string; ok: boolean; txs: string[]; deltas: Record<string, string> }[];
};

function load(): Proof | null {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), '..', '..', 'deployments', 'money-proof.testnet.json'), 'utf8'));
  } catch {
    return null;
  }
}

function signed(micro: string) {
  const n = BigInt(micro);
  return `${n < 0n ? '−' : '+'}${usd(n < 0n ? -n : n)}`;
}

const LABELS: Record<string, string> = {
  supply: 'minted by mock venue or faucet',
  reserve: 'reserve book',
  vault: 'vault book',
  capital_deployed: 'capital deployed',
  live_max_loss: 'live max loss',
};

export default function ProofPage() {
  const proof = load();
  if (!proof) return <p className="text-sm text-mute">No proof run has been published yet. Run npm run demo:money.</p>;
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Money proof</h1>
        <p className="mt-2 max-w-3xl text-sm text-mute">
          One recorded run of <code className="num">npm run demo:money</code> on NEAR {proof.network}. Each step read every balance from the chain before and after, and compared the change with an amount calculated separately from the oracle price. One micro-USDC off fails the run. USDC here is a test token and the swap venue mints its output.
        </p>
        <p className={`num mt-2 text-sm ${proof.ok ? 'text-up' : 'text-down'}`}>
          {proof.ok ? 'All checks passed' : 'Some checks failed'} · {proof.ranAt.slice(0, 16).replace('T', ' ')} UTC
        </p>
      </div>

      <section className="panel grid grid-cols-2 gap-6 md:grid-cols-4" aria-label="Summary">
        <Stat label="Fees into the reserve" value={usd(proof.summary.feesPaid)} />
        <Stat label="Profit paid to trader (80%)" value={usd(proof.summary.traderReceived)} tone="up" />
        <Stat label="Profit paid to firm (20%)" value={usd(proof.summary.firmReceived)} />
        <Stat label="Breach loss paid by reserve" value={usd(proof.summary.reserveCoveredLoss)} tone="down" />
      </section>

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="text-left text-mute">
              {['#', 'What happened', 'Exact changes', 'Transactions'].map((h) => <th key={h} className="px-4 py-3 font-normal">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {proof.steps.map((s) => (
              <tr key={s.step} className="border-t border-line align-top">
                <td className="num px-4 py-3">{s.step}</td>
                <td className="px-4 py-3">{s.title}</td>
                <td className="num px-4 py-3">
                  {Object.keys(s.deltas).length === 0 ? (
                    <span className="text-mute">No money moved</span>
                  ) : (
                    Object.entries(s.deltas).map(([k, v]) => <div key={k}><span className="text-mute">{LABELS[k] ?? k}</span> {signed(v)}</div>)
                  )}
                </td>
                <td className="num px-4 py-3">
                  {s.txs.map((t, i) => <a key={t} className="mr-2 underline underline-offset-2" href={t}>tx{s.txs.length > 1 ? ` ${i + 1}` : ''}</a>)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
