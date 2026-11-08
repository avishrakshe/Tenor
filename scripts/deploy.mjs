// Deploys two stacks from a root account. Usage: npm run deploy -- --network sandbox|testnet
//
//   live:  <root>        tenor, real-time prices pushed by the keeper
//   demo:  demo.<root>   tenor, scripted open-push oracle so pass and breach take seconds
//
// Both share the mock tokens. The Guard code is published once as a global contract by hash.
// Global contracts: https://docs.near.org/smart-contracts/global-contracts
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import bs58 from 'bs58';
import {
  Near, KeyPair, USDC, actions, argValue, must, nearToYocto, saveDeployment, sponsor, wasm, MARKETS, teraToGas, see, step,
} from './lib/near.mjs';

const near = new Near();
const root = sponsor(near);
const rootId = near.network === 'sandbox' ? `tenor.${root.accountId}` : root.accountId;
const useGlobal = argValue('guard', process.env.TENOR_GUARD_DEPLOY || 'global') === 'global';

// One key signs every contract account the deployer creates.
const deployKey = KeyPair.fromRandom('ed25519');
const deployKeyStr = deployKey.toString();
const deployPk = deployKey.getPublicKey().toString();

async function ensureRoot() {
  if (near.network !== 'sandbox') return root;
  await root.createAccount({ newAccountId: rootId, publicKey: deployPk, nearToTransfer: nearToYocto('1000') });
  return near.account(rootId, deployKeyStr);
}

async function createAndDeploy(parent, id, code, method, args, amount) {
  await parent.createAccount({ newAccountId: id, publicKey: deployPk, nearToTransfer: nearToYocto(amount) });
  const acc = near.account(id, deployKeyStr);
  must(
    await near.send(acc, id, [
      actions.deployContract(code),
      actions.functionCall(method, args, teraToGas('100'), 0n),
    ]),
    `deploy ${id}`,
  );
  see('deployed', id);
  return acc;
}

const ft = wasm('mock_ft');
const parent = await ensureRoot();
const id = (s) => `${s}.${rootId}`;

const treasuryId = id('treasury');
await parent.createAccount({ newAccountId: treasuryId, publicKey: deployPk, nearToTransfer: nearToYocto('1') });
const treasury = near.account(treasuryId, deployKeyStr);

step(1, 'Mock tokens');
const usdcId = id('usdc');
await createAndDeploy(parent, usdcId, ft, 'new', { name: 'Mock USDC', symbol: 'USDC', decimals: 6 }, '3');
const tokens = {};
for (const m of MARKETS) {
  tokens[m.symbol] = id(m.symbol.toLowerCase());
  await createAndDeploy(parent, tokens[m.symbol], ft, 'new', { name: `Mock ${m.symbol}`, symbol: m.symbol, decimals: m.decimals }, '3');
}
const markets = MARKETS.map((m) => ({ symbol: m.symbol, token: tokens[m.symbol], pool_id: 0 }));

step(2, 'Guard code');
const guardCode = wasm('tenor_guard');
const guardHash = bs58.encode(createHash('sha256').update(guardCode).digest());
if (useGlobal) {
  const needed = Math.ceil(guardCode.length / 10_000) + 2;
  await parent.createAccount({ newAccountId: id('guard-code'), publicKey: deployPk, nearToTransfer: nearToYocto(String(needed)) });
  const publisher = near.account(id('guard-code'), deployKeyStr);
  await publisher.deployGlobalContract(guardCode, 'codeHash');
  see('global contract hash', guardHash);
}

async function deployStack(prefix, tenorAccountId, openOracle, parentAcc) {
  const oracleId = id(`${prefix}oracle`);
  const swapId = id(`${prefix}swap`);
  await createAndDeploy(parent, oracleId, wasm('tenor_oracle'), 'new', {
    owner: rootId, pusher: rootId, open_push: openOracle, stale_threshold: 60,
  }, '3');
  await createAndDeploy(parent, swapId, wasm('mock_swap'), 'new', {
    oracle: oracleId, usdc: usdcId, markets: markets.map(({ symbol, token }) => ({ symbol, token })),
  }, '3');

  const init = {
    init: {
      owner: rootId,
      treasury: treasuryId,
      usdc: usdcId,
      oracle: oracleId,
      venue: swapId,
      venue_kind: 'MockSwap',
      markets,
      guard_near_budget: nearToYocto(useGlobal ? '1' : '4').toString(),
      guard_code_hash: useGlobal ? guardHash : null,
      allow_demo_funding: true,
      // Checked at 10x the gas price when signing: a 300 TGas call needs 0.3 NEAR of allowance,
      // so the 0.25 NEAR usually suggested can't sign one. Unused gas is credited back.
      key_allowance: nearToYocto('1').toString(),
    },
  };
  const code = wasm('tenor');
  if (tenorAccountId === rootId) {
    must(await near.send(parentAcc, rootId, [
      actions.deployContract(code),
      actions.functionCall('new', init, teraToGas('100'), 0n),
    ]), 'deploy tenor');
    see('deployed', rootId);
  } else {
    await createAndDeploy(parent, tenorAccountId, code, 'new', init, '8');
  }
  if (!useGlobal) {
    const owner = tenorAccountId === rootId ? parentAcc : near.account(tenorAccountId, deployKeyStr);
    must(
      await near.send(owner, tenorAccountId, [actions.functionCall('set_guard_code', guardCode, teraToGas('100'), 0n)]),
      'set_guard_code',
    );
  }

  // Capital and reserve are mock USDC on testnet. Live numbers are read on /transparency.
  const usdcAdmin = near.account(usdcId, deployKeyStr);
  must(await near.call(usdcAdmin, usdcId, 'mint', { account_id: tenorAccountId, amount: USDC(0) }, { gas: '30' }), 'register tenor');
  must(await near.call(usdcAdmin, usdcId, 'mint', { account_id: treasuryId, amount: USDC(1_000_000) }, { gas: '30' }), 'mint');
  for (const [action, amount] of [['deposit_vault', 750_000], ['deposit_reserve', 100_000]]) {
    must(
      await near.call(treasury, usdcId, 'ft_transfer_call', {
        receiver_id: tenorAccountId, amount: USDC(amount), msg: JSON.stringify({ action }),
      }, { gas: '100', deposit: '1' }),
      action,
    );
  }
  return { tenor: tenorAccountId, oracle: oracleId, swap: swapId };
}

step(3, 'Live stack');
const live = await deployStack('', rootId, false, parent);

step(4, 'Demo stack (scripted oracle, open to anyone)');
const demo = await deployStack('demo-', id('demo'), true, parent);

for (const sw of [live.swap, demo.swap]) {
  const usdcAdmin = near.account(usdcId, deployKeyStr);
  must(await near.call(usdcAdmin, usdcId, 'mint', { account_id: sw, amount: USDC(0) }, { gas: '30' }), 'register swap');
  for (const m of MARKETS) {
    must(await near.call(usdcAdmin, tokens[m.symbol], 'mint', { account_id: sw, amount: '0' }, { gas: '30' }), 'register swap token');
  }
}

saveDeployment(near.network, {
  network: near.network, root: rootId, usdc: usdcId, tokens, guardHash, useGlobal, live, demo,
});
// The key for the contract accounts. Git-ignored.
mkdirSync(new URL('../keys/', import.meta.url), { recursive: true });
const keyFile = new URL(`../keys/${near.network}-deployer.json`, import.meta.url);
writeFileSync(keyFile, JSON.stringify({ accountId: rootId, secretKey: deployKeyStr }));
if (near.network === 'sandbox') {
  writeFileSync(new URL('../.sandbox/deployer.json', import.meta.url), JSON.stringify({ accountId: rootId, secretKey: deployKeyStr }));
}
console.log(`\nDeployed to ${near.network}.`);
process.exit(0);
