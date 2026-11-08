'use client';

import { useEffect, useState } from 'react';

/** Polls a loader. Returns the latest value and the latest error. */
export function usePoll<T>(load: () => Promise<T>, deps: unknown[], ms = 5000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = () =>
      load().then(
        (d) => {
          if (alive) {
            setData(d);
            setError(null);
          }
        },
        (e) => alive && setError(e instanceof Error ? e.message : String(e)),
      );
    tick();
    const id = setInterval(tick, ms);
    return () => {
      alive = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error };
}

export function Stat({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  const color = tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : '';
  return (
    <div>
      <div className="label">{label}</div>
      <div className={`num mt-1 text-lg ${color}`}>{value}</div>
    </div>
  );
}

export function Meter({
  label,
  progressBps,
  caption,
  tone,
}: {
  label: string;
  progressBps: bigint;
  caption: string;
  tone: 'up' | 'down';
}) {
  const pct = Number(progressBps) / 100;
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="num text-mute">{caption}</span>
      </div>
      <div
        className="mt-2 h-2 rounded-sm bg-line"
        role="progressbar"
        aria-label={label}
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className={`h-2 rounded-sm ${tone === 'up' ? 'bg-up' : 'bg-down'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'error'; children: React.ReactNode }) {
  return (
    <p role={tone === 'error' ? 'alert' : 'status'} className={`text-sm ${tone === 'error' ? 'text-down' : 'text-mute'}`}>
      {children}
    </p>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const good = ['Active', 'Passed', 'Funded'].includes(status);
  const bad = status === 'Breached';
  return (
    <span className={`num rounded-sm border border-line px-2 py-0.5 text-xs ${good ? 'text-up' : bad ? 'text-down' : 'text-warn'}`}>
      {status}
    </span>
  );
}

/** Oracle price since this page opened. The oracle stores only the latest value. */
export function Spark({ points, label }: { points: number[]; label: string }) {
  if (points.length < 2) {
    return <div className="flex h-40 items-center justify-center text-sm text-mute">Collecting oracle prices…</div>;
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const d = points
    .map((p, i) => `${i ? 'L' : 'M'}${(i / (points.length - 1)) * 600},${max === min ? 75 : 150 - ((p - min) / span) * 140 - 5}`)
    .join(' ');
  return (
    <svg viewBox="0 0 600 150" className="h-40 w-full" role="img" aria-label={label} preserveAspectRatio="none">
      <path d={d} fill="none" stroke="var(--color-text)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
