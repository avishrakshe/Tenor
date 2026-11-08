'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from './Session';

/** Without contracts only the landing page has anything to show. */
export function RequireDeployment({ children }: { children: React.ReactNode }) {
  const { config } = useSession();
  const pathname = usePathname();
  if (config.deployed || pathname === '/') return children;
  return (
    <section className="panel max-w-xl">
      <h1 className="font-semibold">Not live on {config.network} yet</h1>
      <p className="mt-2 text-sm text-mute">
        This page reads live contract data, and the contracts aren&apos;t deployed on {config.network} yet. Nothing here
        is simulated, so it stays empty until they are.
      </p>
      <Link href="/" className="btn btn-ghost mt-4">
        Back to overview
      </Link>
    </section>
  );
}
