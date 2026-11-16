import { NextResponse } from 'next/server';

export const TV_COOKIE     = 'tv_session';
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year in seconds

export function setTVCookie(res: NextResponse, token: string) {
  res.cookies.set(TV_COOKIE, token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path:     '/',
    maxAge:   COOKIE_MAX_AGE,
  });
}

export function clearTVCookie(res: NextResponse) {
  res.cookies.set(TV_COOKIE, '', {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path:     '/',
    maxAge:   0,
  });
}
