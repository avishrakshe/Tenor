'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CartButton } from './Cart';
import { ArrowIcon, MarkIcon } from './motion';
import { useSession } from './Session';

const APP_LINKS = [
  ['/dashboard', 'Home'],
  ['/challenges', 'Buy Challenge'],
  ['/trade', 'Trade'],
  ['/analytics', 'Analytics'],
  ['/leaderboard', 'Leaderboard'],
  ['/transparency', 'Transparency'],
];

function Account() {
  const { accountId, signOut } = useSession();
  if (accountId) {
    return (
      <button className="btn btn-ghost num max-w-44 truncate" onClick={signOut} title="Sign out">
        {accountId}
      </button>
    );
  }
  return (
    <Link className="btn" href="/login">
      Log in
    </Link>
  );
}

export function Nav() {
  const pathname = usePathname();
  if (pathname === '/login') return null;

  if (pathname === '/') {
    return (
      <header className="sticky top-0 z-40 bg-black/40 backdrop-blur-xl">
        <nav className="flex h-[68px] items-center justify-between gap-4 px-4 md:px-10" aria-label="Main">
          <Link href="/" className="inline-flex items-center gap-2 font-semibold tracking-wide">
            <MarkIcon /> TENOR
          </Link>
          <div className="hidden items-center gap-8 text-sm text-mute md:flex">
            <Link href="/challenges" className="hover:text-text">Challenges</Link>
            <Link href="/trade" className="hover:text-text">Trade</Link>
            <Link href="/transparency" className="hover:text-text">Transparency</Link>
            <a href="https://github.com/avishrakshe/Tenor" className="hover:text-text">Code</a>
          </div>
          <Link href="/dashboard" className="pill">
            Open app
            <span className="pill-arrow"><ArrowIcon /></span>
          </Link>
        </nav>
      </header>
    );
  }

  return (
    <header className="relative z-40">
      <nav className="flex min-h-[64px] flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2 md:px-6" aria-label="Main">
        <Link href="/" aria-label="Tenor home"><MarkIcon size={26} /></Link>
        {APP_LINKS.map(([href, label]) => (
          <Link key={href} href={href} aria-current={pathname.startsWith(href) ? 'page' : undefined} className={`text-sm ${pathname.startsWith(href) ? 'font-semibold text-text' : 'text-mute hover:text-text'}`}>
            {label}
          </Link>
        ))}
        <div className="ml-auto flex items-center gap-3">
          <CartButton />
          <Account />
        </div>
      </nav>
    </header>
  );
}
