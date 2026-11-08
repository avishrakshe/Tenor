'use client';

import { parseProduct, ruleset } from '@tenor/rules';
import { KeyPair } from 'near-api-js';
import { useRouter } from 'next/navigation';
import { use, useEffect, useState } from 'react';
import { useSession, writeStore } from '@/components/Session';
import { TradeTerminal } from '@/components/TradeTerminal';
import { Notice, usePoll } from '@/components/ui';
import { view, type Challenge } from '@/lib/chain';

type Msg = { tone: 'info' | 'error'; text: string } | null;

export default function Trade({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId: idParam } = use(params);
  const id = Number(idParam);
  const { config, accountId, send } = useSession();
  const tenor = config.stack.tenor;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const challenge = usePoll(() => view<Challenge | null>(config.rpc, tenor, 'get_challenge', { id }), [tenor, id], 4000);
  const c = challenge.data;

  useEffect(() => {
    if (c?.guard) router.replace(`/funded/${c.guard}`);
  }, [c?.guard, router]);

  async function act(ok: string, fn: () => Promise<unknown>) {
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
  if (!c) return <div className="p-6"><Notice>Loading…</Notice></div>;

  const p = parseProduct(c.product);
  const owner = accountId === c.owner;

  async function fund() {
    const key = KeyPair.fromRandom('ed25519');
    // The trader key stays in this browser. Tenor never sees the private half.
    writeStore(`tenor.trader.${id}`, key.toString());
    const cfg = await view<{ guard_near_budget: string }>(config.rpc, tenor, 'get_config');
    await act('Funding sent. Your Guard account opens here when it finishes.', () =>
      send({ receiverId: tenor, method: 'fund', args: { challenge_id: id, trader_public_key: key.getPublicKey().toString() }, deposit: cfg.guard_near_budget }),
    );
  }

  return (
    <TradeTerminal
      account={{
        title: `#${c.id} ${c.product}${p.twoStep ? ` · Phase ${c.phase}` : ''}`,
        status: c.status,
        reason: c.breach_reason,
        phase: c.phase === 2 ? 'two' : 'one',
        initial: BigInt(c.initial_balance),
        dayStart: BigInt(c.day_start_equity),
        cash: BigInt(c.cash),
        positions: c.positions,
        rules: ruleset(p.plan, p.twoStep),
      }}
      canTrade={owner && c.status === 'Active'}
      busy={busy}
      message={msg}
      onBuy={(symbol, usdc, tp, sl) =>
        act('Sent. The contract filled or rejected it; the book updates below.', () =>
          send({ receiverId: tenor, method: 'place_order', args: { challenge_id: id, symbol, usdc, tp_e8: tp, sl_e8: sl } }),
        )
      }
      onClose={(symbol) => {
        const target = symbol ?? c.positions[0]?.symbol;
        if (target) act('Position closed.', () => send({ receiverId: tenor, method: 'close_position', args: { challenge_id: id, symbol: target } }));
      }}
      actions={
        c.status === 'Passed' ? (
          <button className="btn !min-h-9" onClick={fund} disabled={busy || !owner}>Fund account</button>
        ) : (
          <button className="btn btn-ghost !min-h-9" disabled={busy || c.status !== 'Active'} title="Anyone can apply the rules to any account" onClick={() => act('Rules applied.', () => send({ receiverId: tenor, method: 'poke', args: { account: String(id) } }))}>
            Apply rules
          </button>
        )
      }
    />
  );
}
