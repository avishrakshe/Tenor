'use client';

import { useAuth, useSignIn } from '@clerk/nextjs';
import Link from 'next/link';
import { useState } from 'react';
import { MarkIcon } from '@/components/motion';

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.2C12.4 13.7 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 7l7.2 5.6c4.2-3.9 7.1-9.6 7.1-17.1z" />
      <path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.2C.9 16.5 0 20.1 0 24s.9 7.5 2.6 10.8l7.9-6.2z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.2-5.6c-2.2 1.5-5 2.4-8.7 2.4-6.3 0-11.6-4.2-13.5-9.9l-7.9 6.2C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}

export default function Login() {
  const { isLoaded } = useAuth();
  const { signIn } = useSignIn();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function google() {
    setBusy(true);
    setError(null);
    const { error: failed } = await signIn.sso({
      strategy: 'oauth_google',
      redirectUrl: '/dashboard',
      redirectCallbackUrl: '/login/sso-callback',
    });
    if (failed) {
      setError(failed.message);
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
        <p className="mt-4 text-mute">Sign in with Google to open your dashboard.</p>
        <button className="btn mt-10 w-full gap-3" onClick={google} disabled={busy || !isLoaded}>
          <GoogleIcon /> {busy ? 'Opening Google…' : 'Continue with Google'}
        </button>
        {error && <p role="alert" className="mt-4 text-sm text-down">{error}</p>}
        <p className="mt-6 text-xs text-mute">You can connect your NEAR wallet from the dashboard when you are ready to trade.</p>
      </div>
    </div>
  );
}
