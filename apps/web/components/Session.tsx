'use client';

// The signed-in trader. On testnet this is a NEAR wallet through near-connect, with a
// function-call key for evaluation trading so orders need no popups:
// https://docs.near.org/web3-apps/tutorials/wallet-login
// On a local sandbox, where no wallet exists, a throwaway account signs instead.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Account, JsonRpcProvider, actions as nearActions, type KeyPairString } from 'near-api-js';
import type { AppConfig } from '@/lib/config';

export type Call = { receiverId: string; method: string; args: object; deposit?: string; gas?: string };

type Session = {
  config: AppConfig;
  accountId: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  send: (call: Call) => Promise<unknown>;
  sendMany: (calls: Call[]) => Promise<unknown[]>;
};

const Ctx = createContext<Session | null>(null);

export const useSession = () => {
  const s = useContext(Ctx);
  if (!s) throw new Error('No session');
  return s;
};

const GAS_300 = '300000000000000';
const SANDBOX_KEY = 'tenor.sandbox.account';

function readStore(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStore(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private windows can refuse storage; the session then lasts for the page only.
  }
}

/** Signs with a key held in this browser, such as a Guard's trader key. */
export async function sendWithKey(rpc: string, accountId: string, key: string, call: Call) {
  const account = new Account(accountId, new JsonRpcProvider({ url: rpc }), key as KeyPairString);
  return account.signAndSendTransaction({
    receiverId: call.receiverId,
    actions: [nearActions.functionCall(call.method, call.args, BigInt(call.gas ?? GAS_300), BigInt(call.deposit ?? '0'))],
    throwOnFailure: false,
    waitUntil: 'FINAL',
  });
}

export function SessionProvider({ config, children }: { config: AppConfig; children: React.ReactNode }) {
  const [accountId, setAccountId] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const connector = useRef<any>(null);
  const sandbox = config.network === 'sandbox';

  useEffect(() => {
    if (sandbox) {
      const saved = readStore(SANDBOX_KEY);
      if (saved) setAccountId(JSON.parse(saved).accountId);
      return;
    }
    if (!config.deployed) return;
    let cancelled = false;
    (async () => {
      const [{ NearConnector }, { createAccessKeyPlugin }] = await Promise.all([
        import('@hot-labs/near-connect'),
        import('function-call-key-plugin'),
      ]);
      const c = new NearConnector({ network: 'testnet' });
      const plugin = createAccessKeyPlugin({
        network: c.network,
        providers: c.providers,
        signIn: {
          contractId: config.stack.tenor,
          methodNames: ['place_order', 'close_position', 'poke'],
          allowance: '1000000000000000000000000',
        },
      });
      await c.use(plugin);
      c.on('wallet:signIn', (t: { accounts: { accountId: string }[] }) => setAccountId(t.accounts[0]?.accountId ?? null));
      c.on('wallet:signOut', () => setAccountId(null));
      connector.current = c;
      try {
        const { accounts } = await c.getConnectedWallet();
        if (!cancelled) setAccountId(accounts[0]?.accountId ?? null);
      } catch {
        // Nobody is connected yet.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sandbox, config.deployed, config.stack.tenor]);

  const signIn = useCallback(async () => {
    if (sandbox) {
      const res = await fetch('/api/dev/account', { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      const created = await res.json();
      writeStore(SANDBOX_KEY, JSON.stringify(created));
      setAccountId(created.accountId);
      return;
    }
    await connector.current?.connect();
  }, [sandbox]);

  const signOut = useCallback(async () => {
    if (sandbox) {
      try {
        localStorage.removeItem(SANDBOX_KEY);
      } catch {
        // Nothing stored.
      }
      setAccountId(null);
      return;
    }
    await connector.current?.disconnect();
  }, [sandbox]);

  const send = useCallback(
    async (call: Call) => {
      if (sandbox) {
        const saved = readStore(SANDBOX_KEY);
        if (!saved) throw new Error('Sign in first');
        const { accountId: id, secretKey } = JSON.parse(saved);
        return sendWithKey(config.rpc, id, secretKey, call);
      }
      const wallet = await connector.current.wallet();
      return wallet.signAndSendTransaction({
        receiverId: call.receiverId,
        actions: [
          {
            type: 'FunctionCall',
            params: {
              methodName: call.method,
              args: call.args,
              gas: call.gas ?? GAS_300,
              deposit: call.deposit ?? '0',
            },
          },
        ],
      });
    },
    [sandbox, config.rpc],
  );

  const sendMany = useCallback(
    async (calls: Call[]) => {
      if (sandbox) {
        const out: unknown[] = [];
        for (const call of calls) out.push(await send(call));
        return out;
      }
      const wallet = await connector.current.wallet();
      return wallet.signAndSendTransactions({
        transactions: calls.map((call) => ({
          receiverId: call.receiverId,
          actions: [{ type: 'FunctionCall', params: { methodName: call.method, args: call.args, gas: call.gas ?? GAS_300, deposit: call.deposit ?? '0' } }],
        })),
      });
    },
    [sandbox, send],
  );

  const value = useMemo(
    () => ({ config, accountId, signIn, signOut, send, sendMany }),
    [config, accountId, signIn, signOut, send, sendMany],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
