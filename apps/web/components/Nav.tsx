'use client';

import { useClerk, useUser } from '@clerk/nextjs';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { loginEnabled } from '@/lib/login-mode';
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
  ['/proof', 'Money proof'],
  ['/safety', 'Safety'],
];

function StackSwitch() {
  const { config } = useSession();
  const demo = config.stackName === 'demo';
  function flip() {
    document.cookie = `tenor.stack=${demo ? 'live' : 'demo'}; path=/; max-age=2592000; samesite=lax`;
    window.location.reload();
  }
  return (
    <button className="btn btn-ghost !min-h-9" aria-pressed={demo} title="The demo stack uses the same contracts with prices anyone can set" onClick={flip}>
      {demo ? 'Demo mode: on' : 'Demo mode: off'}
    </button>
  );
}

function Account() {
  const { isLoaded, user } = useUser();
  const clerk = useClerk();
  const { accountId, disconnect } = useSession();

  async function signOut() {
    try {
      // A wallet left connected would carry over to the next person to log in on this browser.
      if (accountId) await disconnect();
    } finally {
      await clerk.signOut({ redirectUrl: '/' });
    }
  }

  if (!isLoaded) return null;
  if (user) {
    const email = user.primaryEmailAddress?.emailAddress;
    return (
      <button className="btn btn-ghost max-w-56 gap-2" onClick={signOut} title={`Sign out of ${email ?? 'your account'}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={user.imageUrl} alt="" width={20} height={20} className="rounded-full" />
        <span className="truncate">{user.firstName ?? email}</span>
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
  if (pathname.startsWith('/login')) return null;

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
          <StackSwitch />
          <CartButton />
          {loginEnabled && <Account />}
        </div>
      </nav>
    </header>
  );
}
