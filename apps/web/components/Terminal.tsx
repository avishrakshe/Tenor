'use client';

import { MARKETS, bid, evaluate, markValue, market, type Quote } from '@tenor/rules';
import { useEffect, useMemo, useState } from 'react';
import { priceUsd, usd, type LiveQuote, type Position } from '@/lib/chain';
import { Meter, Notice, Spark, Stat } from './ui';

export function equityOf(cash: string, positions: Position[], quotes: Record<string, Quote> | null): bigint | null {
  if (!quotes) return null;
  let equity = BigInt(cash);
  for (const p of positions) {
    const q = quotes[p.symbol];
    if (!q) return null;
    equity += markValue(BigInt(p.qty), q, market(p.symbol).decimals);
  }
  return equity;
}

export function Objectives(props: {
  phase: 'one' | 'two' | 'funded';
  initial: bigint;
  dayStart: bigint;
  equity: bigint | null;
  rules: Parameters<typeof evaluate>[1];
}) {
  const { phase, initial, dayStart, equity, rules } = props;
  if (equity === null) return <Notice>Waiting for oracle prices.</Notice>;
  const e = evaluate({ phase, initial, dayStart, equity }, rules);
  const remaining = (x: bigint) => `${usd(x)} left`;
  return (
    <div className="space-y-4">
      {e.target && <Meter label="Profit target" tone="up" progressBps={e.target.progressBps} caption={remaining(e.target.remaining)} />}
      <Meter label="Daily loss" tone="down" progressBps={e.daily.progressBps} caption={remaining(e.daily.remaining)} />
      <Meter label="Max drawdown" tone="down" progressBps={e.maxDrawdown.progressBps} caption={remaining(e.maxDrawdown.remaining)} />
    </div>
  );
}

export function usePriceSeries(quotes: Record<string, LiveQuote> | null, symbol: string) {
  const [series, setSeries] = useState<Record<string, number[]>>({});
  useEffect(() => {
    if (!quotes) return;
    setSeries((prev) => {
      const next = { ...prev };
      for (const [s, q] of Object.entries(quotes)) next[s] = [...(next[s] ?? []), Number(q.priceE8) / 1e8].slice(-240);
      return next;
    });
  }, [quotes]);
  return series[symbol] ?? [];
}

export function PricePanel({
  quotes,
  symbol,
  onSymbol,
}: {
  quotes: Record<string, LiveQuote> | null;
  symbol: string;
  onSymbol: (s: string) => void;
}) {
  const points = usePriceSeries(quotes, symbol);
  const q = quotes?.[symbol];
  return (
    <div className="panel">
      <div className="flex flex-wrap items-center gap-2">
        {MARKETS.map((m) => (
          <button key={m.symbol} onClick={() => onSymbol(m.symbol)} aria-pressed={m.symbol === symbol} className={`btn ${m.symbol === symbol ? '' : 'btn-ghost'}`}>
            {m.symbol}
          </button>
        ))}
        <span className="num ml-auto text-lg">{q ? priceUsd(q.priceE8) : '—'}</span>
      </div>
      <div className="mt-3">
        <Spark points={points} label={`${symbol} oracle price since this page opened`} />
      </div>
      <p className="label mt-1">
        Onchain oracle price since this page opened.{' '}
        {q && !q.fresh && <span className="text-warn">Price is older than 60s: no fills and no breaches until it updates.</span>}
      </p>
    </div>
  );
}

export function OrderForm({
  symbol,
  equity,
  cash,
  disabled,
  onBuy,
}: {
  symbol: string;
  equity: bigint | null;
  cash: bigint;
  disabled: boolean;
  onBuy: (usdcMicro: string, tpE8: string | null, slE8: string | null) => void;
}) {
  const [amount, setAmount] = useState('1000');
  const [tp, setTp] = useState('');
  const [sl, setSl] = useState('');
  const micro = useMemo(() => {
    const n = Number(amount);
    return Number.isFinite(n) && n > 0 ? BigInt(Math.round(n * 1e6)) : 0n;
  }, [amount]);
  const cap = equity === null ? null : (equity * market(symbol).capBps) / 10_000n;
  const toE8 = (s: string) => (s ? String(BigInt(Math.round(Number(s) * 1e8))) : null);
  return (
    <form
      className="panel space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onBuy(String(micro), toE8(tp), toE8(sl));
      }}
    >
      <h2 className="text-sm font-semibold">Buy {symbol}</h2>
      <div>
        <label className="label" htmlFor="amt">
          Amount (USDC, fee included)
        </label>
        <input id="amt" className="field num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <p className="label num mt-1">
          Cash {usd(cash)} · Cap {cap === null ? '—' : usd(cap)}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label" htmlFor="tp">
            Take profit (optional)
          </label>
          <input id="tp" className="field num" inputMode="decimal" value={tp} onChange={(e) => setTp(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="sl">
            Stop loss (optional)
          </label>
          <input id="sl" className="field num" inputMode="decimal" value={sl} onChange={(e) => setSl(e.target.value)} />
        </div>
      </div>
      <button className="btn w-full" disabled={disabled || micro === 0n}>
        Place order
      </button>
    </form>
  );
}

export function Positions({
  positions,
  quotes,
  disabled,
  onClose,
}: {
  positions: Position[];
  quotes: Record<string, Quote> | null;
  disabled: boolean;
  onClose: (symbol: string) => void;
}) {
  if (!positions.length) return <p className="text-sm text-mute">No open positions.</p>;
  return (
    <ul className="space-y-2">
      {positions.map((p) => {
        const q = quotes?.[p.symbol];
        const m = market(p.symbol);
        const value = q ? markValue(BigInt(p.qty), q, m.decimals) : null;
        const pnl = value === null ? null : value - BigInt(p.cost);
        return (
          <li key={p.symbol} className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <span className="num">
              {p.symbol} · {q ? priceUsd(bid(q)) : '—'}
            </span>
            <Stat label="Value" value={value === null ? '—' : usd(value)} />
            <Stat label="P&L" value={pnl === null ? '—' : usd(pnl)} tone={pnl !== null && pnl < 0n ? 'down' : 'up'} />
            <button className="btn btn-ghost" disabled={disabled} onClick={() => onClose(p.symbol)}>
              Close
            </button>
          </li>
        );
      })}
    </ul>
  );
}
