'use client';

import { bid, ask, market, evaluate, fillBuy, markValue, type Ruleset } from '@tenor/rules';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useLiveTick } from '@/lib/live';
import { readAccounts, type AccountRow } from '@/lib/accounts';
import { priceUsd, readQuotes, usd, type LiveQuote, type Position } from '@/lib/chain';
import { CandleChart } from './Charts';
import { MarketPicker } from './MarketPicker';
import { OrderBook } from './OrderBook';
import { DemoPrices, usePriceKeeper } from './PriceKeeper';
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

/** Bid at which this market takes equity to `targetEquity`. Every trade in it moves together. */
function priceForEquity(a: TerminalAccount, p: Position, quotes: Record<string, LiveQuote> | null, targetEquity: bigint) {
  let others = a.cash;
  for (const o of a.positions) {
    if (o.symbol === p.symbol) continue;
    const v = positionValue(o, quotes);
    if (v === null) return null;
    others += v;
  }
  const qty = a.positions.filter((o) => o.symbol === p.symbol).reduce((s, o) => s + BigInt(o.qty), 0n);
  const units = Number(qty) / 10 ** market(p.symbol).decimals;
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
  /** `qty` picks one trade, because each order is its own position. */
  onClose: (symbol: string | null, qty?: string) => void;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  /** Whose signed transactions to list, and which contract they called. */
  history?: { account: string; receiver: string };
}) {
  const { config } = useSession();
  const keeper = usePriceKeeper();
  const { demo, move, setMove } = keeper;
  // A funded account should start from market price, not from the move that passed it.
  useEffect(() => {
    if (demo && account?.status === 'Passed' && move !== 1) setMove(1);
  }, [demo, account?.status, move, setMove]);
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
  const polled = usePoll<Market>(() => fetch(`/api/market?symbol=${symbol}`).then((r) => r.json()), [symbol], 60_000).data;
  const tick = useLiveTick(symbol);
  const mkt: Market | null = tick
    ? { last: tick.price, changePct: ((tick.price - tick.open24) / tick.open24) * 100, volumeUsd: tick.volume24 * tick.price }
    : polled;
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
  const trades = account?.positions.filter((p) => p.symbol === symbol) ?? [];
  const heldQty = trades.reduce((s, p) => s + BigInt(p.qty), 0n);
  const held = q && heldQty > 0n ? markValue(heldQty, q, m.decimals) : 0n;
  const heldLabel = `${(Number(heldQty) / 10 ** m.decimals).toPrecision(5)} ${symbol}${trades.length > 1 ? ` in ${trades.length} trades` : ''}`;
  const cap = equity === null ? null : (equity * m.capBps) / 10_000n;
  const maxSize = account && cap !== null ? (() => {
    const room = cap > held ? cap - held : 0n;
    return room < account.cash ? room : account.cash;
  })() : 0n;

  const micro = useMemo(() => {
    const n = Number(amount);
    return Number.isFinite(n) && n > 0 ? BigInt(Math.round(n * 1e6)) : 0n;
  }, [amount]);
  const preview = q && micro > 0n ? fillBuy(micro, q, m.decimals) : null;
  const toE8 = (s: string) => (s ? String(BigInt(Math.round(Number(s) * 1e8))) : null);
  const lim = account ? limits(account) : null;
  const previewEval = account && equity !== null ? evaluate({ phase: account.phase, initial: account.initial, dayStart: account.dayStart, equity }, account.rules) : null;
  const age = q ? Math.max(0, Math.round(Date.now() / 1000 - q.publishTime)) : null;
  const pnlTotal = account && equity !== null ? equity - account.initial : null;
  const live = account?.status === 'Active';
  const setPercent = (v: number) => {
    setPct(v);
    if (v === 0) setAmount('');
    else setAmount((Number(maxSize) / 1e6 * (v / 100)).toFixed(2));
  };

  return (
    <div className="space-y-2">
      <div className="panel flex items-center gap-1 overflow-x-auto !p-3">
        <div className="shrink-0 pr-3">
          <MarketPicker symbol={symbol} onSelect={(s) => { setSymbol(s); setAmount(''); setPct(0); }} />
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
      {keeper.problem && <div className="px-1"><Notice tone="error">{keeper.problem} Orders cannot fill until prices are updated.</Notice></div>}
      {demo && <DemoPrices move={move} setMove={setMove} />}

      <div className="grid gap-2 xl:grid-cols-[1fr_280px_360px]">
        <section className="panel h-[480px] !p-0 overflow-hidden" aria-label="Price chart">
          <CandleChart symbol={symbol} oraclePrice={q ? Number(q.priceE8) / 1e8 : null} />
        </section>

        <OrderBook symbol={symbol} oracleAsk={q ? priceUsd(ask(q)) : null} oracleBid={q ? priceUsd(bid(q)) : null} fresh={!!q?.fresh} />

        <section className="panel !p-0 xl:row-span-2" aria-label="Order ticket">
          <AccountSelect />

          <div className="p-5">
            <div className="grid grid-cols-2 gap-1 rounded-xl border border-line bg-[#08090a] p-1">
              <button type="button" aria-pressed={side === 'buy'} onClick={() => setSide('buy')} className={`h-11 rounded-lg text-[15px] font-semibold transition-colors ${side === 'buy' ? 'bg-up/15 text-up' : 'text-mute hover:text-text'}`}>Buy</button>
              <button type="button" aria-pressed={side === 'sell'} onClick={() => setSide('sell')} className={`h-11 rounded-lg text-[15px] font-semibold transition-colors ${side === 'sell' ? 'bg-down/15 text-down' : 'text-mute hover:text-text'}`}>Sell / Close</button>
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
                <div className="mt-5 flex justify-between text-sm text-mute">
                  <label htmlFor="order-size">Size (USD)</label>
                  <span>Market order</span>
                </div>
                <div className="mt-2 flex h-14 items-center gap-3 rounded-xl border border-line bg-[#08090a] px-4 focus-within:border-mute">
                  <input id="order-size" className="num min-w-0 flex-1 bg-transparent text-lg outline-none placeholder:text-mute" inputMode="decimal" placeholder="0" value={amount} onChange={(e) => { setAmount(e.target.value); setPct(0); }} />
                  <span className="text-sm text-mute">USDC</span>
                </div>
                <p className="num mt-2 text-xs text-mute">≈ {preview ? (Number(preview.out) / 10 ** m.decimals).toPrecision(6) : '0'} {symbol}</p>

                <input type="range" min={0} max={100} value={pct} onChange={(e) => setPercent(Number(e.target.value))} className="range mt-4 w-full" style={{ '--pct': `${pct}%` } as React.CSSProperties} aria-label="Percent of maximum size" aria-valuetext={`${pct}% of max size`} />
                <div className="num mt-1 flex justify-between text-xs text-mute">
                  {[0, 25, 50, 75, 100].map((v) => (
                    <button key={v} type="button" onClick={() => setPercent(v)} className={`py-1 hover:text-text ${pct === v ? 'text-text' : ''}`}>{v}%</button>
                  ))}
                </div>

                <div className="mt-3">
                  <Row k="Available to trade" v={account ? usd(account.cash) : 'N/A'} />
                  <Row k="Max size" v={account ? usd(maxSize) : 'N/A'} />
                  <Row k="Current position" v={trades.length ? heldLabel : `0 ${symbol}`} />
                  <Row k="Taker fee" v="0.05%" />
                </div>

                <label className="mt-3 flex min-h-10 cursor-pointer items-center gap-3 text-[15px]">
                  <input type="checkbox" className="size-4 accent-up" checked={tpsl} onChange={(e) => setTpsl(e.target.checked)} /> Take profit / Stop loss
                </label>
                {tpsl && (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <input className="field num !rounded-xl" placeholder="Take profit" aria-label="Take profit price" inputMode="decimal" value={tp} onChange={(e) => setTp(e.target.value)} />
                    <input className="field num !rounded-xl" placeholder="Stop loss" aria-label="Stop loss price" inputMode="decimal" value={sl} onChange={(e) => setSl(e.target.value)} />
                  </div>
                )}
                {gate ?? (
                  <button className="btn mt-4 !min-h-12 w-full !rounded-2xl !bg-up text-[15px]" disabled={!canTrade || busy || micro === 0n || micro > maxSize || !q?.fresh}>
                    {busy ? 'Sending…' : q?.fresh ? `Buy ${symbol}` : 'Waiting for a fresh price'}
                  </button>
                )}
              </form>
            ) : (
              <div className="mt-5">
                <p className="text-sm text-mute">Tenor is spot only: selling closes a trade. Every buy is its own trade, so use the table below to close a specific one.</p>
                <div className="mt-4">
                  <Row k="Position" v={trades.length ? heldLabel : 'None'} />
                  <Row k="Value at bid" v={trades.length ? usd(held) : 'N/A'} />
                </div>
                {gate ?? <button className="btn mt-4 !min-h-12 w-full !rounded-2xl !bg-down text-[15px]" disabled={!canTrade || busy || !trades.length || !q?.fresh} onClick={() => onClose(symbol, trades[0].qty)}>{q?.fresh || !trades.length ? `Close ${trades.length > 1 ? 'oldest ' : ''}${symbol}${trades.length > 1 ? ' trade' : ''}` : 'Waiting for a fresh price'}</button>}
              </div>
            )}

            <div className="mt-5 border-t border-line pt-3">
              <h3 className="mb-1 text-sm font-semibold">Account summary</h3>
              <Row k="Equity" v={equity === null ? 'N/A' : usd(equity)} />
              <Row k="Unrealised + realised P&L" v={pnlTotal === null ? 'N/A' : usd(pnlTotal)} />
              <Row k="Starting balance" v={account ? usd(account.initial, 0) : 'N/A'} />
              <Row k="Breach below equity" v={lim ? usd(lim.breachEquity) : 'N/A'} />
            </div>
            {previewEval && (
              <div className="mt-4 space-y-3 border-t border-line pt-3">
                {previewEval.target && <MiniMeter label="Profit target" bps={previewEval.target.progressBps} tone="bg-up" caption={`${usd(previewEval.target.remaining)} left`} />}
                <MiniMeter label="Daily loss" bps={previewEval.daily.progressBps} tone="bg-down" caption={`${usd(previewEval.daily.remaining)} left`} />
                <MiniMeter label="Max drawdown" bps={previewEval.maxDrawdown.progressBps} tone="bg-down" caption={`${usd(previewEval.maxDrawdown.remaining)} left`} />
              </div>
            )}
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
            {tab === 'positions' && account && account.positions.length > 0 && <button className="text-sm text-mute underline underline-offset-2 hover:text-text" disabled={!canTrade || busy} onClick={() => onClose(account.positions[0].symbol, account.positions[0].qty)}>Close oldest</button>}
          </div>
          {tab === 'history' ? (
            <History history={history} explorer={config.explorer} />
          ) : !account || account.positions.length === 0 ? (
            <p className="p-10 text-center text-sm text-mute">No positions found</p>
          ) : (
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="text-left text-mute">
                  {['Trade', 'Coin', 'Size', 'Value', 'Entry', 'Mark', 'P&L', 'Breach', 'Pass', 'TP/SL', ''].map((h) => <th key={h} className="px-4 py-2 font-normal">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {account.positions.map((p, i) => {
                  const mm = market(p.symbol);
                  const qq = quotes?.[p.symbol];
                  const value = positionValue(p, quotes ?? null);
                  const units = Number(BigInt(p.qty)) / 10 ** mm.decimals;
                  const pnl = value === null || BigInt(p.cost) === 0n ? null : value - BigInt(p.cost);
                  const l = limits(account);
                  return (
                    <tr key={`${p.symbol}-${p.qty}-${i}`} className="num border-t border-line">
                      <td className="px-4 py-2 text-mute">#{i + 1}</td>
                      <td className="px-4 py-2">{p.symbol}</td>
                      <td className="px-4 py-2">{units.toPrecision(5)}</td>
                      <td className="px-4 py-2">{value === null ? 'N/A' : usd(value)}</td>
                      <td className="px-4 py-2">{BigInt(p.cost) > 0n ? px(Number(p.cost) / 1e6 / units) : 'N/A'}</td>
                      <td className="px-4 py-2">{qq ? priceUsd(bid(qq)) : 'N/A'}</td>
                      <td className={`px-4 py-2 ${pnl !== null && pnl < 0n ? 'text-down' : 'text-up'}`}>{pnl === null ? 'N/A' : usd(pnl)}</td>
                      <td className="px-4 py-2">{px(priceForEquity(account, p, quotes ?? null, l.breachEquity))}</td>
                      <td className="px-4 py-2">{l.passEquity === null ? 'None' : px(priceForEquity(account, p, quotes ?? null, l.passEquity))}</td>
                      <td className="px-4 py-2">{p.tp_e8 || p.sl_e8 ? `${p.tp_e8 ? px(Number(p.tp_e8) / 1e8) : '—'} / ${p.sl_e8 ? px(Number(p.sl_e8) / 1e8) : '—'}` : '—'}</td>
                      <td className="px-4 py-2 text-right"><button className="underline underline-offset-2" disabled={!canTrade || busy || !live} onClick={() => onClose(p.symbol, p.qty)}>Close</button></td>
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

/** Switches between the trader's accounts. Hidden until they own one. */
function AccountSelect() {
  const { config, accountId } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [rows, setRows] = useState<AccountRow[]>([]);

  useEffect(() => {
    if (!accountId || !config.deployed) return;
    let alive = true;
    readAccounts(config.rpc, config.stack.tenor, accountId)
      .then((r) => alive && setRows(r))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [accountId, config.deployed, config.rpc, config.stack.tenor]);

  if (rows.length === 0) return null;
  const current = rows.find((r) => pathname === r.href);
  return (
    <div className="border-b border-line p-5">
      <label htmlFor="account-select" className="text-sm text-mute">Account</label>
      <div className="relative mt-2">
        <select
          id="account-select"
          value={current?.href ?? ''}
          onChange={(e) => router.push(e.target.value)}
          className="h-12 w-full cursor-pointer appearance-none truncate rounded-xl border border-line bg-[#08090a] pl-4 pr-10 text-[15px] outline-none focus:border-mute"
        >
          {!current && <option value="" disabled>Choose an account</option>}
          {rows.map((r) => (
            <option key={r.key} value={r.href}>
              {`${usd(r.initial, 0)} · ${r.title}${r.status === 'Active' ? '' : ` · ${r.status}`}`}
            </option>
          ))}
        </select>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-mute" aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </div>
    </div>
  );
}

type HistoryRow ={ hash: string; time: number; method: string; symbol: string | null; usdc: string | null; ok: boolean };

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
