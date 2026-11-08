// Pushes prices to the live stack's oracle and pokes active accounts. Anyone can run the poke
// side; only the oracle's pusher account can run the price side.
//
//   npm run keeper -- --network testnet [--once]
//
// Prices come from the 1Click token list (GET /v0/tokens), which is free and needs no key. It
// has no confidence interval, so the oracle gets a fixed 0.03% spread.
// https://docs.near-intents.org/api-reference/oneclick/get-supported-tokens
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Near, MARKETS, ROOT, argValue, loadDeployment, pushPrices, sleep, sponsor } from '../scripts/lib/near.mjs';

const INTERVAL_MS = Number(argValue('interval', 30)) * 1000;
const once = process.argv.includes('--once');
const duration = Number(argValue('duration', 0)) * 1000;
const started = Date.now();
const near = new Near();
const dep = loadDeployment(near.network);
function keeperAccount() {
  if (near.network !== 'sandbox') return sponsor(near);
  const d = JSON.parse(readFileSync(join(ROOT, '.sandbox', 'deployer.json'), 'utf8'));
  return near.account(d.accountId, d.secretKey);
}
const keeper = keeperAccount();

// Symbol to the blockchain listing used as the reference price.
const SOURCES = { BTC: 'btc', ETH: 'eth', SOL: 'sol', NEAR: 'near' };

export async function fetchPrices() {
  const r = await fetch('https://1click.chaindefuser.com/v0/tokens');
  if (!r.ok) throw new Error(`1Click tokens: HTTP ${r.status}`);
  const tokens = await r.json();
  const prices = {};
  for (const m of MARKETS) {
    const symbol = m.symbol === 'NEAR' ? 'wNEAR' : m.symbol;
    const t = tokens.find((x) => x.symbol === symbol && x.blockchain === SOURCES[m.symbol]);
    if (t?.price > 0) prices[m.symbol] = t.price;
  }
  return prices;
}

async function activeAccounts() {
  const ids = await near.view(dep.live.tenor, 'active_challenge_ids', { from_index: 0, limit: 200 });
  const funded = await near.view(dep.live.tenor, 'list_funded', { from_index: 0, limit: 200 });
  return [...ids.map(String), ...funded.filter((f) => !f.settled).map((f) => f.guard)];
}

async function tick() {
  const prices = await fetchPrices();
  const pushed = await pushPrices(near, keeper, dep.live.oracle, prices);
  console.log(new Date().toISOString(), 'prices', JSON.stringify(prices), pushed.failed || pushed.rejected ? `FAILED ${pushed.error}` : 'ok');
  for (const account of await activeAccounts()) {
    const r = await near.call(keeper, dep.live.tenor, 'poke', { account });
    const names = r.events.map((e) => e.name);
    if (names.length) console.log('  poke', account, names.join(','));
  }
}

for (;;) {
  try {
    await tick();
  } catch (e) {
    console.error('keeper error:', e.message);
  }
  if (once || (duration > 0 && Date.now() - started >= duration)) break;
  await sleep(INTERVAL_MS);
}
process.exit(0);
