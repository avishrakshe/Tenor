import type { Metadata } from 'next';
import { Nav } from '@/components/Nav';
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
              No {config.network} deployment found. Run npm run deploy -- --network {config.network}.
            </p>
          )}
          <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
        </SessionProvider>
      </body>
    </html>
  );
}
