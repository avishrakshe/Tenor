'use client';

import type { Result } from '@tenor/counterparty';
import { useEffect, useState } from 'react';

export type { Result };

const TONE = { allow: 'text-up border-up/40', warn: 'text-warn border-warn/40', block: 'text-down border-down/40' };
const LABEL = { allow: 'Allow', warn: 'Warning', block: 'Blocked' };
const DOT = { info: 'text-mute', warn: 'text-warn', block: 'text-down' };

export async function fetchCheck(receiver: string, actor?: string): Promise<Result> {
  const q = new URLSearchParams({ receiver });
  if (actor) q.set('actor', actor);
  const r = await fetch(`/api/counterparty?${q}`);
  const j = await r.json();
  if (!r.ok) throw new Error(j.message ?? `HTTP ${r.status}`);
  return j;
}

/** Runs the check shortly after the address stops changing. */
export function useCounterparty(receiver: string, actor?: string) {
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setResult(null);
    setError(null);
    const target = receiver.trim();
    if (!target) return;
    let live = true;
    setLoading(true);
    const id = setTimeout(() => {
      fetchCheck(target, actor)
        .then((r) => live && setResult(r), (e) => live && setError(e.message))
        .finally(() => live && setLoading(false));
    }, 500);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [receiver, actor]);
  return { result, error, loading };
}

export function Verdict({ result }: { result: Result }) {
  return (
    <div role="status">
      <span className={`num inline-block rounded-full border px-3 py-1 text-xs ${TONE[result.verdict]}`}>{LABEL[result.verdict]}</span>
      <ul className="mt-2 space-y-1 text-sm">
        {result.reasons.map((r) => (
          <li key={r.text} className="flex gap-2">
            <span className={DOT[r.level]} aria-hidden="true">●</span>
            <span>{r.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
