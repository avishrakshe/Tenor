'use client';

import { motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';

type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };

const usdFmt = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: n < 100 ? 4 : 2 });

const INTERVALS = ['1m', '5m', '15m', '1h', '6h', '1d'];

/** Live candles with the onchain oracle price drawn across them. */
export function CandleChart({ symbol, oraclePrice }: { symbol: string; oraclePrice: number | null }) {
  const host = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = useRef<{ chart: any; candles: any; volume: any; line: any } | null>(null);
  const [interval, setIntervalName] = useState('5m');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    let cleanup = () => {};
    (async () => {
      const { createChart, CandlestickSeries, HistogramSeries, ColorType } = await import('lightweight-charts');
      if (dead || !host.current) return;
      const chart = createChart(host.current, {
        autoSize: true,
        layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#8c929b', fontSize: 11, attributionLogo: true },
        grid: { vertLines: { color: '#15171a' }, horzLines: { color: '#15171a' } },
        rightPriceScale: { borderColor: '#1f2125' },
        timeScale: { borderColor: '#1f2125', timeVisible: true },
        crosshair: { mode: 0 },
      });
      const candles = chart.addSeries(CandlestickSeries, {
        upColor: '#4fd1a1', downColor: '#f26d6d', borderVisible: false, wickUpColor: '#4fd1a1', wickDownColor: '#f26d6d',
      });
      const volume = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'vol', color: '#2a2d32' });
      chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.86, bottom: 0 } });
      api.current = { chart, candles, volume, line: null };
      cleanup = () => chart.remove();
      setError(null);
    })();
    return () => {
      dead = true;
      cleanup();
      api.current = null;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(`/api/candles?symbol=${symbol}&interval=${interval}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const rows: Candle[] = await r.json();
        if (!alive || !api.current) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const t = (x: number) => x as any;
        api.current.candles.setData(rows.map((c) => ({ ...c, time: t(c.time) })));
        api.current.volume.setData(rows.map((c) => ({ time: t(c.time), value: c.volume, color: c.close >= c.open ? '#1d4a3a' : '#552a2a' })));
        setError(null);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    };
    const first = setTimeout(load, 150);
    const id = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearTimeout(first);
      clearInterval(id);
    };
  }, [symbol, interval]);

  useEffect(() => {
    const a = api.current;
    if (!a) return;
    if (a.line) a.candles.removePriceLine(a.line);
    a.line = oraclePrice ? a.candles.createPriceLine({ price: oraclePrice, color: '#e6b450', lineWidth: 1, lineStyle: 2, title: 'Oracle' }) : null;
  }, [oraclePrice]);

  return (
    <div className="flex h-full min-h-[380px] flex-col">
      <div className="flex items-center gap-1 border-b border-line px-3 py-2">
        {INTERVALS.map((i) => (
          <button
            key={i}
            onClick={() => setIntervalName(i)}
            aria-pressed={i === interval}
            className={`num min-h-8 rounded-md px-2.5 text-xs ${i === interval ? 'bg-raised text-text' : 'text-mute hover:text-text'}`}
          >
            {i}
          </button>
        ))}
        <span className="label ml-auto">{symbol}-USD · Coinbase</span>
      </div>
      {error && <p className="px-3 py-2 text-xs text-down">Market data unavailable: {error}</p>}
      <div ref={host} className="min-h-0 flex-1" role="img" aria-label={`${symbol} candlestick chart`} />
    </div>
  );
}

/** One series, drawn on when it scrolls into view, with a hover readout. */
export function PriceArea({ symbol, days = 90 }: { symbol: string; days?: number }) {
  const [rows, setRows] = useState<Candle[]>([]);
  const [hover, setHover] = useState<number | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch(`/api/candles?symbol=${symbol}&interval=1d`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((c: Candle[]) => setRows(c.slice(-days)), () => setError(true));
  }, [symbol, days]);

  const W = 720;
  const H = 300;
  const PAD = 12;
  const geo = useMemo(() => {
    if (rows.length < 2) return null;
    const closes = rows.map((r) => r.close);
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    const x = (i: number) => (i / (rows.length - 1)) * (W - 2 * PAD) + PAD;
    const y = (v: number) => H - PAD - ((v - min) / (max - min || 1)) * (H - 2 * PAD - 26);
    const line = rows.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(r.close).toFixed(1)}`).join(' ');
    return { x, y, line, area: `${line} L${x(rows.length - 1)},${H} L${x(0)},${H} Z` };
  }, [rows]);

  if (error) return <p className="text-sm text-mute">Market data is unavailable right now.</p>;
  if (!geo) return <div className="h-[300px]" />;

  const i = hover ?? rows.length - 1;
  const point = rows[i];
  const change = ((rows[rows.length - 1].close - rows[0].close) / rows[0].close) * 100;
  const months = rows.filter((_, n) => n % Math.ceil(rows.length / 4) === 0);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="label">{symbol}/USD daily close · last {days} days</div>
          <div className="num mt-1 text-2xl">{usdFmt(point.close)}</div>
        </div>
        <div className="num text-right text-xs text-mute">
          <div>{new Date(point.time * 1000).toISOString().slice(0, 10)}</div>
          <div>
            {change >= 0 ? '+' : ''}
            {change.toFixed(1)}% over the period
          </div>
        </div>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-3 w-full touch-none"
        role="img"
        aria-label={`${symbol} price over the last ${days} days, ${change.toFixed(1)} percent change`}
        onPointerLeave={() => setHover(null)}
        onPointerMove={(e) => {
          const b = e.currentTarget.getBoundingClientRect();
          const f = (e.clientX - b.left) / b.width;
          setHover(Math.round(Math.min(Math.max(f, 0), 1) * (rows.length - 1)));
        }}
      >
        <defs>
          <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.16" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
        </defs>
        <motion.path d={geo.area} fill="url(#fill)" initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ duration: 1.4, delay: 0.8 }} />
        <motion.path
          d={geo.line}
          fill="none"
          stroke="#f3f4f6"
          strokeWidth="2"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          whileInView={{ pathLength: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 2, ease: 'easeInOut' }}
        />
        <line x1={geo.x(i)} x2={geo.x(i)} y1={PAD} y2={H} stroke="#fff" strokeOpacity="0.2" />
        <circle cx={geo.x(i)} cy={geo.y(point.close)} r="5" fill="#fff" stroke="#000" strokeWidth="2" />
      </svg>
      <div className="num mt-1 flex justify-between text-xs text-mute">
        {months.map((m) => (
          <span key={m.time}>{new Date(m.time * 1000).toISOString().slice(5, 10)}</span>
        ))}
      </div>
    </div>
  );
}

export type Slice = { label: string; value: number; color: string };

/** Part-to-whole as one bar with a legend. A table-like legend carries exact values. */
export function AllocationBar({ slices, format }: { slices: Slice[]; format: (n: number) => string }) {
  const total = slices.reduce((a, s) => a + s.value, 0) || 1;
  return (
    <div>
      <div className="flex h-3 gap-0.5 overflow-hidden rounded-sm" role="img" aria-label="Allocation of equity">
        {slices.filter((s) => s.value > 0).map((s) => (
          <div key={s.label} title={`${s.label}: ${format(s.value)}`} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} />
        ))}
      </div>
      <ul className="mt-4 space-y-2 text-sm">
        {slices.map((s) => (
          <li key={s.label} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
            <span>{s.label}</span>
            <span className="num ml-auto">{format(s.value)}</span>
            <span className="num w-14 text-right text-mute">{((s.value / total) * 100).toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Return per account, from a zero baseline. */
export function ReturnBars({ rows }: { rows: { label: string; pct: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.pct)));
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[150px_1fr_64px] items-center gap-3 text-sm">
          <span className="num truncate text-mute">{r.label}</span>
          <span className="relative h-4">
            <span className="absolute inset-y-0 left-1/2 w-px bg-line" />
            <motion.span
              title={`${r.label}: ${r.pct.toFixed(2)}%`}
              className={`absolute inset-y-0.5 rounded-sm ${r.pct >= 0 ? 'left-1/2 bg-up' : 'right-1/2 bg-down'}`}
              initial={{ width: 0 }}
              whileInView={{ width: `${(Math.abs(r.pct) / max) * 50}%` }}
              viewport={{ once: true }}
              transition={{ duration: 0.9 }}
            />
          </span>
          <span className="num text-right">
            {r.pct >= 0 ? '+' : ''}
            {r.pct.toFixed(2)}%
          </span>
        </li>
      ))}
    </ul>
  );
}
