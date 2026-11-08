'use client';

import { AnimatePresence, motion, useScroll, useTransform, type MotionValue } from 'motion/react';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { PriceArea } from './Charts';
import { LiquidCard } from './LiquidCard';
import { ArrowIcon, CountUp, MarkIcon, Reveal, ScrollWords } from './motion';
import { Mark, Wordmark } from './three/Scene3D';

export type LiveStats = {
  reserve: number | null;
  liveMaxLoss: number | null;
  coverage: number | null;
  funded: number | null;
  breaches: number | null;
};

const REPO = 'https://github.com/avishrakshe/Tenor/blob/main';

const STORY = [
  { tag: 'Execution', title: 'Real swaps. No B-book.', body: 'Each funded account is its own NEAR sub-account running a Guard contract. Trades go to a real venue, and the book is rebuilt from token balances.' },
  { tag: 'Keys', title: 'You can trade. You can’t withdraw.', body: 'Your key is limited to three contract methods. Cross a limit and the contract deletes it from the chain in the same step.' },
  { tag: 'Reserve', title: 'Losses are funded first.', body: 'A new account can’t open unless the reserve covers every live maximum loss by 1.2 times. After the fee, Tenor only earns 20% of real profit.' },
  { tag: 'Enforcement', title: 'Anyone can apply the rules.', body: 'Rollovers, stops and breaches sit behind one public function. The firm can’t delay a verdict or keep one from happening.' },
];

const FEATURES = [
  { title: 'Onchain evaluations', tint: [0.75, 0.78, 0.82] as [number, number, number], seed: 1.3, body: 'Every order is a transaction, priced by the oracle and judged in contract code. Pass or fail needs no backend.', code: 'contracts/tenor/src/lib.rs' },
  { title: 'Guard accounts', tint: [0.3, 0.8, 0.62] as [number, number, number], seed: 4.1, body: 'Passing deploys a contract that holds your capital. Tenor keeps no full-access key on it.', code: 'contracts/guard/src/lib.rs' },
  { title: 'One rulebook', tint: [0.86, 0.62, 0.3] as [number, number, number], seed: 7.7, body: 'The same Rust function judges evaluations and funded accounts, so the two can never disagree.', code: 'crates/tenor-rules/src/lib.rs' },
  { title: 'Any-chain edges', tint: [0.6, 0.5, 0.95] as [number, number, number], seed: 2.6, body: 'Pay for a challenge and take payouts across chains through NEAR Intents.', code: 'apps/web/components/OneClick.tsx' },
];

const TAPE = ['NEAR Protocol', 'NEAR Intents', 'Rhea', 'Global contracts', 'Function-call keys', 'BTC', 'ETH', 'SOL', 'NEAR', 'USDC'];

const STEPS = [
  ['Pick a challenge', 'Choose a size from $5K to $200K, one step or two. There is one fee and no time limit.'],
  ['Pass onchain', 'Trade BTC, ETH, SOL and NEAR at oracle prices. Hit the target without touching the loss limits.'],
  ['Get your Guard', 'A contract account is created with your capital and a key that can only trade.'],
  ['Take 80%', 'Close your positions and request a payout. The split is paid by the contract.'],
];

const FAQ = [
  ['What is a B-book, and how is Tenor different?', 'A B-book firm keeps trades in-house and earns when traders lose. On Tenor, funded trades are real swaps from a contract you can inspect, and the firm’s only income after the fee is a share of profit.'],
  ['What are the limits?', 'A 3% daily loss limit on every plan, and a static maximum drawdown of 6% on Classic, 3% on Turbo and 5% on Pro, measured from the starting balance.'],
  ['Can Tenor freeze my account or change a result?', 'Pass and fail are decided by contract code using oracle prices. The firm has no key on your funded account.'],
  ['What happens if the price feed stops?', 'If a price is more than 60 seconds old there are no fills and no breaches, so bad data can’t end an account.'],
  ['Is this real money?', 'Not yet. Tenor runs on NEAR testnet with mock USDC and mock market tokens, and the contracts have not been audited.'],
];

function Hero() {
  return (
    <section className="relative flex flex-col px-4 pt-6 md:px-10">
      <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }} className="max-w-3xl">
        <h1 className="text-5xl leading-[1.08] font-medium tracking-tight md:text-6xl">
          Trade our capital.
          <br />
          Keep 80%.
          <br />
          Rules in code.
        </h1>
        <p className="mt-6 max-w-md text-base text-mute">A prop firm with no B-book. Funded trades are real swaps, and the limits are contracts nobody at Tenor can bend.</p>
        <div className="mt-7 flex flex-wrap items-center gap-5">
          <Link href="/challenges" className="pill">
            Buy a challenge
            <span className="pill-arrow"><ArrowIcon /></span>
          </Link>
          <Link href="/transparency" className="inline-flex items-center gap-2 text-sm text-mute hover:text-text">
            See the reserve <ArrowIcon />
          </Link>
        </div>
      </motion.div>
      <Wordmark className="h-[34vw] max-h-[56vh] min-h-[180px] w-full" />
      <div className="num flex flex-wrap justify-between gap-2 pb-5 text-xs text-mute">
        <span><span className="text-up">●</span> Running on NEAR testnet</span>
        <span>Accounts up to $200K</span>
        <span>BTC · ETH · SOL · NEAR</span>
      </div>
    </section>
  );
}

function StoryPanel({ i, progress }: { i: number; progress: MotionValue<number> }) {
  const n = STORY.length;
  const center = (i + 0.5) / n;
  const w = 0.5 / n;
  const opacity = useTransform(progress, [center - w, center - w * 0.5, center + w * 0.5, center + w], [i === 0 ? 1 : 0, 1, 1, i === n - 1 ? 1 : 0]);
  const x = useTransform(progress, [center - w, center - w * 0.4, center + w * 0.4, center + w], [i === 0 ? 0 : 60, 0, 0, i === n - 1 ? 0 : -60]);
  return (
    <motion.div style={{ opacity, x }} className="absolute inset-0 flex flex-col justify-center">
      <h3 className="text-3xl font-medium tracking-tight md:text-4xl">{STORY[i].title}</h3>
      <p className="mt-4 max-w-md text-mute md:text-lg">{STORY[i].body}</p>
    </motion.div>
  );
}

function Story() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] });
  const fill = useTransform(scrollYProgress, [0, 1], ['0%', '100%']);
  return (
    <section ref={ref} className="relative" style={{ height: `${STORY.length * 100}vh` }} aria-label="How Tenor enforces its promises">
      <div className="sticky top-0 flex h-svh flex-col px-4 pt-20 pb-8 md:px-10">
        <span className="tag self-start">How it works</span>
        <div className="grid flex-1 grid-rows-[1fr_1fr] items-center gap-4 md:grid-cols-2 md:grid-rows-1">
          <div className="relative h-full min-h-[200px]">
            {STORY.map((s, i) => (
              <StoryPanel key={s.tag} i={i} progress={scrollYProgress} />
            ))}
          </div>
          <Mark progress={scrollYProgress} className="h-full min-h-[200px] w-full" />
        </div>
        <div>
          <div className="mb-3 grid grid-cols-4 text-center text-sm text-mute">
            {STORY.map((s) => <span key={s.tag}>{s.tag}</span>)}
          </div>
          <div className="relative h-px bg-line">
            <motion.div className="absolute inset-y-0 left-0 bg-white" style={{ width: fill, height: 1 }} />
          </div>
        </div>
      </div>
    </section>
  );
}

function Features() {
  return (
    <section className="px-4 py-28 md:px-10">
      <ScrollWords text="Built to be checked" className="text-center text-4xl font-medium tracking-tight md:text-5xl" />
      <Reveal><p className="mt-3 text-center text-mute">Every promise links to the code that keeps it.</p></Reveal>
      <div className="mt-14 grid gap-4 md:grid-cols-2">
        {FEATURES.map((f, i) => (
          <Reveal key={f.title} delay={(i % 2) * 0.1}>
            <article className="group relative h-[420px] overflow-hidden rounded-2xl border border-line bg-panel">
              <LiquidCard tint={f.tint} seed={f.seed} className="absolute inset-0 h-full w-full opacity-80 transition-opacity duration-500 group-hover:opacity-100" />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/70 to-transparent p-6 pt-24">
                <h3 className="text-2xl font-medium">{f.title}</h3>
                <p className="mt-2 max-w-md text-sm text-mute">{f.body}</p>
                <a href={`${REPO}/${f.code}`} className="num mt-3 inline-flex items-center gap-2 text-xs underline-offset-2 hover:underline">
                  Read the code <ArrowIcon />
                </a>
              </div>
            </article>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function Tape() {
  return (
    <section className="overflow-hidden border-y border-line py-6" aria-label="Built with">
      <div className="marquee flex w-max gap-14 text-lg text-mute">
        {[...TAPE, ...TAPE].map((t, i) => <span key={i}>{t}</span>)}
      </div>
    </section>
  );
}

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

function Numbers({ stats }: { stats: LiveStats }) {
  const items = [
    { label: 'Risk reserve', note: 'USDC set aside for losses.', value: stats.reserve, fmt: money },
    { label: 'Live max loss', note: 'Worst case across funded accounts.', value: stats.liveMaxLoss, fmt: money },
    { label: 'Funded accounts', note: 'Guards created so far.', value: stats.funded, fmt: (n: number) => String(Math.round(n)) },
    { label: 'Breaches recorded', note: 'Every one stays on the public record.', value: stats.breaches, fmt: (n: number) => String(Math.round(n)) },
  ];
  const pending = stats.reserve === null;
  return (
    <section className="grid gap-12 px-4 py-28 md:grid-cols-2 md:px-10">
      <div>
        <span className="tag">Live numbers</span>
        <ScrollWords text="Read from the contract, not from us" className="mt-6 text-4xl font-medium tracking-tight md:text-5xl" />
        <Reveal><p className="mt-4 max-w-md text-mute">{pending ? 'These fill in once the contracts are deployed on testnet. Nothing here is a placeholder figure.' : 'Each figure below is a live view call to the Tenor contract.'}</p></Reveal>
        <div className="mt-10 grid grid-cols-2 border-t border-line">
          {items.map((it, i) => (
            <div key={it.label} className={`border-b border-line py-6 ${i % 2 ? 'pl-6' : 'border-r pr-6'}`}>
              <div className="num text-3xl md:text-4xl"><CountUp value={it.value} format={it.fmt} /></div>
              <div className="mt-2 text-sm">{it.label}</div>
              <div className="label mt-1">{it.note}</div>
            </div>
          ))}
        </div>
      </div>
      <Reveal className="self-center">
        <div className="panel rounded-2xl">
          <PriceArea symbol="BTC" />
        </div>
      </Reveal>
    </section>
  );
}

function Steps() {
  return (
    <section className="px-4 pb-28 md:px-10">
      <ScrollWords text="From first order to first payout" className="text-center text-4xl font-medium tracking-tight md:text-5xl" />
      <div className="mt-14 grid gap-4 md:grid-cols-4">
        {STEPS.map(([title, body], i) => (
          <Reveal key={title} delay={i * 0.08}>
            <article className="panel flex h-72 flex-col rounded-2xl">
              <span className="num text-3xl text-mute">0{i + 1}</span>
              <h3 className="mt-auto text-xl font-medium">{title}</h3>
              <p className="mt-2 text-sm text-mute">{body}</p>
            </article>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section className="mx-auto max-w-3xl px-4 pb-28">
      <h2 className="text-center text-4xl font-medium tracking-tight">Questions traders ask</h2>
      <ul className="mt-10 border-t border-line">
        {FAQ.map(([q, a], i) => (
          <li key={q} className="border-b border-line">
            <button className="flex min-h-16 w-full items-center justify-between gap-4 text-left" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>
              <span>{q}</span>
              <span className={`text-mute transition-transform ${open === i ? 'rotate-45' : ''}`} aria-hidden="true">+</span>
            </button>
            <AnimatePresence initial={false}>
              {open === i && (
                <motion.p initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden text-sm text-mute">
                  <span className="block pb-5">{a}</span>
                </motion.p>
              )}
            </AnimatePresence>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Closing() {
  return (
    <section className="px-4 pb-16 text-center md:px-10">
      <Reveal>
        <h2 className="chrome-text text-5xl font-medium tracking-tight md:text-7xl">Prove it. Get funded.</h2>
        <p className="mt-4 text-mute">One fee. No time limit. The rules are public.</p>
        <Link href="/challenges" className="pill mt-8">
          Buy a challenge
          <span className="pill-arrow"><ArrowIcon /></span>
        </Link>
      </Reveal>
      <footer className="mt-24 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-6 text-xs text-mute">
        <span className="inline-flex items-center gap-2 text-text"><MarkIcon size={18} /> Tenor</span>
        <span>Testnet software using mock assets. Not audited. Trading carries a risk of loss.</span>
        <a href="https://github.com/avishrakshe/Tenor" className="hover:text-text">GitHub</a>
      </footer>
    </section>
  );
}

export function Landing({ stats }: { stats: LiveStats }) {
  return (
    <>
      <Hero />
      <Story />
      <Features />
      <Tape />
      <Numbers stats={stats} />
      <Steps />
      <Faq />
      <Closing />
    </>
  );
}
