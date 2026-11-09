'use client';

import { usePathname } from 'next/navigation';
import { Checkout } from './Cart';
import { Nav } from './Nav';
import { RequireDeployment } from './RequireDeployment';
import { useSession } from './Session';
import { WalletDock } from './WalletDock';

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { config } = useSession();
  const landing = pathname === '/';
  const login = pathname.startsWith('/login');
  const terminal = pathname.startsWith('/trade') || pathname.startsWith('/funded');
  const width = landing || login ? '' : terminal ? 'px-2 md:px-3 pb-3' : 'mx-auto max-w-6xl px-4 pb-16 pt-6';
  return (
    <div className="relative min-h-svh overflow-x-clip">
      {!landing && !login && !terminal && (
        <div className="absolute inset-x-0 top-0 h-80 overflow-hidden" aria-hidden="true">
          <div className="aurora" />
          <div className="dots [mask-image:linear-gradient(black,transparent)]" />
        </div>
      )}
      <Nav />
      {!config.deployed && !landing && !login && (
        <p className="relative z-10 border-y border-line bg-black/60 px-4 py-2 text-center text-xs text-warn">
          Contracts are not deployed on {config.network} yet, so buying and trading are unavailable.
        </p>
      )}
      <main className={`relative z-10 ${width}`}>
        <RequireDeployment>{children}</RequireDeployment>
      </main>
      {!landing && !login && <WalletDock />}
      <Checkout />
    </div>
  );
}
