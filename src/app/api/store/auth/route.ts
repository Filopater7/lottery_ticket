/**
 * /api/store/auth
 *
 * POST  — verify access key → set HttpOnly store-admin session cookie
 * DELETE — clear the cookie (logout)
 */

import { createSupabaseAdminClient } from '@/lib/supabase/server';
import {
  verifyAccessKey,
  setStoreCookie,
  clearStoreCookie,
} from '@/lib/store-auth';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// POST /api/store/auth
// Body: { store_id: string, access_key: string }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { store_id?: string; access_key?: string };
    const { store_id, access_key } = body;

    if (!store_id || !access_key) {
      return NextResponse.json({ error: 'Missing credentials' }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();
    const { data: store, error } = await admin
      .from('stores')
      .select('id, access_key_hash, key_salt, session_version')
      .eq('id', store_id)
      .maybeSingle();

    if (error) throw error;

    // Use the same error message regardless of whether store exists or key is wrong
    // to avoid store enumeration
    const valid = store
      ? await verifyAccessKey(access_key, store.access_key_hash as string, store.key_salt as string)
      : false;

    if (!valid) {
      return NextResponse.json({ error: 'Invalid store ID or access key' }, { status: 401 });
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
