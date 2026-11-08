// Funds an account, breaches it and shows the key deleted onchain.
// Usage: npm run demo:breach -- --network sandbox
import { KeyPair, fmtUsd, must, see, step } from './lib/near.mjs';
import { BASE_PRICES, passChallenge, setup } from './lib/demo.mjs';

const ctx = await setup('breach');
const { near, tenor, trader, push } = ctx;

step(1, 'Pass an evaluation');
const { id } = await passChallenge(ctx);
see('challenge', id);

step(2, 'fund(): a Guard account is created with only the trader function-call key');
const traderKey = KeyPair.fromRandom('ed25519');
const config = await near.view(tenor, 'get_config');
const before = await near.view(tenor, 'reserve_state');
const funded = must(
  await near.call(trader.account, tenor, 'fund', {
    challenge_id: id, trader_public_key: traderKey.getPublicKey().toString(),
  }, { deposit: config.guard_near_budget }),
  'fund',
);
const guardId = funded.events.find((e) => e.name === 'funded').guard;
see('fund tx', funded.link);
see('guard', near.accountLink(guardId));
const keys = await near.accessKeys(guardId);
see('keys on guard', keys.length);
const perm = keys[0].accessKey?.permission ?? keys[0].access_key?.permission;
see('key permission', JSON.stringify(perm));
const full = keys.filter((k) => (k.accessKey?.permission ?? k.access_key?.permission) === 'FullAccess');
if (keys.length !== 1 || full.length !== 0) throw new Error('Guard must hold exactly one function-call key');
const state = await near.view(guardId, 'get_state');
see('guard status', state.status);
see('capital', fmtUsd(state.cash));
const after = await near.view(tenor, 'reserve_state');
see('live max loss', `${fmtUsd(before.live_max_loss)} -> ${fmtUsd(after.live_max_loss)}`);

step(3, 'Trader signs as the Guard with the function-call key: a real swap');
const key = traderKey.toString();
const guard = near.account(guardId, key);
must(await push(BASE_PRICES), 'push prices');
const order = must(await near.call(guard, guardId, 'place_order', { symbol: 'BTC', usdc: state.cash }), 'place_order');
see('order tx', order.link);
see('events', order.events.map((e) => e.name).join(', '));
const held = await near.view(guardId, 'get_state');
see('position', held.positions.map((p) => `${p.qty} ${p.symbol}`).join(', '));
if (held.positions.length !== 1) throw new Error('Expected an open position');

step(4, 'BTC falls 4%: more than the 3% daily limit. Anyone can poke()');
must(await push({ ...BASE_PRICES, BTC: BASE_PRICES.BTC * 0.96 }), 'push prices');
const poke = must(await near.call(trader.account, tenor, 'poke', { account: guardId }), 'poke');
see('poke tx', poke.link);
see('events', poke.events.map((e) => e.name).join(', '));
const breached = await near.view(guardId, 'get_state');
see('status', `${breached.status} (${breached.breach_reason})`);

step(5, 'The trader key is gone from the chain');
const remaining = await near.accessKeys(guardId);
see('keys on guard', remaining.length);
if (remaining.length !== 0) throw new Error('Key should have been deleted');
const denied = await near.call(guard, guardId, 'close_position', {});
see('trader tries to trade', denied.rejected ? `rejected by the protocol: ${denied.error.slice(0, 90)}` : 'unexpected success');
if (!denied.rejected) throw new Error('Deleted key must not sign');

step(6, 'Permissionless settlement returns the capital to tenor');
for (let i = 0; i < 4; i += 1) {
  const s = await near.view(guardId, 'get_state');
  if (s.status === 'Settled') break;
  must(await push({ ...BASE_PRICES, BTC: BASE_PRICES.BTC * 0.96 }), 'push prices');
  must(await near.call(trader.account, tenor, 'poke', { account: guardId }), 'poke');
}
const settled = await near.view(guardId, 'get_state');
const reserve = await near.view(tenor, 'reserve_state');
see('guard status', settled.status);
see('live max loss', fmtUsd(reserve.live_max_loss));
const record = (await near.view(tenor, 'list_funded', { from_index: 0, limit: 100 })).find((f) => f.guard === guardId);
see('capital returned', fmtUsd(record.returned));
if (settled.status !== 'Settled' || !record.settled) throw new Error('Expected settlement');
console.log(`\nPASS: ${guardId} breached, key deleted, capital returned.`);
process.exit(0);
