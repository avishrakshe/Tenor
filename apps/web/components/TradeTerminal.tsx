'use client';

import { MARKETS, bid, ask, market, evaluate, fillBuy, markValue, type Ruleset } from '@tenor/rules';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { priceUsd, readQuotes, usd, type LiveQuote, type Position } from '@/lib/chain';
import { CandleChart } from './Charts';
import { useSession } from './Session';
import { Notice, StatusBadge, usePoll } from './ui';

export type TerminalAccount = {
  title: string;
  status: string;
  reason: string | null;
  phase: 'one' | 'two' | 'funded';
  initial: bigint;
  dayStart: bigint;
  cash: bigint;
  positions: Position[];
  rules: Ruleset;
};

type Market = { last: number; changePct: number; volumeUsd: number };

const compact = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 });
const px = (n: number | null) => (n === null || !Number.isFinite(n) || n <= 0 ? 'N/A' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: n < 100 ? 4 : 2 }));

function Cell({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div className="shrink-0 border-l border-line px-4 first:border-0">
      <div className="label">{k}</div>
      <div className={`num text-sm ${tone ?? ''}`}>{v}</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between py-1 text-sm">
      <span className="text-mute">{k}</span>
      <span className="num">{v}</span>
    </div>
  );
}

function positionValue(p: Position, quotes: Record<string, LiveQuote> | null) {
  const q = quotes?.[p.symbol];
  return q ? markValue(BigInt(p.qty), q, market(p.symbol).decimals) : null;
}

/** Bid at which this position alone takes equity to `targetEquity`. */
function priceForEquity(a: TerminalAccount, p: Position, quotes: Record<string, LiveQuote> | null, targetEquity: bigint) {
  let others = a.cash;
  for (const o of a.positions) {
    if (o.symbol === p.symbol) continue;
    const v = positionValue(o, quotes);
    if (v === null) return null;
    others += v;
  }
  const units = Number(BigInt(p.qty)) / 10 ** market(p.symbol).decimals;
  return units > 0 ? Number(targetEquity - others) / 1e6 / units : null;
}

function limits(a: TerminalAccount) {
  const daily = a.dayStart - (a.initial * a.rules.dailyLossBps) / 10_000n;
  const dd = a.initial - (a.initial * a.rules.maxDrawdownBps) / 10_000n;
  const targetBps = a.phase === 'one' ? a.rules.phaseOneTargetBps : a.phase === 'two' ? a.rules.phaseTwoTargetBps : null;
  return {
    breachEquity: daily > dd ? daily : dd,
    passEquity: targetBps === null ? null : a.initial + (a.initial * targetBps) / 10_000n,
  };
}

export function TradeTerminal({
  account,
  canTrade,
  busy,
  message,
  gate,
  onBuy,
  onClose,
  actions,
  children,
  history,
}: {
  account: TerminalAccount | null;
  canTrade: boolean;
  busy: boolean;
  message: { tone: 'info' | 'error'; text: string } | null;
  gate?: React.ReactNode;
  onBuy: (symbol: string, usdc: string, tp: string | null, sl: string | null) => void;
  onClose: (symbol: string | null) => void;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  /** Whose signed transactions to list, and which contract they called. */
  history?: { account: string; receiver: string };
}) {
  const { config } = useSession();
  const [symbol, setSymbol] = useState('BTC');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [amount, setAmount] = useState('');
  const [pct, setPct] = useState(0);
  const [tpsl, setTpsl] = useState(false);
  const [tp, setTp] = useState('');
  const [sl, setSl] = useState('');
  const [tab, setTab] = useState<'positions' | 'history'>('positions');

  const quotesPoll = usePoll(() => (config.deployed ? readQuotes(config.rpc, config.stack.oracle) : Promise.resolve(null)), [config.deployed, config.stack.oracle], 4000);
  const quotes = quotesPoll.data;
  const mkt = usePoll<Market>(() => fetch(`/api/market?symbol=${symbol}`).then((r) => r.json()), [symbol], 15_000).data;
  const q = quotes?.[symbol] ?? null;

  const equity = useMemo(() => {
    if (!account) return null;
    let e = account.cash;
    for (const p of account.positions) {
      const v = positionValue(p, quotes ?? null);
      if (v === null) return null;
      e += v;
    }
    return e;
  }, [account, quotes]);

  const m = market(symbol);
  const position = account?.positions.find((p) => p.symbol === symbol) ?? null;
  const held = position ? (positionValue(position, quotes ?? null) ?? 0n) : 0n;
  const cap = equity === null ? null : (equity * m.capBps) / 10_000n;
  const maxSize = account && cap !== null ? (() => {
    const room = cap > held ? cap - held : 0n;
    return room < account.cash ? room : account.cash;
  })() : 0n;

  useEffect(() => {
    if (pct > 0) setAmount((Number(maxSize) / 1e6 * (pct / 100)).toFixed(2));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pct]);

  const micro = useMemo(() => {
    const n = Number(amount);
    return Number.isFinite(n) && n > 0 ? BigInt(Math.round(n * 1e6)) : 0n;
  }, [amount]);
  const preview = q && micro > 0n ? fillBuy(micro, q, m.decimals) : null;
  const toE8 = (s: string) => (s ? String(BigInt(Math.round(Number(s) * 1e8))) : null);
  const lim = account ? limits(account) : null;
  const previewEval = account && equity !== null ? evaluate({ phase: account.phase, initial: account.initial, dayStart: account.dayStart, equity }, account.rules) : null;
  const age = q ? Math.max(0, Math.round(Date.now() / 1000 - q.publishTime)) : null;
  const spreadPct = q ? (Number(ask(q) - bid(q)) / Number(q.priceE8)) * 100 : null;
  const pnlTotal = account && equity !== null ? equity - account.initial : null;
  const live = account?.status === 'Active';

  return (
    <div className="space-y-2">
      <div className="panel flex items-center gap-1 overflow-x-auto !p-3">
        <div className="flex shrink-0 gap-1 pr-3">
          {MARKETS.map((x) => (
            <button key={x.symbol} onClick={() => setSymbol(x.symbol)} aria-pressed={x.symbol === symbol} className={`num min-h-9 rounded-md px-3 text-sm ${x.symbol === symbol ? 'bg-text text-black' : 'text-mute hover:text-text'}`}>
              {x.symbol}
            </button>
          ))}
        </div>
        <Cell k="24h change" v={mkt ? `${mkt.changePct >= 0 ? '+' : ''}${mkt.changePct.toFixed(2)}%` : '—'} tone={mkt && mkt.changePct < 0 ? 'text-down' : 'text-up'} />
        <Cell k="Position cap" v={`${Number(m.capBps) / 100}% of equity`} />
        <Cell k="Market" v={px(mkt?.last ?? null)} />
        <Cell k="Oracle" v={q ? priceUsd(q.priceE8) : 'N/A'} />
        <Cell k="Oracle age" v={age === null ? 'N/A' : `${age}s`} tone={q && !q.fresh ? 'text-warn' : ''} />
        <Cell k="24h volume" v={mkt ? compact(mkt.volumeUsd) : '—'} />
        {account && (
          <div className="ml-auto flex shrink-0 items-center gap-3 pl-4">
            <span className="num text-sm">{account.title}</span>
            <StatusBadge status={account.status} />
            {account.reason && <span className="num text-sm text-down">{account.reason}</span>}
            {actions}
          </div>
        )}
      </div>

      {message && <div className="px-1"><Notice tone={message.tone}>{message.text}</Notice></div>}

      <div className="grid gap-2 xl:grid-cols-[1fr_240px_330px]">
        <section className="panel !p-0 overflow-hidden" aria-label="Price chart">
          <div className="h-[440px]"><CandleChart symbol={symbol} oraclePrice={q ? Number(q.priceE8) / 1e8 : null} /></div>
        </section>

        <section className="panel" aria-label="Oracle fill">
          <h2 className="text-sm font-semibold">Fill price</h2>
          <p className="label mt-1">Orders fill against the oracle, not an order book.</p>
          <div className="mt-4 space-y-1">
            <div className="flex justify-between rounded-md bg-down/10 px-3 py-2"><span className="label">Ask</span><span className="num text-sm text-down">{q ? priceUsd(ask(q)) : 'N/A'}</span></div>
            <div className="flex justify-between px-3 py-2"><span className="label">Spread</span><span className="num text-sm">{spreadPct === null ? 'N/A' : `${spreadPct.toFixed(3)}%`}</span></div>
            <div className="flex justify-between rounded-md bg-up/10 px-3 py-2"><span className="label">Bid</span><span className="num text-sm text-up">{q ? priceUsd(bid(q)) : 'N/A'}</span></div>
          </div>
          <div className="mt-4 border-t border-line pt-3">
            <Row k="Taker fee" v="0.05%" />
            <Row k="Max price age" v="60s" />
            <Row k="Status" v={!q ? 'No price' : q.fresh ? 'Fresh' : 'Stale, no fills'} />
          </div>
          {previewEval && (
            <div className="mt-4 border-t border-line pt-3 space-y-3">
              {previewEval.target && <MiniMeter label="Profit target" bps={previewEval.target.progressBps} tone="bg-up" caption={`${usd(previewEval.target.remaining)} left`} />}
              <MiniMeter label="Daily loss" bps={previewEval.daily.progressBps} tone="bg-down" caption={`${usd(previewEval.daily.remaining)} left`} />
              <MiniMeter label="Max drawdown" bps={previewEval.maxDrawdown.progressBps} tone="bg-down" caption={`${usd(previewEval.maxDrawdown.remaining)} left`} />
            </div>
          )}
        </section>

        <section className="panel xl:row-span-2" aria-label="Order ticket">
          <div className="seg">
            <button aria-pressed={side === 'buy'} onClick={() => setSide('buy')}>Buy</button>
            <button aria-pressed={side === 'sell'} onClick={() => setSide('sell')}>Sell / Close</button>
          </div>

          {side === 'buy' ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                onBuy(symbol, String(micro), tpsl ? toE8(tp) : null, tpsl ? toE8(sl) : null);
                setAmount('');
                setPct(0);
              }}
            >
              <label className="mt-6 block text-center">
                <span className="sr-only">Amount in USDC</span>
                <input className="num w-full bg-transparent text-center text-4xl outline-none placeholder:text-mute" inputMode="decimal" placeholder="0" value={amount} onChange={(e) => { setAmount(e.target.value); setPct(0); }} />
                <span className="text-sm text-mute">USDC</span>
              </label>
              <p className="num mt-1 text-center text-sm text-mute">{preview ? `≈ ${(Number(preview.out) / 10 ** m.decimals).toPrecision(6)} ${symbol}` : `0 ${symbol}`}</p>
              <div className="mt-4 flex items-center gap-3">
                <input type="range" min={0} max={100} value={pct} onChange={(e) => setPct(Number(e.target.value))} className="flex-1" aria-label="Percent of maximum size" />
                <span className="num w-10 text-right text-sm">{pct}%</span>
                <button type="button" className="num rounded-md border border-line px-2 py-1 text-xs text-mute hover:text-text" onClick={() => { setPct(100); setAmount((Number(maxSize) / 1e6).toFixed(2)); }}>MAX</button>
              </div>
              <div className="mt-4">
                <Row k="Available to trade" v={account ? usd(account.cash) : 'N/A'} />
                <Row k="Max size" v={account ? usd(maxSize) : 'N/A'} />
                <Row k="Current position" v={position ? `${(Number(position.qty) / 10 ** m.decimals).toPrecision(5)} ${symbol}` : `0 ${symbol}`} />
              </div>
              <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-line px-3 text-sm">
                <input type="checkbox" checked={tpsl} onChange={(e) => setTpsl(e.target.checked)} /> Take Profit / Stop Loss
              </label>
              {tpsl && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <input className="field num" placeholder="Take profit" aria-label="Take profit price" inputMode="decimal" value={tp} onChange={(e) => setTp(e.target.value)} />
                  <input className="field num" placeholder="Stop loss" aria-label="Stop loss price" inputMode="decimal" value={sl} onChange={(e) => setSl(e.target.value)} />
                </div>
              )}
              {gate ?? (
                <button className="btn mt-4 w-full" disabled={!canTrade || busy || micro === 0n || micro > maxSize}>
                  {busy ? 'Sending…' : `Buy ${symbol}`}
                </button>
              )}
            </form>
          ) : (
            <div className="mt-6">
              <p className="text-sm text-mute">Tenor is spot only: you can hold an asset or be flat, so selling closes your position.</p>
              <div className="mt-4">
                <Row k="Position" v={position ? `${(Number(position.qty) / 10 ** m.decimals).toPrecision(5)} ${symbol}` : 'None'} />
                <Row k="Value at bid" v={position ? usd(held) : 'N/A'} />
              </div>
              {gate ?? <button className="btn mt-4 w-full" disabled={!canTrade || busy || !position} onClick={() => onClose(symbol)}>Close {symbol}</button>}
            </div>
          )}

          <div className="mt-5 border-t border-line pt-3">
            <h3 className="mb-1 text-sm font-semibold">Account summary</h3>
            <Row k="Equity" v={equity === null ? 'N/A' : usd(equity)} />
            <Row k="Unrealised + realised P&L" v={pnlTotal === null ? 'N/A' : usd(pnlTotal)} />
            <Row k="Starting balance" v={account ? usd(account.initial, 0) : 'N/A'} />
            <Row k="Breach below equity" v={lim ? usd(lim.breachEquity) : 'N/A'} />
          </div>
        </section>

        <section className="panel !p-0 overflow-x-auto xl:col-span-2" aria-label="Positions">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div className="flex gap-4" role="tablist" aria-label="Account activity">
              {(['positions', 'history'] as const).map((t) => (
                <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`text-sm capitalize ${tab === t ? 'font-semibold text-text' : 'text-mute hover:text-text'}`}>
                  {t}
                </button>
              ))}
            </div>
            {tab === 'positions' && account && account.positions.length > 0 && <button className="text-sm text-mute underline underline-offset-2 hover:text-text" disabled={!canTrade || busy} onClick={() => onClose(null)}>Close next</button>}
          </div>
          {tab === 'history' ? (
            <History history={history} explorer={config.explorer} />
          ) : !account || account.positions.length === 0 ? (
            <p className="p-10 text-center text-sm text-mute">No positions found</p>
          ) : (
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="text-left text-mute">
                  {['Coin', 'Size', 'Value', 'Entry', 'Mark', 'P&L', 'Breach', 'Pass', 'TP/SL', ''].map((h) => <th key={h} className="px-4 py-2 font-normal">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {account.positions.map((p) => {
                  const mm = market(p.symbol);
                  const qq = quotes?.[p.symbol];
                  const value = positionValue(p, quotes ?? null);
                  const units = Number(BigInt(p.qty)) / 10 ** mm.decimals;
                  const pnl = value === null || BigInt(p.cost) === 0n ? null : value - BigInt(p.cost);
                  const l = limits(account);
                  return (
                    <tr key={p.symbol} className="num border-t border-line">
                      <td className="px-4 py-2">{p.symbol}</td>
                      <td className="px-4 py-2">{units.toPrecision(5)}</td>
                      <td className="px-4 py-2">{value === null ? 'N/A' : usd(value)}</td>
                      <td className="px-4 py-2">{BigInt(p.cost) > 0n ? px(Number(p.cost) / 1e6 / units) : 'N/A'}</td>
                      <td className="px-4 py-2">{qq ? priceUsd(bid(qq)) : 'N/A'}</td>
                      <td className={`px-4 py-2 ${pnl !== null && pnl < 0n ? 'text-down' : 'text-up'}`}>{pnl === null ? 'N/A' : usd(pnl)}</td>
                      <td className="px-4 py-2">{px(priceForEquity(account, p, quotes ?? null, l.breachEquity))}</td>
                      <td className="px-4 py-2">{l.passEquity === null ? 'None' : px(priceForEquity(account, p, quotes ?? null, l.passEquity))}</td>
                      <td className="px-4 py-2">{p.tp_e8 || p.sl_e8 ? `${p.tp_e8 ? px(Number(p.tp_e8) / 1e8) : '—'} / ${p.sl_e8 ? px(Number(p.sl_e8) / 1e8) : '—'}` : '—'}</td>
                      <td className="px-4 py-2 text-right"><button className="underline underline-offset-2" disabled={!canTrade || busy || !live} onClick={() => onClose(p.symbol)}>Close</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      </div>

      {children}

      <footer className="num flex flex-wrap gap-x-5 gap-y-1 px-2 py-1 text-xs text-mute">
        <span><span className={q?.fresh ? 'text-up' : 'text-warn'}>●</span> Oracle {!q ? 'unavailable' : q.fresh ? 'fresh' : 'stale'}</span>
        <span>NEAR {config.network}</span>
        <span>Charts show market data. Your fills use the onchain oracle.</span>
      </footer>
    </div>
  );
}

function MiniMeter({ label, bps, tone, caption }: { label: string; bps: bigint; tone: string; caption: string }) {
  return (
    <div>
      <div className="flex justify-between text-xs"><span>{label}</span><span className="num text-mute">{caption}</span></div>
      <div className="mt-1 h-1.5 rounded-sm bg-line" role="progressbar" aria-label={label} aria-valuenow={Number(bps) / 100} aria-valuemin={0} aria-valuemax={100}>
        <div className={`h-1.5 rounded-sm ${tone}`} style={{ width: `${Number(bps) / 100}%` }} />
      </div>
    </div>
  );
}

type HistoryRow = { hash: string; time: number; method: string; symbol: string | null; usdc: string | null; ok: boolean };

const ACTION_NAMES: Record<string, string> = { place_order: 'Buy', close_position: 'Close', request_payout: 'Payout', fund: 'Fund' };

function History({ history, explorer }: { history?: { account: string; receiver: string }; explorer: string | null }) {
  const data = usePoll<{ rows: HistoryRow[]; unavailable?: boolean } | null>(
    () => (history ? fetch(`/api/history?account=${encodeURIComponent(history.account)}&receiver=${encodeURIComponent(history.receiver)}`).then((r) => r.json()) : Promise.resolve(null)),
    [history?.account, history?.receiver],
    15_000,
  );
  if (!history) return <p className="p-10 text-center text-sm text-mute">Open an account to see its history.</p>;
  if (data.error) return <p className="p-6 text-sm text-down">{data.error}</p>;
  if (data.data?.unavailable) return <p className="p-10 text-center text-sm text-mute">History needs the public testnet indexer, so it isn't available on a local sandbox.</p>;
  const rows = data.data?.rows ?? [];
  if (rows.length === 0) return <p className="p-10 text-center text-sm text-mute">No transactions yet. New ones can take a moment to appear.</p>;
  return (
    <table className="w-full min-w-[620px] text-sm">
      <thead>
        <tr className="text-left text-mute">
          {['Time (UTC)', 'Action', 'Market', 'Amount', 'Result', 'Transaction'].map((h) => <th key={h} className="px-4 py-2 font-normal">{h}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.hash} className="num border-t border-line">
            <td className="px-4 py-2">{new Date(r.time * 1000).toISOString().slice(5, 19).replace('T', ' ')}</td>
            <td className="px-4 py-2">{ACTION_NAMES[r.method] ?? r.method}</td>
            <td className="px-4 py-2">{r.symbol ?? '—'}</td>
            <td className="px-4 py-2">{r.usdc ? usd(r.usdc) : '—'}</td>
            <td className={`px-4 py-2 ${r.ok ? 'text-up' : 'text-down'}`}>{r.ok ? 'Confirmed' : 'Failed'}</td>
            <td className="px-4 py-2">{explorer ? <a className="underline underline-offset-2" href={`${explorer}/txns/${r.hash}`}>{r.hash.slice(0, 8)}…</a> : `${r.hash.slice(0, 8)}…`}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function BuyGate() {
  return <Link href="/challenges" className="btn mt-4 w-full">Buy a challenge to trade</Link>;
}
