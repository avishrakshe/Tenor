// The agent's only way to move money. It checks the receiver first, refuses to sign on block and
// asks a human on warn. This is a convenience layer: the Guard enforces the recipient rule even
// if an agent skips this file entirely.
import { createInterface } from 'node:readline/promises';
import { checkCounterparty, NETWORKS } from '@tenor/counterparty';

/** Without a person at a terminal, a warning is treated as no. */
export async function askOnTerminal(question) {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${question} [y/N] `);
  rl.close();
  return answer.trim().toLowerCase() === 'y';
}

export function guardedAgent({ near, account, guardId, blocklist, owner, askHuman = askOnTerminal, log = console.log }) {
  const net = NETWORKS[near.network];

  async function requestPayout(recipient) {
    const result = await checkCounterparty(net, { blocklist, actor: owner, receiver: recipient, trusted: [owner] });
    log(`    counterparty check on ${recipient}: ${result.verdict.toUpperCase()}`);
    for (const r of result.reasons) log(`      [${r.level}] ${r.text}`);
    if (result.verdict === 'block') return { signed: false, verdict: 'block', result };
    if (result.verdict === 'warn' && !(await askHuman(`Pay ${recipient}?`))) {
      log('    human declined');
      return { signed: false, verdict: 'warn', result };
    }
    const tx = await near.call(account, guardId, 'request_payout', { recipient });
    return { signed: true, verdict: result.verdict, result, tx };
  }

  return { requestPayout };
}
