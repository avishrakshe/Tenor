'use client';

import Link from 'next/link';
import { useSession } from './Session';

export function Nav() {
  const { accountId, signIn, signOut, config } = useSession();
  return (
    <header className="border-b border-line">
      <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3" aria-label="Main">
        <Link href="/" className="font-semibold tracking-tight">
          Tenor
        </Link>
        <Link href="/challenges" className="text-sm text-mute hover:text-text">
          Challenges
        </Link>
        <Link href="/transparency" className="text-sm text-mute hover:text-text">
          Transparency
        </Link>
        <span className="label ml-auto">
          {config.network}
          {config.stackName === 'demo' ? ' · scripted prices' : ''}
        </span>
        {accountId ? (
          <button className="btn btn-ghost num max-w-56 truncate" onClick={signOut} title="Sign out">
            {accountId}
          </button>
        ) : (
          <button className="btn" onClick={signIn}>
            {config.network === 'sandbox' ? 'Create sandbox account' : 'Connect wallet'}
          </button>
        )}
      </nav>
    </header>
  );
}
