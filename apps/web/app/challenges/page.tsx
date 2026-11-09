'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { CapitalBar, useActiveCapital, useCart } from '@/components/Cart';
import { Reveal } from '@/components/motion';
import { useSession } from '@/components/Session';
import { Notice, usePoll } from '@/components/ui';
import { localCatalog, productSize, SIZES } from '@/lib/catalog';
import { usd, view, type CatalogEntry } from '@/lib/chain';

const THEMES: Record<string, string> = {
  classic: 'bg-[#141518] border-line',
  turbo: 'bg-[linear-gradient(180deg,#17132a_55%,#6d4fbf)] border-[#3b2f66]',
  pro: 'bg-[linear-gradient(180deg,#1d1810_55%,#a7842e)] border-[#5b4a1f]',
};

const label = (s: number) => `${s / 1000}K`;

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between py-2 text-sm">
      <span className="text-[#a9aeb6]">{k}</span>
      <span className="num">{v}</span>
    </div>
  );
}

const STEPS = [
  ['Complete a challenge', 'Hit the target onchain without touching the loss limits.'],
  ['Fund your Guard', 'Passing deploys a contract account holding your capital.'],
  ['Trade real swaps', 'Your key can trade, and nothing else.'],
  ['Take your payout', '80% of profit in USDC, paid by the contract.'],
];

export default function Challenges() {
  const { config, accountId, send, connect } = useSession();
  const { add, sizeInCart } = useCart();
  const router = useRouter();
  const tenor = config.stack.tenor;
  const [size, setSize] = useState<number | 'demo'>(25_000);
  const [twoStep, setTwoStep] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const active = useActiveCapital();

  const live = usePoll(() => (config.deployed ? view<CatalogEntry[]>(config.rpc, tenor, 'get_catalog') : Promise.resolve(localCatalog())), [tenor, config.deployed], 60_000);
  const plans = useMemo(
    () => ['classic', 'turbo', 'pro'].map((p) => (live.data ?? []).find((c) => c.plan === p && c.two_step === twoStep && productSize(c.product) === size)),
    [live.data, twoStep, size],
  );

  async function demo() {
    setBusy(true);
    setMsg(null);
    try {
      if (!accountId) return await connect();
      const r = (await send({ receiverId: tenor, method: 'claim_demo', args: {}, gas: '30000000000000' })) as { status?: { Failure?: unknown } };
      if (r?.status?.Failure) setMsg('You have already claimed your free demo.');
      else router.push('/dashboard');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-10">
      <header className="pt-8 text-center">
        <h1 className="text-4xl font-medium tracking-tight md:text-5xl">Choose your challenge</h1>
        <p className="mt-2 text-mute">One fee, no time limit. Or start with a free demo account.</p>
      </header>

      <div className="mx-auto grid max-w-2xl grid-cols-3 divide-x divide-line text-center">
        {[['Up to $200K', 'Funded accounts'], ['80%', 'Profit split'], ['4', 'Markets onchain']].map(([a, b]) => (
          <div key={b}>
            <div className="text-xl font-semibold md:text-2xl">{a}</div>
            <div className="label mt-1">{b}</div>
          </div>
        ))}
      </div>

      <div className="mx-auto max-w-3xl space-y-6">
        <CapitalBar active={active} inCart={sizeInCart} />
        <div>
          <p className="mb-2 text-center text-sm text-mute">Account size</p>
          <div className="seg">
            <button aria-pressed={size === 'demo'} onClick={() => setSize('demo')}>Demo</button>
            {SIZES.map((s) => <button key={s} className="num" aria-pressed={size === s} onClick={() => setSize(s)}>{label(s)}</button>)}
          </div>
        </div>
        {size !== 'demo' && (
          <div>
            <p className="mb-2 text-center text-sm text-mute">Phases</p>
            <div className="seg">
              <button aria-pressed={!twoStep} onClick={() => setTwoStep(false)}>1-Step</button>
              <button aria-pressed={twoStep} onClick={() => setTwoStep(true)}>2-Step</button>
            </div>
          </div>
        )}
      </div>

      {live.error && <Notice tone="error">Could not read the catalog: {live.error}</Notice>}
      {msg && <Notice tone="error">{msg}</Notice>}

      {size === 'demo' ? (
        <section className="panel mx-auto max-w-md text-center">
          <h2 className="text-xl font-medium">Free 10K demo</h2>
          <p className="mt-2 text-sm text-mute">Classic rules, one per account, no fee. A real onchain evaluation you can practise on.</p>
          <button className="btn mt-5 w-full" onClick={demo} disabled={busy || !config.deployed}>Start demo</button>
        </section>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {plans.map((c, i) =>
            c ? (
              <Reveal key={c.product} delay={i * 0.08}>
                <article className={`flex h-full flex-col rounded-2xl border p-6 ${THEMES[c.plan]}`}>
                  <h2 className="text-center capitalize text-[#c9cdd3]">{twoStep ? '2' : '1'}-Step {c.plan}</h2>
                  <p className="mt-2 text-center">
                    <span className="num text-4xl font-semibold">{usd(c.fee, 0)}</span>
                    <span className="ml-2 text-[#a9aeb6]">one-time</span>
                  </p>
                  <div className="mt-5 flex-1 border-t border-white/10 pt-3">
                    <Row k="Account size" v={`${Number(c.size_usdc).toLocaleString('en-US')} USDC`} />
                    <Row k="Profit target" v={`${c.target_bps / 100}%${c.phase_two_target_bps ? ` + ${c.phase_two_target_bps / 100}%` : ''}`} />
                    <Row k="Max drawdown" v={`${c.max_drawdown_bps / 100}%`} />
                    <Row k="Drawdown type" v="static" />
                    <Row k="Daily loss limit" v={`${c.daily_loss_bps / 100}%`} />
                    <Row k="Profit split" v="80%" />
                    <Row k="Time limit" v="None" />
                  </div>
                  <button className="btn mt-5 w-full" onClick={() => add(c.product, c.fee)}>Add to cart</button>
                </article>
              </Reveal>
            ) : null,
          )}
        </div>
      )}

      <section className="grid gap-4 pt-10 md:grid-cols-4">
        {STEPS.map(([t, b], i) => (
          <Reveal key={t} delay={i * 0.06}>
            <article className="panel flex h-60 flex-col rounded-2xl">
              <span className="num text-3xl text-mute">0{i + 1}</span>
              <h3 className="mt-auto text-lg font-medium">{t}</h3>
              <p className="mt-1 text-sm text-mute">{b}</p>
            </article>
          </Reveal>
        ))}
      </section>
    </div>
  );
}
