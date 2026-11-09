type Outcome = { status?: { Failure?: unknown }; receipts_outcome?: { outcome: { logs: string[] } }[] };

const REJECTIONS: Record<string, string> = {
  notional_cap: 'it is above the position cap for this market',
  insufficient_cash: 'the account does not have enough cash',
  no_position: 'there is no open position to close',
  too_many_positions: 'this account already has 20 open trades',
};

function events(r: Outcome): { event: string; data?: { reason?: string; leg?: string }[] }[] {
  const logs = (r.receipts_outcome ?? []).flatMap((x) => x.outcome.logs).filter((l) => l.startsWith('EVENT_JSON:'));
  return logs.flatMap((l) => {
    try {
      return [JSON.parse(l.slice('EVENT_JSON:'.length))];
    } catch {
      return [];
    }
  });
}

/**
 * A stale price or a rejected order is a successful transaction that changes nothing, so the
 * contract's events have to be read as well as the transaction status.
 */
export function outcomeMessage(result: unknown, ok: string): { tone: 'info' | 'error'; text: string } {
  const r = (result ?? {}) as Outcome;
  if (r.status?.Failure) return { tone: 'error', text: JSON.stringify(r.status.Failure).slice(0, 200) };
  for (const e of events(r)) {
    if (e.event === 'price_stale') return { tone: 'error', text: 'Nothing happened: the oracle price is older than 60 seconds. Try again when it shows Fresh.' };
    if (e.event === 'order_rejected') {
      const reason = e.data?.[0]?.reason ?? '';
      return { tone: 'error', text: `Order rejected: ${REJECTIONS[reason] ?? reason}.` };
    }
    if (e.event === 'nothing_to_close') return { tone: 'error', text: 'That trade is no longer open, so nothing was sold.' };
    if (e.event === 'order_rejected_by_venue') return { tone: 'error', text: 'The swap venue refused this order, usually because the price moved. Nothing was spent.' };
    if (e.event === 'payout_failed' && e.data?.[0]?.leg === 'trader') return { tone: 'error', text: 'The payout could not be sent. The money is still in this account and nobody was paid.' };
  }
  return { tone: 'info', text: ok };
}

/** False when a transaction finished without the event it was meant to produce. */
export function emitted(result: unknown, name: string): boolean {
  const r = (result ?? {}) as Outcome;
  return !r.receipts_outcome || events(r).some((e) => e.event === name);
}
