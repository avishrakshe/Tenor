'use client';

import { useAuth, useUser } from '@clerk/nextjs';

// The network is fixed at build time, so each build always calls the same hooks. A local sandbox
// has no Clerk provider: anyone on it is treated as logged in.
const sandbox = process.env.NEXT_PUBLIC_NETWORK === 'sandbox';

export const useSignedIn = sandbox ? () => true : () => Boolean(useAuth().isSignedIn);
export const useLoginUser = sandbox ? () => null : () => useUser().user ?? null;
