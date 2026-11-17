/**
 * GET /api/tv/session/mine
 *
 * Returns the most recent active TV session owned by the authenticated caller.
 * Requires X-Auth-Role header — no fallback between roles.
 *
 * main_admin  → returns the most recent active session (optionally filtered by
 *               ?store_id= query param)
 * store_admin → returns the most recent active session for their own store only;
 *               store_id is derived from the verified cookie, never from the client
 *
 * Returns:
 *   { session: { token, channel_name, expires_at, display_state, store_id } }
 *   or { session: null } if no active session exists for this owner.
 */

import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { resolveStrictAuth, authError } from '@/lib/admin-role';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  let auth;
  try { auth = await resolveStrictAuth(req); }
  catch (e) {
    const err = authError(e);
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const admin = createSupabaseAdminClient();

  let query = admin
    .from('tv_sessions')
    .select('token, channel_name, expires_at, display_state, store_id')
    .eq('is_active', true)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1);

  if (auth.role === 'store_admin') {
    // Store Admin: scope is always their own store; query param is ignored
    query = query.eq('store_id', auth.storeId);
  } else {
    // Main Admin: filter to a specific store if supplied, otherwise restrict
    // to unassigned sessions (store_id IS NULL) so Store Admin sessions are
    // never returned when Main Admin opens the modal without selecting a store.
    const storeId = req.nextUrl.searchParams.get('store_id');
    if (storeId) {
      query = query.eq('store_id', storeId);   // scoped to the selected store
    } else {
      query = query.is('store_id', null);       // unassigned sessions only
    }
  }

  const { data, error } = await query.maybeSingle();
  if (error) {
    console.error('[GET /api/tv/session/mine]', error);
    return NextResponse.json({ error: 'Failed to fetch session' }, { status: 500 });
  }

  return NextResponse.json({ session: data ?? null });
}
