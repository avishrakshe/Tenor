import { challengeFee, ruleset } from '@tenor/rules';
import type { CatalogEntry } from './chain';

export const SIZES = [5_000, 10_000, 25_000, 50_000, 100_000, 200_000];
export const PLANS = ['classic', 'turbo', 'pro'] as const;

/** The catalog computed from the same formula as the contract, for before it is deployed. */
export function localCatalog(): CatalogEntry[] {
  const out: CatalogEntry[] = [];
  for (const plan of PLANS) {
    for (const twoStep of [false, true]) {
      for (const size of SIZES) {
        const r = ruleset(plan, twoStep);
        out.push({
          product: `${plan}-${twoStep ? 2 : 1}-${size}`,
          plan,
          two_step: twoStep,
          size_usdc: String(size),
          fee: String(challengeFee(BigInt(size), r.maxDrawdownBps, twoStep ? 500n : 800n)),
          max_loss: '0',
          target_bps: Number(r.phaseOneTargetBps),
          phase_two_target_bps: r.phaseTwoTargetBps === null ? null : Number(r.phaseTwoTargetBps),
          max_drawdown_bps: Number(r.maxDrawdownBps),
          daily_loss_bps: Number(r.dailyLossBps),
        });
      }
    }
  }
  return out;
}

export const productName = (id: string) => {
  const [plan, steps] = id.split('-');
  return `${steps}-Step ${plan[0].toUpperCase()}${plan.slice(1)}`;
};

export const productSize = (id: string) => Number(id.split('-')[2]);
