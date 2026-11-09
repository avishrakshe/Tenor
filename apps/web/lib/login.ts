'use client';

import { useAuth, useUser } from '@clerk/nextjs';
import { loginEnabled } from './login-mode';

// `loginEnabled` is fixed at build time, so each build always calls the same hooks. With login off
// there is no Clerk provider, and anyone is treated as logged in.
export const useSignedIn = loginEnabled ? () => Boolean(useAuth().isSignedIn) : () => true;
export const useLoginUser = loginEnabled ? () => useUser().user ?? null : () => null;
