// A small trading agent that holds only a Guard's function-call key.
//
//   TENOR_GUARD=<guard account> TENOR_AGENT_KEY=ed25519:... npm run agent -- --network testnet
//
// Without --llm it runs a scripted policy: buy a small BTC position when flat, otherwise close.
import { Near, sleep } from '../scripts/lib/near.mjs';

const guardId = process.env.TENOR_GUARD;
const key = process.env.TENOR_AGENT_KEY;
if (!guardId || !key) throw new Error('Set TENOR_GUARD and TENOR_AGENT_KEY');

const near = new Near();
const agent = near.account(guardId, key);

for (let i = 0; i < Number(process.env.TENOR_AGENT_STEPS || 4); i += 1) {
  const s = await near.view(guardId, 'get_state');
  if (s.status !== 'Active') {
    console.log(`Account is ${s.status}. Stopping.`);
    break;
  }
  const r = s.positions.length
    ? await near.call(agent, guardId, 'close_position', {})
    : await near.call(agent, guardId, 'place_order', { symbol: 'BTC', usdc: (BigInt(s.cash) / 20n).toString() });
  console.log(s.positions.length ? 'close' : 'buy', r.rejected ? r.error : r.events.map((e) => e.name).join(','));
  await sleep(2000);
}
process.exit(0);
