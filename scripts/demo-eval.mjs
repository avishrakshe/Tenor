// Buys a challenge, trades it onchain and passes. Usage: npm run demo:eval -- --network sandbox
import { fmtUsd, see, step } from './lib/near.mjs';
import { BASE_PRICES, passChallenge, setup } from './lib/demo.mjs';

const ctx = await setup('eval', { fundable: false });
const { near, tenor, trader, challenge } = ctx;

step(1, `Trader ${trader.id} takes USDC from the faucet and buys classic-1-5000`);
const { id, fee, order, poke, tx } = await passChallenge(ctx);
see('fee paid', fmtUsd(fee));
see('buy tx', tx.link);

step(2, 'All-in BTC order, filled at the oracle price inside the contract');
see('oracle BTC', `$${BASE_PRICES.BTC}`);
see('order tx', order.link);

step(3, 'BTC moves +11%, then anyone calls poke()');
see('poke tx', poke.link);

const c = await challenge(id);
step(4, 'Result, read back from the contract');
see('status', c.status);
see('equity', fmtUsd(c.cash));
see('events', poke.events.map((e) => e.name).join(', '));
if (c.status !== 'Passed') throw new Error('Expected the challenge to pass');
console.log(`\nPASS: challenge ${id} on ${tenor} passed with no backend involved.`);
void near;
process.exit(0);
