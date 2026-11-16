import { createSupabaseServerClient, createSupabaseAdminClient } from '@/lib/supabase/server';
import { TV_COOKIE, setTVCookie, clearTVCookie } from '@/lib/tv-cookie';
import { STORE_COOKIE, parseStoreCookie } from '@/lib/store-auth';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

/** Returns the Supabase Auth user, or null if not authenticated. */
async function getMainAdmin() {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return null;
    return user;
  } catch {
    return null;
  }
}

/**
 * Returns the verified storeId from the store-admin cookie, or null.
 * Also checks is_active and session_version.
 */
async function getStoreAdminId(req: NextRequest): Promise<string | null> {
  const cookieVal = req.cookies.get(STORE_COOKIE)?.value;
  const parsed    = parseStoreCookie(cookieVal);
  if (!parsed) return null;

  const admin = createSupabaseAdminClient();
  const { data: store } = await admin
    .from('stores')
    .select('id, session_version, is_active')
    .eq('id', parsed.storeId)
    .maybeSingle();

  if (!store) return null;
  if ((store.session_version as number) !== parsed.sessionVersion) return null;
  if (!(store.is_active as boolean)) return null;
  return store.id as string;
}

// ---------------------------------------------------------------------------
// POST /api/tv/session
// Main Admin: body may contain any store_id.
// Store Admin: store_id is taken from their cookie — they cannot set another store.
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    const mainAdmin  = await getMainAdmin();
    const storeAdminId = mainAdmin ? null : await getStoreAdminId(req);

    if (!mainAdmin && !storeAdminId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({})) as { store_id?: string };
    const admin = createSupabaseAdminClient();

    // Determine store_id:
    // - Main Admin: use the supplied store_id (optional, can be null)
    // - Store Admin: always their own store_id — ignore any supplied value
    let store_id: string | null = null;
    if (mainAdmin) {
      store_id = body.store_id ?? null;
      if (store_id) {
        const { data: store } = await admin
          .from('stores').select('id').eq('id', store_id).maybeSingle();
        if (!store) return NextResponse.json({ error: 'Store not found' }, { status: 404 });
      }
    } else {
      store_id = storeAdminId!;
    }

    const token       = crypto.randomUUID();
    const channelName = `tv-display-${token}`;

    const { data, error } = await admin
      .from('tv_sessions')
      .insert({
        token,
        channel_name: channelName,
        expires_at:   new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        is_active:    true,
        display_state: false,
        store_id,
      })
      .select('token, channel_name, expires_at, display_state, store_id')
      .single();

    if (error) throw error;
    return NextResponse.json(data, { status: 201 });
  } catch (err: unknown) {
    console.error('[POST /api/tv/session]', err);
    return NextResponse.json({ error: 'Failed to create session' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// GET /api/tv/session — public; validates a token (TV browser or admin modal)
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  try {
    const qToken = req.nextUrl.searchParams.get('token');
    const cookie = req.cookies.get(TV_COOKIE)?.value;
    const token  = qToken ?? cookie ?? null;

    if (!token) {
      return NextResponse.json({ valid: false, reason: 'not_found' });
    }

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
    if (!data.is_active) {
      const res = NextResponse.json({ valid: false, reason: 'revoked' });
      if (cookie) clearTVCookie(res);
      return res;
    }
    if (new Date(data.expires_at) <= new Date()) {
      const res = NextResponse.json({ valid: false, reason: 'expired' });
      if (cookie) clearTVCookie(res);
      return res;
    }

    const body = NextResponse.json({
      valid:         true,
      channel_name:  data.channel_name,
      expires_at:    data.expires_at,
      display_state: data.display_state,
      store_id:      (data as { store_id?: string | null }).store_id ?? null,
    });
    if (cookie) setTVCookie(body, token);
    return body;
  } catch (err: unknown) {
    console.error('[GET /api/tv/session]', err);
    return NextResponse.json({ error: 'Failed to validate session' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/tv/session — update display_state (Start/Stop)
// Store Admin: may only update sessions belonging to their own store.
// ---------------------------------------------------------------------------
export async function PATCH(req: NextRequest) {
  try {
    const mainAdmin    = await getMainAdmin();
    const storeAdminId = mainAdmin ? null : await getStoreAdminId(req);

    if (!mainAdmin && !storeAdminId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json() as { token?: string; display_state?: boolean };
    if (!body.token || typeof body.display_state !== 'boolean') {
      return NextResponse.json({ error: 'Missing token or display_state' }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();

    // Store Admin: verify the session belongs to their store before updating
    if (storeAdminId) {
      const { data: sess } = await admin
        .from('tv_sessions')
        .select('store_id')
        .eq('token', body.token)
        .maybeSingle();
      if (!sess || (sess.store_id as string | null) !== storeAdminId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    const { error } = await admin
      .from('tv_sessions')
      .update({ display_state: body.display_state })
      .eq('token', body.token)
      .eq('is_active', true);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    console.error('[PATCH /api/tv/session]', err);
    return NextResponse.json({ error: 'Failed to update display state' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/tv/session — revoke a session
// Store Admin: may only revoke sessions belonging to their own store.
// ---------------------------------------------------------------------------
export async function DELETE(req: NextRequest) {
  try {
    const mainAdmin    = await getMainAdmin();
    const storeAdminId = mainAdmin ? null : await getStoreAdminId(req);

    if (!mainAdmin && !storeAdminId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json() as { token?: string };
    const { token } = body;
    if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 });

    const admin = createSupabaseAdminClient();

    // Store Admin: ownership check
    if (storeAdminId) {
      const { data: sess } = await admin
        .from('tv_sessions')
        .select('store_id')
        .eq('token', token)
        .maybeSingle();
      if (!sess || (sess.store_id as string | null) !== storeAdminId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    const { error } = await admin
      .from('tv_sessions')
      .update({ is_active: false, display_state: false })
      .eq('token', token);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    console.error('[DELETE /api/tv/session]', err);
    return NextResponse.json({ error: 'Failed to revoke session' }, { status: 500 });
  }
}

// (cookie helpers live in @/lib/tv-cookie)
