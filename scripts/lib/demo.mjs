// Shared setup for the demo scripts. Everything runs on the demo stack, whose oracle anyone can
// post to, so a price move can be scripted instead of waited for.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  Near, ROOT, USDC, createThrowaway, loadDeployment, must, nearToYocto, pushPrices, sponsor,
} from './near.mjs';

export const BASE_PRICES = { BTC: 75000, ETH: 2200, SOL: 150, NEAR: 3.7 };

/** `fundable` runs create a Guard, which costs the trader its storage and gas budget. */
export async function setup(label, { fundable = true, amount } = {}) {
  const near = new Near();
  const dep = loadDeployment(near.network);
  let parent = sponsor(near);
  if (near.network === 'sandbox') {
    const d = JSON.parse(readFileSync(join(ROOT, '.sandbox', 'deployer.json'), 'utf8'));
    parent = near.account(d.accountId, d.secretKey);
  }
  const trader = await createThrowaway(near, parent, label, near.network === 'sandbox' ? '30' : amount ?? (fundable ? '4.5' : '0.6'));
  const tenor = dep.demo.tenor;
  const push = (prices) => pushPrices(near, trader.account, dep.demo.oracle, prices);
  const challenge = (id) => near.view(tenor, 'get_challenge', { id });
  must(await push(BASE_PRICES), 'push prices');
  return { near, dep, trader, tenor, push, challenge, parent };
}

export async function buyChallenge({ near, dep, trader, tenor }, product) {
  const fee = await near.view(tenor, 'quote_fee', { product });
  must(await near.call(trader.account, dep.usdc, 'mint', { account_id: trader.id, amount: USDC(1000) }, { gas: '30' }), 'faucet');
  const r = must(
    await near.call(trader.account, dep.usdc, 'ft_transfer_call', {
      receiver_id: tenor, amount: fee, msg: JSON.stringify({ action: 'buy', product }),
    }, { gas: '100', deposit: '1' }),
    'buy challenge',
  );
  const opened = r.events.find((e) => e.name === 'challenge_opened');
  return { id: opened.id, fee, tx: r };
}

/** Buys a challenge, goes all-in on BTC and scripts a +11% move, so it passes. */
export async function passChallenge(ctx, product = 'classic-1-5000') {
  const { near, trader, tenor, push } = ctx;
  const bought = await buyChallenge(ctx, product);
  const c = await ctx.challenge(bought.id);
  const order = must(
    await near.call(trader.account, tenor, 'place_order', {
      challenge_id: bought.id, symbol: 'BTC', usdc: c.cash,
    }),
    'place_order',
  );
  must(await push({ ...BASE_PRICES, BTC: BASE_PRICES.BTC * 1.11 }), 'push prices');
  const poke = must(await near.call(trader.account, tenor, 'poke', { account: String(bought.id) }), 'poke');
  return { ...bought, order, poke };
}

export { nearToYocto };
