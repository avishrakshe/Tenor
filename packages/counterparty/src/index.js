// Counterparty check for anything about to pay an account. Returns allow, warn or block, with the
// reasons. Every signal comes from public chain data:
//   blocklist           view call to the Tenor blocklist contract
//   exists, is contract RPC view_account
//   code changed        archival RPC view_account at older blocks, comparing code_hash
//   age, activity       FastNear Transactions API, POST /v0/account
//   prior interactions  transaction hashes shared by the actor's and receiver's histories
// A signal that can't be read asks a human rather than passing silently.

const EMPTY_CODE = '11111111111111111111111111111111';
const DAY = 86_400;
const MIN_AGE_DAYS = 7;
const MIN_TXS = 3;

export const NETWORKS = {
  testnet: {
    rpc: 'https://test.rpc.fastnear.com',
    archivalRpc: 'https://archival-rpc.testnet.fastnear.com',
    txApi: 'https://tx.test.fastnear.com/v0',
  },
  mainnet: {
    rpc: 'https://free.rpc.fastnear.com',
    archivalRpc: 'https://archival-rpc.mainnet.fastnear.com',
    txApi: 'https://tx.main.fastnear.com/v0',
  },
  sandbox: { rpc: 'http://127.0.0.1:3030', archivalRpc: null, txApi: null },
};

async function rpc(url, method, params) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: '1', method, params }),
  });
  return r.json();
}

async function viewAccount(url, account, block) {
  const at = block ? { block_id: block } : { finality: 'final' };
  const j = await rpc(url, 'query', { request_type: 'view_account', account_id: account, ...at });
  if (j.error?.cause?.name === 'UNKNOWN_ACCOUNT') return null;
  if (j.error) throw new Error(j.error.message);
  return j.result;
}

async function history(txApi, body) {
  const r = await fetch(`${txApi}/account`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Transactions API: HTTP ${r.status}`);
  return r.json();
}

async function readBlocklist(url, blocklist, account) {
  const args_base64 = Buffer.from(JSON.stringify({ account })).toString('base64');
  const j = await rpc(url, 'query', { request_type: 'call_function', finality: 'final', account_id: blocklist, method_name: 'status', args_base64 });
  if (j.error || j.result?.error) throw new Error('Blocklist unreadable');
  return JSON.parse(Buffer.from(j.result.result).toString());
}

/** Block height roughly `days` ago, from the observed block rate. */
async function heightDaysAgo(net, days) {
  const latest = await rpc(net.rpc, 'block', { finality: 'final' });
  const height = latest.result.header.height;
  const earlier = await rpc(net.archivalRpc, 'block', { block_id: height - 50_000 });
  const secs = (latest.result.header.timestamp - earlier.result.header.timestamp) / 1e9;
  return Math.max(1, Math.floor(height - (days * DAY * 50_000) / secs));
}

async function codeHashAt(net, account, days) {
  const height = await heightDaysAgo(net, days);
  const v = await viewAccount(net.archivalRpc, account, height);
  return v ? v.code_hash : null;
}

const attempt = async (fn) => {
  try {
    return await fn();
  } catch {
    return undefined;
  }
};

export const isImplicit = (id) => /^[0-9a-f]{64}$/.test(id) || /^0x[0-9a-f]{40}$/.test(id);

/** Reads every signal. `undefined` means the source could not be reached. */
export async function gatherSignals(net, { blocklist, actor, receiver }) {
  const signals = { receiver, implicit: isImplicit(receiver) };
  signals.blocklist = blocklist ? await attempt(() => readBlocklist(net.rpc, blocklist, receiver)) : undefined;
  const account = await attempt(() => viewAccount(net.rpc, receiver));
  signals.exists = account === undefined ? undefined : account !== null;
  signals.isContract = account ? account.code_hash !== EMPTY_CODE : account === null ? false : undefined;

  if (signals.isContract && net.archivalRpc) {
    signals.codeChanged1d = await attempt(async () => (await codeHashAt(net, receiver, 1)) !== account.code_hash);
    signals.codeChanged7d = await attempt(async () => (await codeHashAt(net, receiver, 7)) !== account.code_hash);
  }
  if (net.txApi && signals.exists) {
    const first = await attempt(() => history(net.txApi, { account_id: receiver, desc: false, limit: 1 }));
    if (first) {
      signals.txCount = first.txs_count ?? first.account_txs.length;
      const ts = first.account_txs[0]?.tx_block_timestamp;
      signals.ageDays = ts ? (Date.now() / 1000 - Number(BigInt(ts) / 1_000_000_000n)) / DAY : 0;
    }
    if (actor) {
      const [a, b] = await Promise.all([
        attempt(() => history(net.txApi, { account_id: actor, limit: 200 })),
        attempt(() => history(net.txApi, { account_id: receiver, limit: 200 })),
      ]);
      if (a && b) {
        const mine = new Set(a.account_txs.map((t) => t.transaction_hash));
        signals.priorInteractions = b.account_txs.filter((t) => mine.has(t.transaction_hash)).length;
      }
    }
  }
  return signals;
}

const RANK = { allow: 0, info: 0, warn: 1, block: 2 };

/** Pure scoring, so the policy can be tested and audited on its own. */
export function score(s, { trusted = [] } = {}) {
  const reasons = [];
  const add = (level, text) => reasons.push({ level, text });

  if (trusted.includes(s.receiver)) {
    return { verdict: 'allow', reasons: [{ level: 'info', text: 'This is your own account.' }], signals: s };
  }

  if (s.blocklist === undefined) add('warn', 'The shared blocklist could not be read.');
  else if (s.blocklist.blocked) add('block', `On the shared blocklist${s.blocklist.confirmed ? ', confirmed' : ''} with ${s.blocklist.reports} report${s.blocklist.reports === 1 ? '' : 's'}.`);
  else if (s.blocklist.reports > 0) add('warn', 'One unconfirmed report on the shared blocklist.');

  if (s.exists === undefined) add('warn', 'Could not confirm that this account exists.');
  else if (!s.exists) {
    if (s.implicit) add('warn', 'New implicit address with no activity. Expected for a 1Click deposit address, suspicious otherwise.');
    else add('block', 'This named account does not exist, so funds sent to it could be lost.');
  }

  if (s.exists) {
    if (s.isContract) {
      add('warn', 'The receiver is a contract, not a person.');
      if (s.codeChanged1d) add('block', 'Its contract code changed in the last 24 hours.');
      else if (s.codeChanged7d) add('warn', 'Its contract code changed in the last 7 days.');
      else if (s.codeChanged7d === undefined) add('warn', 'Could not check whether its code changed recently.');
    }
    if (s.ageDays === undefined) add('warn', 'Could not check how old this account is.');
    else if (s.ageDays < MIN_AGE_DAYS) add('warn', `The account is only ${s.ageDays < 1 ? 'hours' : `${Math.floor(s.ageDays)} days`} old.`);
    if (s.txCount !== undefined && s.txCount < MIN_TXS) add('warn', `Very little history: ${s.txCount} transaction${s.txCount === 1 ? '' : 's'}.`);
    if (s.priorInteractions > 0) add('info', `You have ${s.priorInteractions} past transaction${s.priorInteractions === 1 ? '' : 's'} with this account.`);
    else if (s.priorInteractions === 0) add('info', 'First time paying this account.');
  }

  const worst = reasons.reduce((m, r) => Math.max(m, RANK[r.level]), 0);
  const verdict = worst === 2 ? 'block' : worst === 1 ? 'warn' : 'allow';
  if (reasons.length === 0) reasons.push({ level: 'info', text: 'No warning signs.' });
  return { verdict, reasons: reasons.sort((a, b) => RANK[b.level] - RANK[a.level]), signals: s };
}

export async function checkCounterparty(net, query) {
  return score(await gatherSignals(net, query), { trusted: query.trusted });
}
