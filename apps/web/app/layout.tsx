import type { Metadata } from 'next';
import { Nav } from '@/components/Nav';
import { RequireDeployment } from '@/components/RequireDeployment';
import { SessionProvider } from '@/components/Session';
import { getConfig } from '@/lib/config';
import './globals.css';

export const metadata: Metadata = {
  title: 'Tenor',
  description: 'A prop firm whose rules are NEAR contracts. It cannot trade against you.',
};

export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const config = getConfig();
  return (
    <html lang="en">
      <body>
        <SessionProvider config={config}>
          <Nav />
          {!config.deployed && (
            <p className="border-b border-line bg-panel px-4 py-2 text-center text-sm text-warn">
              Contracts are not deployed on {config.network} yet, so trading is unavailable.
            </p>
          )}
          <main className="mx-auto max-w-6xl px-4 py-8">
            <RequireDeployment>{children}</RequireDeployment>
          </main>
        </SessionProvider>
      </body>
    </html>
  );
}
