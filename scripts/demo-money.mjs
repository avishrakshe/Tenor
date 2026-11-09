// Proves where every unit of USDC goes across a whole account lifecycle. Each step snapshots every
// party's token balance and the contract's books from the chain, then compares the change with an
// amount worked out here from the oracle price by packages/rules-ts, a separate implementation from
// the contracts. A difference of one micro-USDC fails the run.
//
//   npm run faucet                                     (testnet, needs about 10 NEAR)
//   npm run demo:money -- --network testnet
//
// Writes deployments/money-proof.<network>.json with every transaction link.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { KeyPair, ROOT, USDC, fmtUsd, must, see, sleep, step } from './lib/near.mjs';
import { BASE_PRICES, setup } from './lib/demo.mjs';
import { challengeFee, fillBuy, fillSell, market, normalize } from '../packages/rules-ts/src/index.js';

const PRODUCT = 'classic-1-5000';
const CAPITAL = 5_000_000_000n;
const MAX_LOSS = 375_000_000n; // 5000 x 6% drawdown x 1.25 gap buffer.
const BTC_DECIMALS = market('BTC').decimals;

const ctx = await setup('money', { amount: '9.5' });
const { near, dep, tenor, trader, push } = ctx;
const config = await near.view(tenor, 'get_config');
const parties = { trader: trader.id, tenor, treasury: config.treasury, venue: dep.demo.swap, guard1: null, guard2: null };
const KEYS = [...Object.keys(parties), 'supply', 'reserve', 'vault', 'capital_deployed', 'live_max_loss'];
const BALANCES = Object.keys(parties);

const usdcOf = async (id) => (id ? BigInt(await near.view(dep.usdc, 'ft_balance_of', { account_id: id })) : 0n);
const btcOf = async (id) => BigInt(await near.view(dep.tokens.BTC, 'ft_balance_of', { account_id: id }));
const signed = (n) => `${n < 0n ? '-' : '+'}${fmtUsd(n < 0n ? -n : n)}`;

async function snapshot() {
  const entries = await Promise.all(BALANCES.map(async (k) => [k, await usdcOf(parties[k])]));
  const r = await near.view(tenor, 'reserve_state');
  return {
    ...Object.fromEntries(entries),
    supply: BigInt(await near.view(dep.usdc, 'ft_total_supply')),
    reserve: BigInt(r.reserve),
    vault: BigInt(r.vault),
    capital_deployed: BigInt(r.capital_deployed),
    live_max_loss: BigInt(r.live_max_loss),
  };
}

const delta = (a, b) => Object.fromEntries(KEYS.map((k) => [k, b[k] - a[k]]));
const mismatches = (d, expected) => KEYS.filter((k) => d[k] !== (expected[k] ?? 0n));

const proof = [];
let failures = 0;
const fail = (text) => {
  failures += 1;
  console.log(`    FAIL: ${text}`);
};
const verify = (ok, text) => {
  if (ok) console.log(`    ok: ${text}`);
  else fail(text);
};

/** Runs `act`, then checks every balance and every book entry changed by exactly `expected`. */
async function move(n, title, act, expected) {
  step(n, title);
  const before = await snapshot();
  const txs = [await act()].flat().filter(Boolean);
  let after = await snapshot();
  let d = delta(before, after);
  // Public RPC nodes can lag the block a transaction finished in.
  for (let i = 0; i < 4 && mismatches(d, expected).length; i += 1) {
    await sleep(2000);
    after = await snapshot();
    d = delta(before, after);
  }
  for (const t of txs) see('tx', t.link);
  for (const k of KEYS) {
    if (d[k] !== 0n || expected[k]) see(k.padEnd(16), `${signed(d[k])}${expected[k] !== undefined && d[k] !== expected[k] ? `   EXPECTED ${signed(expected[k])}` : ''}`);
  }
  const wrong = mismatches(d, expected);
  if (wrong.length) fail(`unexpected change in ${wrong.join(', ')}`);
  else console.log('    ok: every balance moved by exactly the expected amount');

  // Nothing can appear from nowhere: all balance changes must sum to what the token minted.
  const sum = BALANCES.reduce((a, k) => a + d[k], 0n);
  if (sum !== d.supply) fail(`balances changed by ${signed(sum)} but supply changed by ${signed(d.supply)}`);
  // Tenor's accounting must always match the tokens it really holds.
  if (d.tenor !== d.reserve + d.vault) fail(`tenor holds ${signed(d.tenor)} but its books moved ${signed(d.reserve + d.vault)}`);

  proof.push({
    step: n,
    title,
    ok: wrong.length === 0,
    txs: txs.map((t) => t.link),
    deltas: Object.fromEntries(KEYS.filter((k) => d[k] !== 0n).map((k) => [k, d[k].toString()])),
  });
  return { after, d };
}

async function quote(symbol) {
  const p = await near.view(dep.demo.oracle, 'get_price_unsafe', { price_identifier: market(symbol).feedId });
  return normalize(p.price, p.conf, p.expo);
}
const price = async (btc) => must(await push({ ...BASE_PRICES, BTC: btc }), 'push prices');
const guardState = (id) => near.view(id, 'get_state');

async function cashMatchesTokens(id) {
  const [s, held] = await Promise.all([guardState(id), usdcOf(id)]);
  verify(BigInt(s.cash) === held, `Guard's book says ${fmtUsd(s.cash)} and the token contract says ${fmtUsd(held)}`);
  return s;
}

const startState = await near.view(tenor, 'reserve_state');
const held = await usdcOf(tenor);
const books = BigInt(startState.reserve) + BigInt(startState.vault);
verify(held === books, `tenor holds ${fmtUsd(held)} and its reserve + vault books say ${fmtUsd(books)}`);

/** Buys a challenge and passes it. Evaluations are paper accounts, so no USDC may move. */
async function buyAndPass(n, feeExpected) {
  const buy = await move(n, `Buy ${PRODUCT}: the fee goes to the risk reserve`, async () => {
    const r = must(await near.call(trader.account, dep.usdc, 'ft_transfer_call', {
      receiver_id: tenor, amount: feeExpected.toString(), msg: JSON.stringify({ action: 'buy', product: PRODUCT }),
    }, { gas: '100', deposit: '1' }), 'buy');
    buyAndPass.id = r.events.find((e) => e.name === 'challenge_opened').id;
    return r;
  }, { trader: -feeExpected, tenor: feeExpected, reserve: feeExpected });
  const { id } = buyAndPass;
  await move(n + 1, 'Pass the evaluation on paper: no real money may move', async () => {
    await price(BASE_PRICES.BTC);
    const c = await near.view(tenor, 'get_challenge', { id });
    const order = must(await near.call(trader.account, tenor, 'place_order', { challenge_id: id, symbol: 'BTC', usdc: c.cash }), 'paper order');
    await price(BASE_PRICES.BTC * 1.11);
    const poke = must(await near.call(trader.account, tenor, 'poke', { account: String(id) }), 'poke');
    return [order, poke];
  }, {});
  const c = await near.view(tenor, 'get_challenge', { id });
  verify(c.status === 'Passed', `challenge ${id} status is ${c.status}`);
  void buy;
  return id;
}

async function fund(n, id, slot) {
  const key = KeyPair.fromRandom('ed25519');
  await move(n, 'fund(): capital leaves the vault for a new Guard account', async () => {
    const r = must(await near.call(trader.account, tenor, 'fund', {
      challenge_id: id, trader_public_key: key.getPublicKey().toString(),
    }, { deposit: config.guard_near_budget }), 'fund');
    parties[slot] = r.events.find((e) => e.name === 'funded').guard;
    return r;
  }, { tenor: -CAPITAL, [slot]: CAPITAL, vault: -CAPITAL, capital_deployed: CAPITAL, live_max_loss: MAX_LOSS });
  const guardId = parties[slot];
  const keys = await near.accessKeys(guardId);
  const perm = keys[0]?.accessKey?.permission ?? keys[0]?.access_key?.permission;
  verify(keys.length === 1 && perm !== 'FullAccess', `${guardId} has ${keys.length} key and it is not full access`);
  return { guardId, signer: near.account(guardId, key.toString()) };
}

async function swapIn(n, guardId, signer, slot, btcPrice) {
  await price(btcPrice);
  const q = await quote('BTC');
  const { out } = fillBuy(CAPITAL, q, BTC_DECIMALS);
  const before = await btcOf(guardId);
  await move(n, `Swap all capital into BTC at $${btcPrice}: USDC goes to the venue`, async () => (
    must(await near.call(signer, guardId, 'place_order', { symbol: 'BTC', usdc: CAPITAL.toString() }), 'place_order')
  ), { [slot]: -CAPITAL, venue: CAPITAL });
  const qty = (await btcOf(guardId)) - before;
  verify(qty === out, `received ${qty} BTC units and the rules predict ${out}`);
  await cashMatchesTokens(guardId);
  return out;
}

// ---- Faucet ---------------------------------------------------------------------------------
const faucet = BigInt(USDC(1000));
await move(1, 'Faucet: the trader gets test USDC', async () => (
  must(await near.call(trader.account, dep.usdc, 'mint', { account_id: trader.id, amount: faucet.toString() }, { gas: '30' }), 'mint')
), { trader: faucet, supply: faucet });

const fee = challengeFee(5000n, 600n, BigInt(config.pass_rate_one_step_bps));
const quoted = BigInt(await near.view(tenor, 'quote_fee', { product: PRODUCT }));
verify(fee === quoted, `contract quotes ${fmtUsd(quoted)} and the rules predict ${fmtUsd(fee)}`);

// ---- Winner: takes a payout, then closes the account ------------------------------------------
console.log('\n=== Path A: a profitable trader ===');
const idA = await buyAndPass(2, fee);
const { guardId: g1, signer: s1 } = await fund(4, idA, 'guard1');
const qty1 = await swapIn(5, g1, s1, 'guard1', BASE_PRICES.BTC);

await price(BASE_PRICES.BTC * 1.02);
const out1 = fillSell(qty1, await quote('BTC'), BTC_DECIMALS).out;
await move(6, 'BTC +2%: sell, and the proceeds return to the Guard', async () => (
  must(await near.call(s1, g1, 'close_position', {}), 'close_position')
), { guard1: out1, supply: out1 });
await cashMatchesTokens(g1);

const profit1 = out1 - CAPITAL;
const traderCut1 = (profit1 * 8000n) / 10000n;
const firmCut1 = profit1 - traderCut1;
await move(7, `Payout: ${fmtUsd(profit1)} profit splits 80/20, capital stays put`, async () => (
  must(await near.call(s1, g1, 'request_payout', { recipient: trader.id }), 'request_payout')
), { guard1: -profit1, trader: traderCut1, treasury: firmCut1 });
const afterPay = await cashMatchesTokens(g1);
verify(BigInt(afterPay.cash) === CAPITAL, `Guard is back to exactly ${fmtUsd(CAPITAL)}`);
verify(BigInt(afterPay.paid_to_trader) === traderCut1 && BigInt(afterPay.paid_to_firm) === firmCut1, 'Guard recorded the same split it paid');

await move(8, 'The trade-only key tries to pay a stranger: nothing may move', async () => {
  const r = await near.call(s1, g1, 'request_payout', { recipient: `stranger-${Date.now()}.${dep.root}` });
  verify(Boolean(r.failed || r.rejected), `the Guard refused: ${(r.error ?? 'no error').slice(0, 100)}`);
  return r;
}, {});

const entry2 = BASE_PRICES.BTC * 1.02;
const qty2 = await swapIn(9, g1, s1, 'guard1', entry2);
await price(entry2 * 1.01);
const out2 = fillSell(qty2, await quote('BTC'), BTC_DECIMALS).out;
const profit2 = out2 - CAPITAL;
const traderCut2 = (profit2 * 8000n) / 10000n;
const firmCut2 = profit2 - traderCut2;
await move(10, 'Trader ends the account: profit splits, all capital returns to the vault', async () => {
  const close = must(await near.call(s1, g1, 'close_position', { end_account: true }), 'end account');
  const pokes = [close];
  for (let i = 0; i < 4; i += 1) {
    if ((await guardState(g1)).status === 'Settled') break;
    await price(entry2 * 1.01);
    pokes.push(must(await near.call(trader.account, tenor, 'poke', { account: g1 }), 'poke'));
  }
  return pokes;
}, {
  supply: out2,
  trader: traderCut2,
  treasury: firmCut2,
  tenor: CAPITAL,
  vault: CAPITAL,
  capital_deployed: -CAPITAL,
  live_max_loss: -MAX_LOSS,
});
const closed = await guardState(g1);
verify(closed.status === 'Settled' && closed.cash === '0', `Guard is ${closed.status} with ${fmtUsd(closed.cash)} left`);
verify((await usdcOf(g1)) === 0n, 'Guard holds no USDC');
verify((await near.accessKeys(g1)).length === 0, 'the trader key has been deleted');

// ---- Loser: breaches, and the reserve pays the difference --------------------------------------
console.log('\n=== Path B: a trader who breaches ===');
const idB = await buyAndPass(11, fee);
const { guardId: g2, signer: s2 } = await fund(13, idB, 'guard2');
const qty3 = await swapIn(14, g2, s2, 'guard2', BASE_PRICES.BTC);

const crash = BASE_PRICES.BTC * 0.96;
await price(crash);
const recovered = fillSell(qty3, await quote('BTC'), BTC_DECIMALS).out;
const shortfall = CAPITAL - recovered;
await move(15, `BTC -4%: breach, forced sale, and the reserve covers the ${fmtUsd(shortfall)} loss`, async () => {
  const txs = [];
  for (let i = 0; i < 5; i += 1) {
    if ((await guardState(g2)).status === 'Settled') break;
    await price(crash);
    txs.push(must(await near.call(trader.account, tenor, 'poke', { account: g2 }), 'poke'));
  }
  return txs;
}, {
  supply: recovered,
  tenor: recovered,
  vault: CAPITAL,
  reserve: -shortfall,
  capital_deployed: -CAPITAL,
  live_max_loss: -MAX_LOSS,
});
const breached = await guardState(g2);
verify(breached.status === 'Settled' && breached.breach_reason === 'daily_loss', `Guard is ${breached.status} (${breached.breach_reason})`);
verify(breached.paid_to_trader === '0', 'a breached trader was paid nothing');
verify((await near.accessKeys(g2)).length === 0, 'the trader key was deleted by the breach');
const denied = await near.call(s2, g2, 'close_position', {});
verify(denied.rejected === true, 'the deleted key can no longer sign');

// ---- Result -----------------------------------------------------------------------------------
const end = await near.view(tenor, 'reserve_state');
const endHeld = await usdcOf(tenor);
const endBooks = BigInt(end.reserve) + BigInt(end.vault);
verify(endHeld === endBooks, `tenor holds ${fmtUsd(endHeld)} and its books say ${fmtUsd(endBooks)}`);

const summary = {
  feesPaid: (fee * 2n).toString(),
  traderReceived: (traderCut1 + traderCut2).toString(),
  firmReceived: (firmCut1 + firmCut2).toString(),
  reserveCoveredLoss: shortfall.toString(),
};
console.log('\nWhere the money went');
see('fees paid into the reserve', fmtUsd(summary.feesPaid));
see('profit paid to the trader', fmtUsd(summary.traderReceived));
see('profit paid to the firm', fmtUsd(summary.firmReceived));
see('breach loss paid by the reserve', fmtUsd(summary.reserveCoveredLoss));

writeFileSync(join(ROOT, 'deployments', `money-proof.${near.network}.json`), `${JSON.stringify({
  network: near.network,
  stack: 'demo',
  ranAt: new Date().toISOString(),
  ok: failures === 0,
  tenor,
  trader: trader.id,
  guards: [g1, g2],
  summary,
  steps: proof,
}, null, 2)}\n`);

if (failures) {
  console.log(`\nFAIL: ${failures} check(s) did not hold.`);
  process.exit(1);
}
console.log('\nPASS: every balance moved by exactly the expected amount, on both paths.');
process.exit(0);
