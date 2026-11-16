/**
 * GET /store-admin/logout
 * Clears the store-admin session cookie and redirects to login.
 */

import { NextRequest, NextResponse } from 'next/server';
import { STORE_COOKIE } from '@/lib/store-auth';

export const dynamic = 'force-dynamic';

export function GET(req: NextRequest) {
  const res = NextResponse.redirect(new URL('/store-admin/login', req.url));
  res.cookies.set(STORE_COOKIE, '', {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path:     '/',
    maxAge:   0,
  });
  return res;
}
