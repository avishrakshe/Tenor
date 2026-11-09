'use client';

import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { useSignedIn } from '@/lib/login';
import { useSession } from './Session';

/** Bottom-right wallet control. Google opens the app; the NEAR wallet is what signs transactions. */
export function WalletDock() {
  const isSignedIn = useSignedIn();
  // The order ticket fills the bottom-right corner of the trading screens.
  const pathname = usePathname();
  const terminal = pathname.startsWith('/trade') || pathname.startsWith('/funded');
  const { config, accountId, connect, disconnect } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isSignedIn) return null;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`fixed bottom-4 z-30 flex flex-col gap-2 ${terminal ? 'left-4 items-start' : 'right-4 items-end'}`}>
      {error && <p role="alert" className="max-w-xs rounded-lg border border-line bg-panel px-3 py-2 text-xs text-down">{error}</p>}
      {accountId ? (
        <button className="btn btn-ghost num max-w-56 truncate bg-panel" onClick={() => run(disconnect)} disabled={busy} title="Disconnect wallet">
          {accountId}
        </button>
      ) : (
        <button
          className="btn shadow-2xl shadow-black"
          onClick={() => run(connect)}
          disabled={busy || !config.deployed}
          title={config.deployed ? undefined : `Contracts are not deployed on ${config.network} yet`}
        >
          {config.network === 'sandbox' ? 'Create sandbox account' : 'Connect NEAR wallet'}
        </button>
      )}
    </div>
  );
}
