/**
 * /api/tv/session
 *
 * AUTH MODEL — explicit, no silent fallback:
 *
 *   Main Admin  → Supabase Auth session (sb-* cookies set by @supabase/ssr)
 *   Store Admin → store_admin_session HttpOnly cookie (store_id:session_version)
 *   TV browser  → tv_session HttpOnly cookie (read-only GET, public)
 *
 * Every mutating endpoint (POST, PATCH, DELETE) requires EITHER a valid
 * Supabase Auth session OR a valid store-admin session — never both accepted
 * silently with one falling back to the other.
 *
 * Store Admin requests are always ownership-checked: the session's store_id
 * must equal the authenticated store's id.
 */

import { createSupabaseServerClient, createSupabaseAdminClient } from '@/lib/supabase/server';
import { TV_COOKIE, setTVCookie, clearTVCookie } from '@/lib/tv-cookie';
import { STORE_COOKIE, parseStoreCookie } from '@/lib/store-auth';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Auth resolution — returns exactly ONE of the following or throws 401:
//   { kind: 'main_admin' }
//   { kind: 'store_admin', storeId: string }
// ---------------------------------------------------------------------------

type AuthResult =
  | { kind: 'main_admin' }
  | { kind: 'store_admin'; storeId: string };

async function resolveAuth(req: NextRequest): Promise<AuthResult> {
  // 1. Try Supabase Auth (Main Admin) — explicit check, no cookie mixing
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (!error && user) return { kind: 'main_admin' };
  } catch { /* fall through */ }

  // 2. Try store-admin cookie — only if Supabase Auth is absent
  const cookieVal = req.cookies.get(STORE_COOKIE)?.value;
  const parsed    = parseStoreCookie(cookieVal);
  if (parsed) {
    const admin = createSupabaseAdminClient();
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
      return { kind: 'store_admin', storeId: store.id as string };
    }
  }

  throw new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
}

// ---------------------------------------------------------------------------
// Ownership check for Store Admin
// ---------------------------------------------------------------------------

async function assertStoreOwnsSession(sessionToken: string, storeId: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { data: sess } = await admin
    .from('tv_sessions')
    .select('store_id')
    .eq('token', sessionToken)
    .maybeSingle();

  if (!sess || (sess.store_id as string | null) !== storeId) {
    throw new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
  }
}

// ---------------------------------------------------------------------------
// POST /api/tv/session — create a new TV pairing session
//
// Main Admin: may supply any store_id (or none for unassigned).
// Store Admin: store_id is ALWAYS taken from their verified cookie — the
//              body's store_id field is ignored to prevent escalation.
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  let auth: AuthResult;
  try {
    auth = await resolveAuth(req);
  } catch (e) {
    return e instanceof Response ? new NextResponse(e.body, { status: e.status }) : NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body      = await req.json().catch(() => ({})) as { store_id?: string };
    const admin     = createSupabaseAdminClient();
    let   store_id: string | null = null;

    if (auth.kind === 'main_admin') {
      // Main Admin may assign any store, or leave unassigned
      store_id = body.store_id ?? null;
      if (store_id) {
        const { data: store } = await admin.from('stores').select('id').eq('id', store_id).maybeSingle();
        if (!store) return NextResponse.json({ error: 'Store not found' }, { status: 404 });
      }
    } else {
      // Store Admin: always their own store — body.store_id is ignored
      store_id = auth.storeId;
    }

    const token       = crypto.randomUUID();
    const channelName = `tv-display-${token}`;

    const { data, error } = await admin
      .from('tv_sessions')
      .insert({ token, channel_name: channelName, expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), is_active: true, display_state: false, store_id })
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
// GET /api/tv/session — validate a session token (public endpoint for TV browser)
//
// Token sources (in order):
//   1. ?token= query param  (admin modal validating its stored token server-side)
//   2. tv_session HttpOnly cookie (TV browser automatic re-validation on load)
//
// This endpoint does NOT require admin auth — the token itself IS the credential.
// The tv_session cookie is HttpOnly so only the TV browser's own requests carry it.
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
//
// Store Admin: may only update sessions belonging to their own store.
// Main Admin: may update any session.
// ---------------------------------------------------------------------------
export async function PATCH(req: NextRequest) {
  let auth: AuthResult;
  try {
    auth = await resolveAuth(req);
  } catch (e) {
    return e instanceof Response ? new NextResponse(e.body, { status: e.status }) : NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json() as { token?: string; display_state?: boolean };
    if (!body.token || typeof body.display_state !== 'boolean') {
      return NextResponse.json({ error: 'Missing token or display_state' }, { status: 400 });
    }

    if (auth.kind === 'store_admin') {
      try { await assertStoreOwnsSession(body.token, auth.storeId); }
      catch (e) { return e instanceof Response ? new NextResponse(e.body, { status: e.status }) : NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }
    }

    const admin = createSupabaseAdminClient();
    const { error } = await admin.from('tv_sessions').update({ display_state: body.display_state }).eq('token', body.token).eq('is_active', true);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[PATCH /api/tv/session]', err);
    return NextResponse.json({ error: 'Failed to update display state' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/tv/session — revoke (unpair) a session
//
// Store Admin: may only revoke sessions belonging to their own store.
// Main Admin: may revoke any session.
// ---------------------------------------------------------------------------
export async function DELETE(req: NextRequest) {
  let auth: AuthResult;
  try {
    auth = await resolveAuth(req);
  } catch (e) {
    return e instanceof Response ? new NextResponse(e.body, { status: e.status }) : NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json() as { token?: string };
    if (!body.token) return NextResponse.json({ error: 'Missing token' }, { status: 400 });

    if (auth.kind === 'store_admin') {
      try { await assertStoreOwnsSession(body.token, auth.storeId); }
      catch (e) { return e instanceof Response ? new NextResponse(e.body, { status: e.status }) : NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }
    }

    const admin = createSupabaseAdminClient();
    const { error } = await admin.from('tv_sessions').update({ is_active: false, display_state: false }).eq('token', body.token);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[DELETE /api/tv/session]', err);
    return NextResponse.json({ error: 'Failed to revoke session' }, { status: 500 });
  }
}

// (cookie helpers live in @/lib/tv-cookie)
