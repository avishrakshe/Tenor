import { market, parseProduct, ruleset, evaluate, markValue, type Quote } from '@tenor/rules';
import { view, type Challenge, type Funded, type GuardState, type Position } from './chain';

export type AccountRow = {
  key: string;
  href: string;
  title: string;
  status: string;
  funded: boolean;
  initial: bigint;
  dayStart: bigint;
  cash: bigint;
  positions: Position[];
  rules: ReturnType<typeof ruleset>;
  phase: 'one' | 'two' | 'funded';
};

export function equityWith(a: { cash: bigint; positions: Position[] }, quotes: Record<string, Quote> | null): bigint | null {
  let e = a.cash;
  for (const p of a.positions) {
    const q = quotes?.[p.symbol];
    if (!q) return null;
    e += markValue(BigInt(p.qty), q, market(p.symbol).decimals);
  }
  return e;
}

/** Every evaluation and funded account a trader owns, read from the contracts. */
export async function readAccounts(rpc: string, tenor: string, owner: string): Promise<AccountRow[]> {
  const challenges = await view<Challenge[]>(rpc, tenor, 'challenges_of', { owner });
  const funded = (await view<Funded[]>(rpc, tenor, 'list_funded', { from_index: 0, limit: 500 })).filter((f) => f.trader === owner);
  const guards = await Promise.all(funded.map((f) => view<GuardState>(rpc, f.guard, 'get_state')));
  const rows: AccountRow[] = challenges
    .filter((c) => !c.guard)
    .map((c) => {
      const p = parseProduct(c.product);
      return {
        key: `c${c.id}`,
        href: `/trade/${c.id}`,
        title: `#${c.id} ${c.product}`,
        status: c.status,
        funded: false,
        initial: BigInt(c.initial_balance),
        dayStart: BigInt(c.day_start_equity),
        cash: BigInt(c.cash),
        positions: c.positions,
        rules: ruleset(p.plan, p.twoStep),
        phase: c.phase === 2 ? 'two' : 'one',
      };
    });
  funded.forEach((f, i) => {
    const g = guards[i];
    rows.push({
      key: f.guard,
      href: `/funded/${f.guard}`,
      title: f.guard.split('.')[0] ? `Funded #${f.guard.split('.')[0]}` : f.guard,
      status: g.status,
      funded: true,
      initial: BigInt(g.initial_balance),
      dayStart: BigInt(g.day_start_equity),
      cash: BigInt(g.cash),
      positions: g.positions,
      rules: { phaseOneTargetBps: 0n, phaseTwoTargetBps: null, maxDrawdownBps: BigInt(g.max_drawdown_bps), dailyLossBps: BigInt(g.daily_loss_bps) },
      phase: 'funded',
    });
  });
  return rows;
}

export const isLive = (a: AccountRow) => a.status === 'Active';

export function objectives(a: AccountRow, equity: bigint) {
  return evaluate({ phase: a.phase, initial: a.initial, dayStart: a.dayStart, equity }, a.rules);
}
