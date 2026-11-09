import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse, type NextRequest } from 'next/server';
import { loginEnabled } from '@/lib/login-mode';

// The landing page and the public proof pages stay open. Everything a trader works in needs Google.
// This only decides which screen to show: account data is read from the public chain, and writes need the wallet.
const APP_PAGE = /^\/(dashboard|challenges|trade|analytics|funded)(\/|$)/;

function withoutLogin(req: NextRequest) {
  return req.nextUrl.pathname.startsWith('/login') ? NextResponse.redirect(new URL('/dashboard', req.url)) : NextResponse.next();
}

export default loginEnabled
  ? clerkMiddleware(async (auth, req) => {
      const { userId } = await auth();
      const { pathname } = req.nextUrl;
      if (!userId && APP_PAGE.test(pathname)) return NextResponse.redirect(new URL('/login', req.url));
      if (userId && pathname === '/login') return NextResponse.redirect(new URL('/dashboard', req.url));
    })
  : withoutLogin;

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
