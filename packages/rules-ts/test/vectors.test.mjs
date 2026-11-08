import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { challengeFee, evaluate, fillBuy, fillSell, market, normalize, ruleset, USDC_UNIT } from '../src/index.js';

const vectors = JSON.parse(readFileSync(new URL('../../../test-vectors/rules.json', import.meta.url), 'utf8'));

for (const v of vectors.evaluate) {
  test(`evaluate: ${v.name}`, () => {
    const r = evaluate(
      { phase: v.phase, initial: BigInt(v.initial), dayStart: BigInt(v.day_start), equity: BigInt(v.equity) },
      ruleset(v.plan, v.two_step),
    );
    assert.equal(r.status, v.status);
    assert.equal(r.reason, v.reason);
    assert.equal(r.profit, BigInt(v.profit));
    assert.equal(r.dailyLoss, BigInt(v.daily_loss));
    assert.equal(r.drawdown, BigInt(v.drawdown));
    assert.equal(r.target === null ? null : Number(r.target.progressBps), v.target_bps);
    assert.equal(Number(r.daily.progressBps), v.daily_bps);
    assert.equal(Number(r.maxDrawdown.progressBps), v.dd_bps);
  });
}

for (const v of vectors.fills) {
  test(`fill: ${v.name}`, () => {
    const q = normalize(v.price, v.conf, v.expo);
    const { decimals } = market(v.symbol);
    const f = v.side === 'buy' ? fillBuy(BigInt(v.amount), q, decimals) : fillSell(BigInt(v.amount), q, decimals);
    assert.equal(f.out, BigInt(v.out));
    assert.equal(f.fee, BigInt(v.fee));
  });
}

test('fee table', () => {
  const sizes = [5_000n, 10_000n, 25_000n, 50_000n, 100_000n, 200_000n];
  for (const [key, row] of Object.entries(vectors.fees)) {
    const [plan, steps] = key.split('-');
    const r = ruleset(plan, steps === '2');
    row.forEach((fee, i) => {
      assert.equal(challengeFee(sizes[i], r.maxDrawdownBps, steps === '2' ? 500n : 800n), BigInt(fee) * USDC_UNIT, `${key} ${sizes[i]}`);
    });
  }
});
