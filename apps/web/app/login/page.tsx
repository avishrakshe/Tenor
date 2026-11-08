'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { MarkIcon } from '@/components/motion';
import { useSession } from '@/components/Session';

export default function Login() {
  const { accountId, signIn, config } = useSession();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (accountId) router.replace('/dashboard');
  }, [accountId, router]);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      await signIn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-svh flex-col items-center justify-center overflow-hidden px-4 text-center">
      <div className="aurora !top-[-5%] !h-[70%]" aria-hidden="true" />
      <div className="dots" aria-hidden="true" />
      <div className="relative w-full max-w-sm">
        <Link href="/" className="inline-flex items-center gap-2 text-lg font-semibold tracking-[0.16em]">
          <MarkIcon size={28} /> TENOR
        </Link>
        <h1 className="chrome-text mt-8 text-6xl font-medium tracking-tight">Log in</h1>
        <p className="mt-4 text-mute">Your NEAR account is your Tenor account.</p>
        <button className="btn mt-10 w-full" onClick={go} disabled={busy || !config.deployed}>
          {config.network === 'sandbox' ? 'Create sandbox account' : 'Connect NEAR wallet'}
        </button>
        {!config.deployed && <p className="mt-4 text-sm text-warn">Login opens once the contracts are deployed on {config.network}.</p>}
        {error && <p role="alert" className="mt-4 text-sm text-down">{error}</p>}
        <p className="mt-6 text-xs text-mute">Evaluation trades use a limited key in your browser, so most orders need no popup.</p>
      </div>
    </div>
  );
}
