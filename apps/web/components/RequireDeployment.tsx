'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from './Session';

// These read one trader's onchain accounts, so there is nothing to show without contracts.
const NEEDS_CONTRACTS = ['/dashboard', '/analytics', '/leaderboard', '/trade/', '/funded/'];

export function RequireDeployment({ children }: { children: React.ReactNode }) {
  const { config } = useSession();
  const pathname = usePathname();
  if (config.deployed || !NEEDS_CONTRACTS.some((p) => pathname.startsWith(p))) return children;
  return (
    <section className="panel mx-auto mt-16 max-w-xl">
      <h1 className="font-semibold">Not live on {config.network} yet</h1>
      <p className="mt-2 text-sm text-mute">
        This page reads live contract data, and the contracts aren&apos;t deployed on {config.network} yet. Nothing here
        is simulated, so it stays empty until they are.
      </p>
      <Link href="/challenges" className="btn btn-ghost mt-4">
        See the challenges
      </Link>
    </section>
  );
}
