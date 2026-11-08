import Link from 'next/link';
import { view, usd, type ReserveState } from '@/lib/chain';
import { getConfig } from '@/lib/config';

const REPO = 'https://github.com/avishrakshe/Tenor/blob/main';

const PROMISES = [
  {
    promise: 'No B-book. Every funded trade is a real swap.',
    how: 'Each funded account is its own NEAR sub-account running a Guard contract. Tenor holds no full-access key on it.',
    code: `${REPO}/contracts/tenor/src/lib.rs`,
    fn: 'tenor::fund',
  },
  {
    promise: 'The trader can trade, never withdraw.',
    how: 'The trader holds a function-call key limited to three methods. A breach deletes that key from the chain.',
    code: `${REPO}/contracts/guard/src/lib.rs`,
    fn: 'guard::breach',
  },
  {
    promise: 'Every loss is pre-funded.',
    how: 'fund() panics unless the reserve covers all live max losses by 1.2x. After the fee, Tenor earns only 20% of real profit.',
    code: `${REPO}/crates/tenor-rules/src/lib.rs`,
    fn: 'rules::reserve_covers',
  },
];

export default async function Home() {
  const config = getConfig();
  const reserve = config.deployed
    ? await view<ReserveState>(config.rpc, config.stack.tenor, 'reserve_state').catch(() => null)
    : null;
  return (
    <div className="space-y-12">
      <section className="max-w-2xl">
        <h1 className="text-4xl font-semibold tracking-tight">The prop firm that can&apos;t trade against you</h1>
        <p className="mt-4 text-mute">
          Pay once for an evaluation. Hit the target without touching the loss limits and you trade real capital,
          keeping 80% of the profit. The rules are contract code, so the firm can&apos;t bend them.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/challenges" className="btn">
            Browse challenges
          </Link>
          <Link href="/transparency" className="btn btn-ghost">
            See the reserve
          </Link>
        </div>
      </section>

      <section aria-labelledby="promises">
        <h2 id="promises" className="text-sm font-semibold">
          What the contracts enforce
        </h2>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {PROMISES.map((p) => (
            <article key={p.promise} className="panel">
              <h3 className="font-medium">{p.promise}</h3>
              <p className="mt-2 text-sm text-mute">{p.how}</p>
              <a href={p.code} className="num mt-3 inline-block text-xs underline underline-offset-2">
                {p.fn}
              </a>
            </article>
          ))}
        </div>
      </section>

      {reserve && (
        <section className="panel grid grid-cols-2 gap-6 md:grid-cols-4" aria-label="Live reserve">
          <div>
            <div className="label">Risk reserve</div>
            <div className="num mt-1 text-lg">{usd(reserve.reserve, 0)}</div>
          </div>
          <div>
            <div className="label">Capital vault</div>
            <div className="num mt-1 text-lg">{usd(reserve.vault, 0)}</div>
          </div>
          <div>
            <div className="label">Live max loss</div>
            <div className="num mt-1 text-lg">{usd(reserve.live_max_loss, 0)}</div>
          </div>
          <div>
            <div className="label">Capital deployed</div>
            <div className="num mt-1 text-lg">{usd(reserve.capital_deployed, 0)}</div>
          </div>
        </section>
      )}
    </div>
  );
}
