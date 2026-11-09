'use client';

import { AuthenticateWithRedirectCallback } from '@clerk/nextjs';

// Google returns here. New users are signed up and returning users signed in, then both reach the dashboard.
export default function SsoCallback() {
  return (
    <div className="flex min-h-svh items-center justify-center text-sm text-mute">
      <p role="status">Signing you in…</p>
      <AuthenticateWithRedirectCallback signInForceRedirectUrl="/dashboard" signUpForceRedirectUrl="/dashboard" />
    </div>
  );
}
