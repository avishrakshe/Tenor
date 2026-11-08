// Small wrapper over near-api-js v7 used by deploy, demos, keeper and agent.
// RPC: https://docs.near.org/api/rpc/providers
import 'dotenv/config';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Account, JsonRpcProvider, KeyPair, actions, teraToGas, nearToYocto } from 'near-api-js';

export { KeyPair, actions, teraToGas, nearToYocto, Account };

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const NETWORKS = {
  sandbox: { rpc: 'http://127.0.0.1:3030', explorer: null },
  testnet: {
    rpc: process.env.NEAR_TESTNET_RPC || 'https://test.rpc.fastnear.com',
    explorer: 'https://testnet.nearblocks.io',
  },
};

export function argValue(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

export const networkName = () => argValue('network', process.env.TENOR_NETWORK || 'testnet');

export class Near {
  constructor(network = networkName()) {
    if (!NETWORKS[network]) throw new Error(`Unknown network ${network}`);
    this.network = network;
    this.config = NETWORKS[network];
    this.provider = new JsonRpcProvider({ url: this.config.rpc });
  }

  account(id, secretKey) {
    return new Account(id, this.provider, secretKey);
  }

  view(contractId, method, args = {}) {
    return this.provider.callFunction({ contractId, method, args });
  }

  txLink(hash) {
    return this.config.explorer ? `${this.config.explorer}/txns/${hash}` : `(sandbox tx ${hash})`;
  }

  accountLink(id) {
    return this.config.explorer ? `${this.config.explorer}/address/${id}` : `(sandbox account ${id})`;
  }

  async accessKeys(accountId) {
    const list = await new Account(accountId, this.provider).getAccessKeyList();
    return list.keys;
  }

  async exists(accountId) {
    try {
      await this.provider.viewAccount({ accountId });
      return true;
    } catch {
      return false;
    }
  }

  /** Sends a transaction and reports what happened instead of throwing on contract failure. */
  async send(account, receiverId, txActions) {
    let outcome;
    try {
      outcome = await account.signAndSendTransaction({
        receiverId,
        actions: txActions,
        throwOnFailure: false,
        waitUntil: 'FINAL',
      });
    } catch (e) {
      return { rejected: true, error: e?.message || String(e), logs: [], events: [] };
    }
    return summarize(outcome, this);
  }

  call(account, contractId, method, args = {}, { gas = '300', deposit = '0' } = {}) {
    return this.send(account, contractId, [
      actions.functionCall(method, args, teraToGas(gas), BigInt(deposit)),
    ]);
  }
}

export function summarize(outcome, near) {
  const receipts = [outcome.transaction_outcome, ...outcome.receipts_outcome];
  const logs = receipts.flatMap((r) => r.outcome.logs);
  const events = logs
    .filter((l) => l.startsWith('EVENT_JSON:'))
    .map((l) => JSON.parse(l.slice('EVENT_JSON:'.length)))
    .map((e) => ({ name: e.event, ...e.data[0] }));
  const failures = receipts
    .map((r) => r.outcome.status?.Failure)
    .filter(Boolean)
    .map((f) => JSON.stringify(f));
  const hash = outcome.transaction.hash;
  return {
    hash,
    link: near?.txLink(hash),
    logs,
    events,
    failed: failures.length > 0,
    error: failures[0],
    value: successValue(outcome),
  };
}

function successValue(outcome) {
  const v = outcome.status?.SuccessValue;
  if (v === undefined || v === '') return undefined;
  try {
    return JSON.parse(Buffer.from(v, 'base64').toString());
  } catch {
    return undefined;
  }
}

/** Throws with the contract's error if a transaction didn't fully succeed. */
export function must(result, what) {
  if (result.rejected || result.failed) {
    throw new Error(`${what} failed: ${result.error}`);
  }
  return result;
}

export const deploymentPath = (network) => join(ROOT, 'deployments', `${network}.json`);

export function loadDeployment(network) {
  const p = deploymentPath(network);
  if (!existsSync(p)) throw new Error(`No deployment for ${network}. Run: npm run deploy -- --network ${network}`);
  return JSON.parse(readFileSync(p, 'utf8'));
}

export function saveDeployment(network, data) {
  const p = deploymentPath(network);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
}

export const wasm = (name) => readFileSync(join(ROOT, 'wasm', `${name}.wasm`));

export const USDC = (n) => (BigInt(n) * 1_000_000n).toString();
export const fmtUsd = (micro) => `$${(Number(BigInt(micro)) / 1e6).toFixed(2)}`;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function step(n, text) {
  console.log(`\n[${n}] ${text}`);
}

export function see(label, value) {
  console.log(`    ${label}: ${value}`);
}

// Same table as `MARKETS` in crates/tenor-rules. Feed ids: hermes.pyth.network/v2/price_feeds.
export const MARKETS = [
  { symbol: 'BTC', decimals: 8, feed: 'e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43' },
  { symbol: 'ETH', decimals: 18, feed: 'ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace' },
  { symbol: 'SOL', decimals: 9, feed: 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d' },
  { symbol: 'NEAR', decimals: 24, feed: 'c415de8d2eba7db216527dff4b60e8f3a5311c740dadb233e13e12547e226750' },
];

/** Posts one price per market. `pricesUsd` maps symbol to a USD number. */
export function pushPrices(near, pusher, oracle, pricesUsd) {
  const now = Math.floor(Date.now() / 1000);
  const updates = MARKETS.filter((m) => pricesUsd[m.symbol]).map((m) => {
    const price = BigInt(Math.round(pricesUsd[m.symbol] * 1e8));
    return {
      price_id: m.feed,
      price: price.toString(),
      // Fixed 0.03% spread: the source has no confidence interval.
      conf: ((price * 3n) / 10_000n).toString(),
      expo: -8,
      publish_time: now,
    };
  });
  return near.call(pusher, oracle, 'push_prices', { updates }, { gas: '50' });
}

/** A throwaway account: a sandbox sub-account, or on testnet a sub-account of the sponsor. */
export async function createThrowaway(near, parent, label, amountNear) {
  const keyPair = KeyPair.fromRandom('ed25519');
  const id = `${label}-${Date.now().toString(36)}.${parent.accountId}`;
  await parent.createAccount({
    newAccountId: id,
    publicKey: keyPair.getPublicKey().toString(),
    nearToTransfer: nearToYocto(amountNear),
  });
  return { id, key: keyPair.toString(), account: near.account(id, keyPair.toString()) };
}

/** Root account from the sandbox's genesis key, or from .env on testnet. */
export function sponsor(near) {
  if (near.network === 'sandbox') {
    const home = process.env.TENOR_SANDBOX_KEY_FILE || join(ROOT, '.sandbox', 'validator_key.json');
    const key = JSON.parse(readFileSync(home, 'utf8'));
    return near.account(key.account_id, key.secret_key);
  }
  const id = process.env.TENOR_ROOT_ACCOUNT;
  const key = process.env.TENOR_ROOT_KEY;
  if (!id || !key) throw new Error('Set TENOR_ROOT_ACCOUNT and TENOR_ROOT_KEY in .env');
  return near.account(id, key);
}
