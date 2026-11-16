/**
 * GET /store-admin/logout
 *
 * Clears the store-admin session cookie and redirects to login.
 * Used when the dashboard detects an invalid/expired session so it can clear
 * the cookie before redirecting — breaking the middleware redirect loop.
 */

import { NextRequest, NextResponse } from 'next/server';
import { STORE_COOKIE } from '@/lib/store-auth';

export const dynamic = 'force-dynamic';

export function GET(req: NextRequest) {
  const loginUrl = new URL('/store-admin/login', req.url);
  const res = NextResponse.redirect(loginUrl);

  // Clear the stale store-admin cookie
  res.cookies.set(STORE_COOKIE, '', {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path:     '/store-admin',
    maxAge:   0,
  });

  return res;
}
