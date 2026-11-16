/**
 * /api/store/auth
 *
 * POST   — verify username + password → set HttpOnly store-admin session cookie
 * DELETE — clear the cookie (logout)
 */

import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { verifyPassword, setStoreCookie, clearStoreCookie } from '@/lib/store-auth';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// POST /api/store/auth
// Body: { username: string, password: string }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { username?: string; password?: string };
    const username = body.username?.trim().toLowerCase();
    const password = body.password;

    if (!username || !password) {
      return NextResponse.json({ error: 'Username and password are required' }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();
    const { data: store, error } = await admin
      .from('stores')
      .select('id, password_hash, password_salt, session_version, is_active')
      .eq('username', username)
      .maybeSingle();

    if (error) throw error;

    // Same error message whether store doesn't exist or password is wrong
    // — avoids username enumeration
    const valid = store
      ? await verifyPassword(password, store.password_hash as string, store.password_salt as string)
      : false;

    if (!valid) {
      return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 });
    }

    if (!(store!.is_active as boolean)) {
      return NextResponse.json({ error: 'This account has been deactivated. Contact the administrator.' }, { status: 403 });
    }

    const res = NextResponse.json({ success: true });
    setStoreCookie(res, store!.id as string, store!.session_version as number);
    return res;
  } catch (err) {
    console.error('[POST /api/store/auth]', err);
    return NextResponse.json({ error: 'Authentication failed' }, { status: 500 });
  }
}

// DELETE /api/store/auth — logout
export async function DELETE() {
  const res = NextResponse.json({ success: true });
  clearStoreCookie(res);
  return res;
}
