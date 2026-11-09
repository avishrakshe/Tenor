import { ClerkProvider } from '@clerk/nextjs';
import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import type { Metadata } from 'next';
import { CartProvider } from '@/components/Cart';
import { SessionProvider } from '@/components/Session';
import { Shell } from '@/components/Shell';
import { getRequestConfig } from '@/lib/config';
import { loginEnabled } from '@/lib/login-mode';
import './globals.css';

export const metadata: Metadata = {
  title: 'Tenor',
  description: 'A prop firm whose rules are NEAR contracts. It cannot trade against you.',
};

export const dynamic = 'force-dynamic';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const config = await getRequestConfig();
  const app = (
    <SessionProvider config={config}>
      <CartProvider>
        <Shell>{children}</Shell>
      </CartProvider>
    </SessionProvider>
  );
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        {loginEnabled ? <ClerkProvider signInUrl="/login">{app}</ClerkProvider> : app}
      </body>
    </html>
  );
}
