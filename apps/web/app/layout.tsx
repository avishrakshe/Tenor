import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import type { Metadata } from 'next';
import { CartProvider } from '@/components/Cart';
import { SessionProvider } from '@/components/Session';
import { Shell } from '@/components/Shell';
import { getConfig } from '@/lib/config';
import './globals.css';

export const metadata: Metadata = {
  title: 'Tenor',
  description: 'A prop firm whose rules are NEAR contracts. It cannot trade against you.',
};

export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <SessionProvider config={getConfig()}>
          <CartProvider>
            <Shell>{children}</Shell>
          </CartProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
