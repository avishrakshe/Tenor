'use client';

import { useEffect, useState } from 'react';
import { subscribeTicks } from '@/lib/live';
import { fmtPrice, priceDigits } from './MarketPicker';
import { usePoll } from './ui';

type Book = { asks: [number, number][]; bids: [number, number][] };
type Print = { id: number; price: number; size: number; time: number; up: boolean };

const SIZE_DIGITS: Record<string, number> = { BTC: 4, ETH: 3, SOL: 2, NEAR: 1 };

/** Market depth and recent trades for reference. Tenor orders fill at the oracle price shown underneath. */
export function OrderBook({ symbol, oracleAsk, oracleBid, fresh }: { symbol: string; oracleAsk: string | null; oracleBid: string | null; fresh: boolean }) {
  const [tab, setTab] = useState<'book' | 'trades'>('book');
  return (
    <section className="panel flex h-[480px] flex-col !p-0 overflow-hidden" aria-label="Order book and trades">
      <div className="flex gap-6 border-b border-line px-4" role="tablist" aria-label="Market activity">
        {(['book', 'trades'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 py-3 text-sm capitalize ${tab === t ? 'border-text font-semibold text-text' : 'border-transparent text-mute hover:text-text'}`}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === 'book' ? <Depth key={symbol} symbol={symbol} /> : <Trades symbol={symbol} />}
      <div className="border-t border-line px-4 py-2.5 text-xs">
        <div className="flex justify-between text-mute">
          <span>Your fills (oracle)</span>
          <span className={fresh ? 'text-up' : 'text-warn'}>{fresh ? 'Fresh' : 'Stale'}</span>
        </div>
        <div className="num mt-1 flex justify-between">
          <span>Ask <span className="text-down">{oracleAsk ?? 'N/A'}</span></span>
          <span>Bid <span className="text-up">{oracleBid ?? 'N/A'}</span></span>
        </div>
      </div>
    </section>
  );
}

function Depth({ symbol }: { symbol: string }) {
  const { data, error } = usePoll<Book>(
    () => fetch(`/api/book?symbol=${symbol}`).then(async (r) => {
      const body = await r.json();
      if (!r.ok) throw new Error(body.message ?? `HTTP ${r.status}`);
      return body;
    }),
    [symbol],
    2000,
  );
  if (error && !data) return <p className="flex-1 p-6 text-sm text-mute">Order book unavailable. {error}</p>;
  if (!data) return <p className="flex-1 p-6 text-sm text-mute">Loading book…</p>;

  const sd = SIZE_DIGITS[symbol] ?? 4;
  const cumulative = (rows: [number, number][]) => {
    let t = 0;
    return rows.map(([p, s]) => ({ p, s, t: (t += s) }));
  };
  const asks = cumulative(data.asks);
  const bids = cumulative(data.bids);
  const max = Math.max(asks.at(-1)?.t ?? 0, bids.at(-1)?.t ?? 0) || 1;
  const bestAsk = data.asks[0]?.[0];
  const bestBid = data.bids[0]?.[0];
  const digits = priceDigits(bestAsk ?? bestBid ?? 1);
  const row = (r: { p: number; s: number; t: number }, side: 'ask' | 'bid') => (
    <div key={`${side}${r.p}`} className="num relative grid h-[22px] shrink-0 grid-cols-3 items-center px-4 text-xs">
      <div className={`absolute inset-y-0 right-0 ${side === 'ask' ? 'bg-down/12' : 'bg-up/12'}`} style={{ width: `${(r.t / max) * 100}%` }} />
      <span className={`relative ${side === 'ask' ? 'text-down' : 'text-up'}`}>{fmtPrice(r.p, digits)}</span>
      <span className="relative text-right">{r.s.toFixed(sd)}</span>
      <span className="relative text-right text-mute">{r.t.toFixed(sd)}</span>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid grid-cols-3 px-4 py-2 text-xs text-mute">
        <span>Price</span>
        <span className="text-right">Size ({symbol})</span>
        <span className="text-right">Total</span>
      </div>
      {/* Lowest ask sits next to the spread; extra levels are clipped away from it. */}
      <div className="flex min-h-0 flex-1 flex-col-reverse overflow-hidden">{asks.map((r) => row(r, 'ask'))}</div>
      <div className="num flex items-center justify-between border-y border-line bg-raised/40 px-4 py-1.5 text-xs">
        <span className="text-mute">Spread</span>
        <span>{bestAsk !== undefined && bestBid !== undefined ? `${fmtPrice(bestAsk - bestBid, digits)} · ${(((bestAsk - bestBid) / bestAsk) * 100).toFixed(3)}%` : '—'}</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{bids.map((r) => row(r, 'bid'))}</div>
    </div>
  );
}

function Trades({ symbol }: { symbol: string }) {
  const [prints, setPrints] = useState<Print[]>([]);
  useEffect(() => {
    setPrints([]);
    let pending: Print[] = [];
    let last: number | null = null;
    let n = 0;
    const off = subscribeTicks(symbol, (t) => {
      pending.push({ id: n++, price: t.price, size: t.size, time: t.time, up: last === null || t.price >= last });
      last = t.price;
    });
    const id = setInterval(() => {
      if (pending.length === 0) return;
      const batch = pending.reverse();
      pending = [];
      setPrints((prev) => [...batch, ...prev].slice(0, 40));
    }, 250);
    return () => {
      clearInterval(id);
      off();
    };
  }, [symbol]);

  const sd = SIZE_DIGITS[symbol] ?? 4;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid grid-cols-3 px-4 py-2 text-xs text-mute">
        <span>Price</span>
        <span className="text-right">Size ({symbol})</span>
        <span className="text-right">Time</span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {prints.length === 0 && <p className="px-4 py-6 text-sm text-mute">Waiting for trades…</p>}
        {prints.map((p) => (
          <div key={p.id} className="num grid h-[22px] grid-cols-3 items-center px-4 text-xs">
            <span className={p.up ? 'text-up' : 'text-down'}>{fmtPrice(p.price)}</span>
            <span className="text-right">{p.size.toFixed(sd)}</span>
            <span className="text-right text-mute">{new Date(p.time * 1000).toLocaleTimeString('en-GB', { hour12: false })}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
