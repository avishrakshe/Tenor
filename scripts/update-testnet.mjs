// Applies contract updates to an existing deployment: publishes the blocklist if it is missing and
// replaces the Guard code used for future Guards. Existing Guards keep the code they have.
//   npm run update:contracts -- --network testnet
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import bs58 from 'bs58';
import {
  Near, ROOT, actions, loadDeployment, must, nearToYocto, saveDeployment, see, sponsor, teraToGas, wasm,
} from './lib/near.mjs';

const near = new Near();
const dep = loadDeployment(near.network);
const root = near.network === 'sandbox'
  ? (() => {
      const d = JSON.parse(readFileSync(join(ROOT, '.sandbox', 'deployer.json'), 'utf8'));
      return near.account(d.accountId, d.secretKey);
    })()
  : sponsor(near);
const { secretKey } = JSON.parse(readFileSync(join(ROOT, 'keys', `${near.network}-deployer.json`), 'utf8'));

const guardCode = wasm('tenor_guard');
for (const tenor of [dep.live.tenor, dep.demo.tenor]) {
  must(await near.send(root, tenor, [actions.functionCall('set_guard_code', guardCode, teraToGas('100'), 0n)]), `set_guard_code on ${tenor}`);
  see('guard code updated', tenor);
}
dep.guardHash = bs58.encode(createHash('sha256').update(guardCode).digest());

const id = `blocklist.${dep.root}`;
if (!(await near.exists(id))) {
  const code = wasm('tenor_blocklist');
  const { KeyPair } = await import('near-api-js');
  const pk = KeyPair.fromString(secretKey).getPublicKey().toString();
  await root.createAccount({ newAccountId: id, publicKey: pk, nearToTransfer: nearToYocto((code.length / 100_000 + 0.4).toFixed(3)) });
  must(await near.send(near.account(id, secretKey), id, [
    actions.deployContract(code),
    actions.functionCall('new', { owner: dep.root }, teraToGas('100'), 0n),
  ]), 'deploy blocklist');
  see('deployed', id);
}
dep.blocklist = id;
saveDeployment(near.network, dep);
console.log('Updated.');
process.exit(0);
