import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse, type NextRequest } from 'next/server';

// The landing page and the public proof pages stay open. Everything a trader works in needs Google.
// This only decides which screen to show: account data is read from the public chain, and writes need the wallet.
const APP_PAGE = /^\/(dashboard|challenges|trade|analytics|funded)(\/|$)/;

// A local sandbox has its own throwaway accounts, so it runs with no Clerk keys at all.
function sandboxOnly(req: NextRequest) {
  return req.nextUrl.pathname === '/login' ? NextResponse.redirect(new URL('/dashboard', req.url)) : NextResponse.next();
}

export default process.env.NEXT_PUBLIC_NETWORK === 'sandbox'
  ? sandboxOnly
  : clerkMiddleware(async (auth, req) => {
      const { userId } = await auth();
      const { pathname } = req.nextUrl;
      if (!userId && APP_PAGE.test(pathname)) return NextResponse.redirect(new URL('/login', req.url));
      if (userId && pathname === '/login') return NextResponse.redirect(new URL('/dashboard', req.url));
    });

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
