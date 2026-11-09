// Adds two keys to the oracle's pusher account, each able to call only `push_prices` on one oracle,
// and saves them to apps/web/.env.local for the web app's price keeper. The private halves are never
// printed. Copy the three KEEPER_ values into the hosting provider's environment variables.
//   npm run keeper:keys -- --network testnet
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { KeyPair, Near, ROOT, actions, loadDeployment, must, nearToYocto, see, sponsor } from './lib/near.mjs';

const near = new Near();
if (near.network !== 'testnet') throw new Error('Testnet only: the sandbox signs with its deployer key');
const dep = loadDeployment(near.network);
const root = sponsor(near);
const env = {};
for (const [name, stack] of [['LIVE', dep.live], ['DEMO', dep.demo]]) {
  const key = KeyPair.fromRandom('ed25519');
  must(await near.send(root, root.accountId, [
    actions.addFunctionCallAccessKey(key.getPublicKey(), stack.oracle, ['push_prices'], nearToYocto('1')),
  ]), `add ${name} key`);
  env[`KEEPER_KEY_${name}`] = key.toString();
  see(`${name} key`, `${key.getPublicKey().toString()} can only call push_prices on ${stack.oracle}`);
}
env.KEEPER_ACCOUNT = root.accountId;

const file = join(ROOT, 'apps', 'web', '.env.local');
const kept = existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter((l) => l && !l.startsWith('KEEPER_')) : [];
writeFileSync(file, `${[...kept, ...Object.entries(env).map(([k, v]) => `${k}=${v}`)].join('\n')}\n`);
console.log('Saved to apps/web/.env.local');
process.exit(0);
