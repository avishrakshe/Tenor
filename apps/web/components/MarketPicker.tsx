'use client';

import { MARKETS } from '@tenor/rules';
import { useEffect, useMemo, useRef, useState } from 'react';
import { subscribeTicks } from '@/lib/live';

export const COINS: Record<string, { mark: string; color: string; name: string }> = {
  BTC: { mark: 'B', color: '#f7931a', name: 'Bitcoin' },
  ETH: { mark: 'E', color: '#627eea', name: 'Ethereum' },
  SOL: { mark: 'S', color: '#9945ff', name: 'Solana' },
  NEAR: { mark: 'N', color: '#00b88d', name: 'NEAR Protocol' },
};

export const pair = (symbol: string) => `${symbol}-USDC`;

/** Decimals that keep about five significant figures, so BTC reads 74,512.6 and SOL 85.940. */
export const priceDigits = (n: number) => (n >= 10_000 ? 1 : n >= 1000 ? 2 : n >= 1 ? 3 : 5);
export const fmtPrice = (n: number, digits = priceDigits(n)) =>
  n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const compactUsd = (n: number) => `$${n.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 })}`;

export function CoinMark({ symbol, size = 28 }: { symbol: string; size?: number }) {
  const c = COINS[symbol] ?? { mark: symbol[0], color: '#3a3d44' };
  return (
    <span
      aria-hidden
      className="inline-grid shrink-0 place-items-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, background: c.color, fontSize: size * 0.45 }}
    >
      {c.mark}
    </span>
  );
}

type Stat = { last: number; open: number; volumeUsd: number };

/** 24h stats for every market: one REST read each, then the shared trade feed keeps them live. */
function useAllMarkets(active: boolean) {
  const [stats, setStats] = useState<Record<string, Stat>>({});
  useEffect(() => {
    if (!active) return;
    let alive = true;
    for (const m of MARKETS) {
      fetch(`/api/market?symbol=${m.symbol}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((s) => {
          if (!alive || !s || !Number.isFinite(s.last)) return;
          // A live trade that arrived first is newer than this snapshot.
          setStats((prev) => (prev[m.symbol] ? prev : { ...prev, [m.symbol]: { last: s.last, open: s.open, volumeUsd: s.volumeUsd } }));
        })
        .catch(() => {});
    }
    let pending: Record<string, Stat> = {};
    const offs = MARKETS.map((m) =>
      subscribeTicks(m.symbol, (t) => {
        pending[t.symbol] = { last: t.price, open: t.open24, volumeUsd: t.volume24 * t.price };
      }),
    );
    const id = setInterval(() => {
      if (Object.keys(pending).length === 0) return;
      const batch = pending;
      pending = {};
      setStats((prev) => ({ ...prev, ...batch }));
    }, 500);
    return () => {
      alive = false;
      clearInterval(id);
      offs.forEach((off) => off());
    };
  }, [active]);
  return stats;
}

const FAV_KEY = 'tenor.favoriteMarkets';

function useFavorites() {
  const [favs, setFavs] = useState<string[]>([]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(FAV_KEY);
      if (raw) setFavs(JSON.parse(raw));
    } catch {}
  }, []);
  const toggle = (s: string) =>
    setFavs((prev) => {
      const next = prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s];
      try {
        localStorage.setItem(FAV_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  return { favs, toggle };
}

type SortKey = 'last' | 'change' | 'volume' | 'cap';

function Star({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill={filled ? '#e6b450' : 'none'} stroke={filled ? '#e6b450' : 'currentColor'} strokeWidth="1.6" strokeLinejoin="round" aria-hidden>
      <path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />
    </svg>
  );
}

/** The current market as a button. Opens a searchable list of every market (also on Ctrl/⌘ K). */
export function MarketPicker({ symbol, onSelect }: { symbol: string; onSelect: (s: string) => void }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="flex shrink-0 items-center gap-2.5 rounded-lg py-1 pl-1 pr-2 hover:bg-raised"
      >
        <CoinMark symbol={symbol} size={30} />
        <span className="text-[15px] font-semibold">{pair(symbol)}</span>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" className="text-mute" aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </svg>
        <kbd className="num ml-1 hidden rounded border border-line px-1.5 text-[11px] text-mute md:inline">Ctrl K</kbd>
      </button>
      {open && (
        <MarketDialog
          current={symbol}
          onClose={() => setOpen(false)}
          onSelect={(s) => {
            onSelect(s);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function MarketDialog({ current, onClose, onSelect }: { current: string; onClose: () => void; onSelect: (s: string) => void }) {
  const stats = useAllMarkets(true);
  const { favs, toggle } = useFavorites();
  const [query, setQuery] = useState('');
  const [onlyFavs, setOnlyFavs] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'volume', desc: true });
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const rows = useMemo(() => {
    const q = query.trim().toUpperCase();
    const list = MARKETS.filter((m) => (!onlyFavs || favs.includes(m.symbol)) && (!q || m.symbol.includes(q) || COINS[m.symbol]?.name.toUpperCase().includes(q)))
      .map((m) => {
        const s = stats[m.symbol];
        return {
          symbol: m.symbol,
          cap: Number(m.capBps) / 100,
          last: s?.last ?? null,
          change: s ? s.last - s.open : null,
          changePct: s && s.open > 0 ? ((s.last - s.open) / s.open) * 100 : null,
          volume: s?.volumeUsd ?? null,
        };
      });
    const value = (r: (typeof list)[number]) => (sort.key === 'change' ? r.changePct : sort.key === 'cap' ? r.cap : r[sort.key]) ?? -Infinity;
    return list.sort((a, b) => (sort.desc ? value(b) - value(a) : value(a) - value(b)));
  }, [query, onlyFavs, favs, stats, sort]);

  useEffect(() => setActive(0), [query, onlyFavs]);
  const clamped = Math.min(active, Math.max(rows.length - 1, 0));

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, rows.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && rows[clamped]) {
      e.preventDefault();
      onSelect(rows[clamped].symbol);
    }
  }

  const header = (key: SortKey, label: string, extra = '') => (
    <button
      type="button"
      onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : true }))}
      className={`flex items-center justify-end gap-1 ${sort.key === key ? 'font-semibold text-text' : 'hover:text-text'} ${extra}`}
      aria-label={`Sort by ${label}`}
    >
      {label}
      {sort.key === key && <span aria-hidden>{sort.desc ? '↓' : '↑'}</span>}
    </button>
  );

  const grid = 'grid grid-cols-[36px_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.5fr)] sm:grid-cols-[40px_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,0.9fr)_minmax(0,0.7fr)] items-center gap-x-4';

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 px-4 pt-[6vh] backdrop-blur-[2px]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Markets"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        className="w-full max-w-[1120px] overflow-hidden rounded-2xl border border-[#2a2d33] bg-[#121418] shadow-2xl shadow-black/60"
      >
        <div className="flex items-center gap-3 border-b border-line px-5">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-mute" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search markets..."
            aria-label="Search markets"
            aria-controls="market-list"
            aria-activedescendant={rows[clamped] ? `market-${rows[clamped].symbol}` : undefined}
            className="h-16 flex-1 bg-transparent text-lg outline-none placeholder:text-mute"
          />
          <button type="button" onClick={onClose} aria-label="Close" className="grid size-9 place-items-center rounded-lg text-mute hover:bg-raised hover:text-text">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <div className="flex items-center gap-1 border-b border-line px-4 py-3">
          <button type="button" aria-pressed={onlyFavs} aria-label="Favorites" onClick={() => setOnlyFavs(true)} className={`grid size-10 place-items-center rounded-xl ${onlyFavs ? 'bg-raised text-text' : 'text-mute hover:text-text'}`}>
            <Star filled={onlyFavs} />
          </button>
          <button type="button" aria-pressed={!onlyFavs} onClick={() => setOnlyFavs(false)} className={`h-10 rounded-xl px-4 text-[15px] font-medium ${!onlyFavs ? 'bg-raised text-text' : 'text-mute hover:text-text'}`}>
            All
          </button>
        </div>

        <div className={`${grid} border-b border-line px-5 py-3 text-sm text-mute`}>
          <span />
          <span>Symbol</span>
          {header('last', 'Last price')}
          {header('change', '24h change')}
          {header('volume', 'Volume', 'hidden sm:flex')}
          {header('cap', 'Cap', 'hidden sm:flex')}
        </div>

        <div id="market-list" role="listbox" aria-label="Markets" className="max-h-[60vh] overflow-y-auto">
          {rows.length === 0 && <p className="px-5 py-12 text-center text-sm text-mute">{onlyFavs ? 'No favorites yet. Star a market to pin it here.' : 'No markets match.'}</p>}
          {rows.map((r, i) => {
            const up = (r.changePct ?? 0) >= 0;
            const digits = r.last === null ? 2 : priceDigits(r.last);
            return (
              <div
                key={r.symbol}
                id={`market-${r.symbol}`}
                role="option"
                aria-selected={i === clamped}
                onMouseEnter={() => setActive(i)}
                onClick={() => onSelect(r.symbol)}
                className={`${grid} h-[70px] cursor-pointer border-b border-line/60 px-5 last:border-0 ${i === clamped ? 'bg-[#1b1e23]' : ''}`}
              >
                <button
                  type="button"
                  aria-label={`${favs.includes(r.symbol) ? 'Remove' : 'Add'} ${r.symbol} ${favs.includes(r.symbol) ? 'from' : 'to'} favorites`}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(r.symbol);
                  }}
                  className="grid size-8 place-items-center rounded-md text-mute hover:text-text"
                >
                  <Star filled={favs.includes(r.symbol)} />
                </button>
                <span className="flex min-w-0 items-center gap-3">
                  <CoinMark symbol={r.symbol} size={34} />
                  <span className="truncate text-[17px] font-semibold">{pair(r.symbol)}</span>
                  <span className="hidden rounded-md bg-up/15 px-1.5 py-0.5 text-xs font-semibold text-up md:inline">Spot</span>
                  {r.symbol === current && <span className="hidden text-xs text-mute lg:inline">Current</span>}
                </span>
                <span className="num text-right text-[16px]">{r.last === null ? '—' : fmtPrice(r.last)}</span>
                <span className={`num truncate text-right text-[16px] ${r.change === null ? 'text-mute' : up ? 'text-up' : 'text-down'}`}>
                  {r.change === null || r.changePct === null
                    ? '—'
                    : `${up ? '+' : ''}${fmtPrice(r.change, digits)} / ${up ? '+' : ''}${r.changePct.toFixed(2)}%`}
                </span>
                <span className="num hidden text-right text-[16px] sm:block">{r.volume === null ? '—' : compactUsd(r.volume)}</span>
                <span className="num hidden text-right text-[16px] sm:block">{r.cap}%</span>
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap justify-between gap-x-6 gap-y-1 border-t border-line px-5 py-3 text-[13px] text-mute">
          <span>↑↓ to move · Enter to open · Esc to close</span>
          <span>Cap = largest position as a share of account equity</span>
        </div>
      </div>
    </div>
  );
}
