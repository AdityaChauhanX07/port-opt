export { auth as middleware } from '@/lib/auth';

export const config = {
  matcher: [
    /*
     * Match all routes except:
     * - /login (public auth page)
     * - /api/auth/* (NextAuth endpoints)
     * - /_next/* (Next.js internals)
     * - /favicon.ico, /robots.txt, etc.
     */
    '/((?!login|api/auth|_next/static|_next/image|favicon\\.ico).*)',
  ],
};
