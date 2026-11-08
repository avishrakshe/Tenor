'use client';

import { parseProduct, ruleset } from '@tenor/rules';
import { KeyPair } from 'near-api-js';
import Link from 'next/link';
import { use, useState } from 'react';
import { useSession, writeStore } from '@/components/Session';
import { Objectives, OrderForm, Positions, PricePanel, equityOf } from '@/components/Terminal';
import { Notice, Stat, StatusBadge, usePoll } from '@/components/ui';
import { readQuotes, usd, view, type Challenge } from '@/lib/chain';

const NEAR_BUDGET_FALLBACK = '1000000000000000000000000';

export default function Trade({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId: idParam } = use(params);
  const id = Number(idParam);
  const { config, accountId, send, signIn } = useSession();
  const tenor = config.stack.tenor;
  const [symbol, setSymbol] = useState('BTC');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);

  const challenge = usePoll(() => view<Challenge | null>(config.rpc, tenor, 'get_challenge', { id }), [tenor, id], 4000);
  const quotes = usePoll(() => readQuotes(config.rpc, config.stack.oracle), [config.stack.oracle], 4000);

  const c = challenge.data;

  async function act(ok: string, fn: () => Promise<unknown>) {
    if (!accountId) return signIn();
    setBusy(true);
    setMsg(null);
    try {
      const r = (await fn()) as { status?: { Failure?: unknown } };
      setMsg(r?.status?.Failure ? { tone: 'error', text: JSON.stringify(r.status.Failure).slice(0, 200) } : { tone: 'info', text: ok });
    } catch (e) {
      setMsg({ tone: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  if (challenge.error) return <Notice tone="error">{challenge.error}</Notice>;
  if (!c) return <Notice>{challenge.data === null ? 'Loading…' : 'Challenge not found.'}</Notice>;

  const product = parseProduct(c.product);
  const rules = ruleset(product.plan, product.twoStep);
  const equity = equityOf(c.cash, c.positions, quotes.data);
  const owner = accountId === c.owner;
  const active = c.status === 'Active';

  const buy = (usdc: string, tp: string | null, sl: string | null) =>
    act('Order sent. The contract filled or rejected it; see the book below.', () =>
      send({ receiverId: tenor, method: 'place_order', args: { challenge_id: id, symbol, usdc, tp_e8: tp, sl_e8: sl } }),
    );

  const close = (s: string) =>
    act('Position closed.', () => send({ receiverId: tenor, method: 'close_position', args: { challenge_id: id, symbol: s } }));

  const poke = () =>
    act('Rules applied.', () => send({ receiverId: tenor, method: 'poke', args: { account: String(id) } }));

  async function fund() {
    const key = KeyPair.fromRandom('ed25519');
    const pub = key.getPublicKey().toString();
    // The trader key stays in this browser. Tenor never sees the private half.
    writeStore(`tenor.trader.${id}`, key.toString());
    const cfg = await view<{ guard_near_budget: string }>(config.rpc, tenor, 'get_config');
    await act('Funding transaction sent. The Guard appears here when it finishes.', () =>
      send({
        receiverId: tenor,
        method: 'fund',
        args: { challenge_id: id, trader_public_key: pub },
        deposit: cfg.guard_near_budget ?? NEAR_BUDGET_FALLBACK,
      }),
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="num text-xl font-semibold">
          #{c.id} {c.product}
        </h1>
        <StatusBadge status={c.status} />
        {product.twoStep && <span className="label">Phase {c.phase} of 2</span>}
        {c.breach_reason && <span className="num text-sm text-down">{c.breach_reason}</span>}
        <button className="btn btn-ghost ml-auto" onClick={poke} disabled={busy || !active} title="Anyone can apply the rules to any account">
          Apply rules now
        </button>
      </div>

      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {quotes.error && <Notice tone="error">Oracle unreadable: {quotes.error}</Notice>}

      {c.status === 'Passed' && (
        <div className="panel flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">Passed. Funding deploys your Guard account and generates your trade-only key in this browser.</p>
          <button className="btn" onClick={fund} disabled={busy || !owner}>
            Fund account
          </button>
        </div>
      )}
      {c.guard && (
        <Link className="btn" href={`/funded/${c.guard}`}>
          Go to funded account
        </Link>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <PricePanel quotes={quotes.data} symbol={symbol} onSymbol={setSymbol} />
        <OrderForm symbol={symbol} equity={equity} cash={BigInt(c.cash)} disabled={busy || !active || !owner} onBuy={buy} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="panel space-y-4" aria-label="Account">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Equity" value={equity === null ? '—' : usd(equity)} />
            <Stat label="Cash" value={usd(c.cash)} />
            <Stat label="Start" value={usd(c.initial_balance, 0)} />
          </div>
          <Positions positions={c.positions} quotes={quotes.data} disabled={busy || !active || !owner} onClose={close} />
        </section>
        <section className="panel" aria-label="Objectives">
          <Objectives
            phase={c.phase === 2 ? 'two' : 'one'}
            initial={BigInt(c.initial_balance)}
            dayStart={BigInt(c.day_start_equity)}
            equity={active ? equity : BigInt(c.cash)}
            rules={rules}
          />
        </section>
      </div>
    </div>
  );
}
