import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cookies } from 'next/headers';

export type Stack = { tenor: string; oracle: string; swap: string };

export type AppConfig = {
  network: 'sandbox' | 'testnet';
  stackName: 'live' | 'demo';
  rpc: string;
  explorer: string | null;
  deployed: boolean;
  usdc: string;
  blocklist: string;
  tokens: Record<string, string>;
  stack: Stack;
};

const RPC = { sandbox: 'http://127.0.0.1:3030', testnet: 'https://test.rpc.fastnear.com' };
const EXPLORER = { sandbox: null, testnet: 'https://testnet.nearblocks.io' };

/** The stack this visitor chose with the demo switch, or the deployment's default. */
export async function getRequestConfig(): Promise<AppConfig> {
  const chosen = (await cookies()).get('tenor.stack')?.value;
  return getConfig(chosen === 'demo' || chosen === 'live' ? chosen : undefined);
}

/** Reads the contract ids written by `npm run deploy`. Server only. */
export function getConfig(stack?: AppConfig['stackName']): AppConfig {
  const network = (process.env.NEXT_PUBLIC_NETWORK as AppConfig['network']) || 'testnet';
  const stackName = stack ?? ((process.env.NEXT_PUBLIC_STACK as AppConfig['stackName']) || 'live');
  const base = { network, stackName, rpc: RPC[network], explorer: EXPLORER[network] };
  try {
    const raw = readFileSync(join(process.cwd(), '..', '..', 'deployments', `${network}.json`), 'utf8');
    const dep = JSON.parse(raw);
    return { ...base, deployed: true, usdc: dep.usdc, blocklist: dep.blocklist ?? '', tokens: dep.tokens, stack: dep[stackName] };
  } catch {
    return { ...base, deployed: false, usdc: '', blocklist: '', tokens: {}, stack: { tenor: '', oracle: '', swap: '' } };
  }
}
