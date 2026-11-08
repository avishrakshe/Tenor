// Creates a funded testnet account through NEAR's faucet service and writes its key to .env.
//   npm run faucet -- --name my-name.testnet
// Same endpoint as `near account create-account sponsor-by-faucet-service`.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { KeyPair, Near, ROOT, argValue } from './lib/near.mjs';

const FAUCET = 'https://helper.nearprotocol.com/account';
const near = new Near('testnet');
const name = argValue('name', `tenor-judge-${Date.now().toString(36)}.testnet`);
const asRoot = !process.argv.includes('--no-env');

const keyPair = KeyPair.fromRandom('ed25519');
const r = await fetch(FAUCET, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ newAccountId: name, newAccountPublicKey: keyPair.getPublicKey().toString() }),
});
if (!r.ok) throw new Error(`Faucet refused (${r.status}): ${await r.text()}`);

const { amount } = await near.provider.viewAccount({ accountId: name });
console.log(`Created ${name} with ${(Number(BigInt(amount) / 10n ** 21n) / 1000).toFixed(2)} NEAR`);

if (asRoot) {
  const env = join(ROOT, '.env');
  if (existsSync(env)) {
    const cleaned = readFileSync(env, 'utf8').replace(/^TENOR_ROOT_(ACCOUNT|KEY)=.*\n?/gm, '');
    writeFileSync(env, cleaned);
  }
  appendFileSync(env, `TENOR_ROOT_ACCOUNT=${name}\nTENOR_ROOT_KEY=${keyPair.toString()}\n`);
  console.log('Saved to .env');
} else {
  console.log(`KEY ${keyPair.toString()}`);
}
process.exit(0);
