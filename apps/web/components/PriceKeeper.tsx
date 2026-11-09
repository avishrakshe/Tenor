'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession, writeStore } from './Session';

const STORE = 'tenor.demo.btcMove';
const TICK_MS = 20_000;

const SCENARIOS: [string, number][] = [
  ['Market price', 1],
  ['BTC +2%', 1.02],
  ['BTC +11%', 1.11],
  ['BTC -4%', 0.96],
];

/** While a trading screen is open, asks the server to keep the oracle inside its 60s limit. */
export function usePriceKeeper() {
  const { config } = useSession();
  const demo = config.stackName === 'demo';
  const [move, setMoveState] = useState(1);
  const [problem, setProblem] = useState<string | null>(null);
  const moveRef = useRef(1);

  const tick = useCallback(async (force = false) => {
    if (document.hidden && !force) return;
    try {
      const r = await fetch('/api/keeper', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ btcMove: moveRef.current, force }),
      });
      setProblem(r.status === 503 ? ((await r.json()).message as string) : null);
    } catch {
      // A missed tick is covered by the next one.
    }
  }, []);

  useEffect(() => {
    if (!config.deployed) return;
    if (demo) {
      try {
        const saved = Number(localStorage.getItem(STORE));
        if (saved > 0) {
          moveRef.current = saved;
          setMoveState(saved);
        }
      } catch {
        // Storage can be blocked; the scenario then starts at market price.
      }
    }
    void tick();
    const t = setInterval(() => void tick(), TICK_MS);
    return () => clearInterval(t);
  }, [config.deployed, demo, tick]);

  const setMove = useCallback((value: number) => {
    moveRef.current = value;
    setMoveState(value);
    writeStore(STORE, String(value));
    void tick(true);
  }, [tick]);

  return { demo, move, setMove, problem };
}

export function DemoPrices({ move, setMove }: { move: number; setMove: (m: number) => void }) {
  return (
    <section className="panel flex flex-wrap items-center gap-3 !p-3" aria-label="Demo price scenarios">
      <p className="text-sm text-mute">
        <b className="text-text">Demo stack.</b> Same contracts, but anyone can set the price, so a pass or breach takes seconds. The price is shared by everyone in demo mode.
      </p>
      <div className="flex flex-wrap gap-1">
        {SCENARIOS.map(([label, value]) => (
          <button key={label} aria-pressed={move === value} onClick={() => setMove(value)} className={`num min-h-9 rounded-md px-3 text-sm ${move === value ? 'bg-text text-black' : 'border border-line text-mute hover:text-text'}`}>
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}
