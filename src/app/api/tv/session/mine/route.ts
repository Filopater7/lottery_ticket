/**
 * GET /api/tv/session/mine
 *
 * Returns the most recent active TV session owned by the authenticated caller.
 *
 * Main Admin  → may supply ?store_id= to look up a specific store's session,
 *               or no param to get the most recent active session overall.
 * Store Admin → always returns their own store's session (store_id from cookie,
 *               never from query param).
 *
 * Returns:
 *   { session: { token, channel_name, expires_at, display_state, store_id } }
 *   or { session: null } if no active session exists for this owner.
 *
 * This endpoint replaces the localStorage token pattern in ConnectTVModal.
 * The admin modal calls this on open to discover its current session without
 * relying on any client-side storage.
 */

import { createSupabaseServerClient, createSupabaseAdminClient } from '@/lib/supabase/server';
import { STORE_COOKIE, parseStoreCookie } from '@/lib/store-auth';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const admin = createSupabaseAdminClient();

  // ── Resolve caller identity ──────────────────────────────────────────

  // 1. Try Supabase Auth (Main Admin)
  let isMainAdmin = false;
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (!error && user) isMainAdmin = true;
  } catch { /* fall through */ }

  let storeAdminId: string | null = null;
  if (!isMainAdmin) {
    // 2. Try store-admin cookie
    const cookieVal = req.cookies.get(STORE_COOKIE)?.value;
    const parsed    = parseStoreCookie(cookieVal);
    if (parsed) {
      const { data: store } = await admin
        .from('stores')
        .select('id, session_version, is_active')
        .eq('id', parsed.storeId)
        .maybeSingle();
      if (
        store &&
        (store.session_version as number) === parsed.sessionVersion &&
        (store.is_active as boolean)
      ) {
        storeAdminId = store.id as string;
      }
    }
  }

  if (!isMainAdmin && !storeAdminId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── Build query ──────────────────────────────────────────────────────

  let query = admin
    .from('tv_sessions')
    .select('token, channel_name, expires_at, display_state, store_id')
    .eq('is_active', true)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1);

  if (storeAdminId) {
    // Store Admin: always scoped to their store — ignore any query param
    query = query.eq('store_id', storeAdminId);
  } else {
    // Main Admin: optionally filter by store_id
    const storeId = req.nextUrl.searchParams.get('store_id');
    if (storeId) query = query.eq('store_id', storeId);
  }

  const { data, error } = await query.maybeSingle();
  if (error) {
    console.error('[GET /api/tv/session/mine]', error);
    return NextResponse.json({ error: 'Failed to fetch session' }, { status: 500 });
  }

  return NextResponse.json({ session: data ?? null });
}
