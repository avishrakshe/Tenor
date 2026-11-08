// Sandbox only: creates a throwaway local account so the UI works with no wallet and no funds.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextResponse } from 'next/server';
import { Account, JsonRpcProvider, KeyPair, nearToYocto, type KeyPairString } from 'near-api-js';
import { getConfig } from '@/lib/config';

export async function POST() {
  const config = getConfig();
  if (config.network !== 'sandbox') return NextResponse.json({ message: 'Sandbox only' }, { status: 404 });
  const deployer = JSON.parse(readFileSync(join(process.cwd(), '..', '..', '.sandbox', 'deployer.json'), 'utf8'));
  const parent = new Account(deployer.accountId, new JsonRpcProvider({ url: config.rpc }), deployer.secretKey as KeyPairString);
  const keyPair = KeyPair.fromRandom('ed25519');
  const accountId = `web-${Date.now().toString(36)}.${deployer.accountId}`;
  await parent.createAccount({ newAccountId: accountId, publicKey: keyPair.getPublicKey().toString(), nearToTransfer: nearToYocto('10') });
  return NextResponse.json({ accountId, secretKey: keyPair.toString() });
}
