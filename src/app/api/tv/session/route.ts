/**
 * /api/tv/session
 *
 * AUTH MODEL
 * ──────────
 * Admin-facing endpoints (POST, PATCH, DELETE) require the X-Auth-Role header:
 *   'main_admin'  → verified via Supabase Auth cookies only
 *   'store_admin' → verified via store_admin_session cookie only
 * No fallback between roles. Missing/invalid credential → 401.
 *
 * The GET endpoint is public (TV browser uses it with its tv_session cookie).
 * It does NOT require X-Auth-Role and must never check admin credentials.
 *
 * TV browser authentication is completely separate from admin authentication.
 */

import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { TV_COOKIE, setTVCookie, clearTVCookie } from '@/lib/tv-cookie';
import { resolveStrictAuth, authError } from '@/lib/admin-role';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Ownership check for Store Admin
// Store Admin can only act on sessions that belong to their own store.
// storeId comes from the verified cookie — never from client input.
// ---------------------------------------------------------------------------
async function assertStoreOwnsSession(sessionToken: string, storeId: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { data: sess } = await admin
    .from('tv_sessions')
    .select('store_id')
    .eq('token', sessionToken)
    .maybeSingle();
  if (!sess || (sess.store_id as string | null) !== storeId) {
    throw { status: 403, message: 'Forbidden: session does not belong to this store' };
  }
}

// ---------------------------------------------------------------------------
// POST /api/tv/session — create a new TV pairing session
// Requires X-Auth-Role header.
// Main Admin: may supply any store_id in the body (or none for unassigned).
// Store Admin: store_id is taken from their verified cookie — body.store_id ignored.
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  let auth;
  try { auth = await resolveStrictAuth(req); }
  catch (e) {
    const err = authError(e);
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  try {
    const body  = await req.json().catch(() => ({})) as { store_id?: string };
    const admin = createSupabaseAdminClient();
    let store_id: string | null = null;

    if (auth.role === 'main_admin') {
      store_id = body.store_id ?? null;
      if (store_id) {
        const { data: store } = await admin.from('stores').select('id').eq('id', store_id).maybeSingle();
        if (!store) return NextResponse.json({ error: 'Store not found' }, { status: 404 });
      }
    } else {
      // Store Admin: always their own store; body.store_id is ignored entirely
      store_id = auth.storeId;
    }

    const token       = crypto.randomUUID();
    const channelName = `tv-display-${token}`;

    const { data, error } = await admin
      .from('tv_sessions')
      .insert({
        token, channel_name: channelName,
        expires_at:    new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        is_active:     true,
        display_state: false,
        store_id,
      })
      .select('token, channel_name, expires_at, display_state, store_id')
      .single();

    if (error) throw error;
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    console.error('[POST /api/tv/session]', err);
    return NextResponse.json({ error: 'Failed to create session' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// GET /api/tv/session — public; validates a session token for the TV browser.
//
// This endpoint does NOT use X-Auth-Role. It is used exclusively by the TV
// browser to validate its own tv_session HttpOnly cookie, or by admin modals
// to validate a token by value via ?token=.
//
// TV browser authentication is completely separate from admin authentication.
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  try {
    const qToken = req.nextUrl.searchParams.get('token');
    const cookie = req.cookies.get(TV_COOKIE)?.value;
    const token  = qToken ?? cookie ?? null;

    if (!token) return NextResponse.json({ valid: false, reason: 'not_found' });

    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from('tv_sessions')
      .select('token, channel_name, expires_at, is_active, display_state, store_id')
      .eq('token', token)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      const res = NextResponse.json({ valid: false, reason: 'not_found' });
      if (cookie) clearTVCookie(res);
      return res;
    }
    if (!(data.is_active as boolean)) {
      const res = NextResponse.json({ valid: false, reason: 'revoked' });
      if (cookie) clearTVCookie(res);
      return res;
    }
    if (new Date(data.expires_at as string) <= new Date()) {
      const res = NextResponse.json({ valid: false, reason: 'expired' });
      if (cookie) clearTVCookie(res);
      return res;
    }

    const body = NextResponse.json({
      valid:         true,
      channel_name:  data.channel_name,
      expires_at:    data.expires_at,
      display_state: data.display_state,
      store_id:      (data.store_id as string | null) ?? null,
    });
    if (cookie) setTVCookie(body, token);
    return body;
  } catch (err) {
    console.error('[GET /api/tv/session]', err);
    return NextResponse.json({ error: 'Failed to validate session' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/tv/session — persist display_state (Start/Stop command)
// Requires X-Auth-Role header.
// Store Admin: verified ownership check before update.
// ---------------------------------------------------------------------------
export async function PATCH(req: NextRequest) {
  let auth;
  try { auth = await resolveStrictAuth(req); }
  catch (e) {
    const err = authError(e);
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  try {
    const body = await req.json() as { token?: string; display_state?: boolean };
    if (!body.token || typeof body.display_state !== 'boolean') {
      return NextResponse.json({ error: 'Missing token or display_state' }, { status: 400 });
    }

    if (auth.role === 'store_admin') {
      try { await assertStoreOwnsSession(body.token, auth.storeId); }
      catch (e) {
        const err = authError(e);
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
    }

    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from('tv_sessions')
      .update({ display_state: body.display_state })
      .eq('token', body.token)
      .eq('is_active', true);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[PATCH /api/tv/session]', err);
    return NextResponse.json({ error: 'Failed to update display state' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/tv/session — revoke (unpair) a session
// Requires X-Auth-Role header.
// Store Admin: verified ownership check before deletion.
// ---------------------------------------------------------------------------
export async function DELETE(req: NextRequest) {
  let auth;
  try { auth = await resolveStrictAuth(req); }
  catch (e) {
    const err = authError(e);
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  try {
    const body = await req.json() as { token?: string };
    if (!body.token) return NextResponse.json({ error: 'Missing token' }, { status: 400 });

    if (auth.role === 'store_admin') {
      try { await assertStoreOwnsSession(body.token, auth.storeId); }
      catch (e) {
        const err = authError(e);
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
    }

    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from('tv_sessions')
      .update({ is_active: false, display_state: false })
      .eq('token', body.token);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[DELETE /api/tv/session]', err);
    return NextResponse.json({ error: 'Failed to revoke session' }, { status: 500 });
  }
}
