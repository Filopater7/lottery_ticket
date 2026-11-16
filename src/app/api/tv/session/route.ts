import { createSupabaseServerClient, createSupabaseAdminClient } from '@/lib/supabase/server';
import { TV_COOKIE, setTVCookie, clearTVCookie } from '@/lib/tv-cookie';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

async function requireAuth() {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error('Unauthorized');
  return user;
}

// ---------------------------------------------------------------------------
// POST /api/tv/session — admin auth required; creates a new pairing session
// ---------------------------------------------------------------------------
export async function POST() {
  try {
    await requireAuth();

    const token = crypto.randomUUID();
    const channelName = `tv-display-${token}`;
    const admin = createSupabaseAdminClient();

    const { data, error } = await admin
      .from('tv_sessions')
      .insert({
        token,
        channel_name: channelName,
        // 1-year expiry — only explicit revocation should end the session
        expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        is_active: true,
        display_state: false,
      })
      .select('token, channel_name, expires_at, display_state')
      .single();

    if (error) throw error;

    return NextResponse.json(data, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('[POST /api/tv/session]', err);
    return NextResponse.json({ error: 'Failed to create session' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// GET /api/tv/session — validates a session token.
//
// Two sources for the token (checked in order):
//   1. ?token= query param  (admin modal checking its localStorage token)
//   2. tv_session HttpOnly cookie  (TV browser — set by this route on pair success)
//
// Returns: { valid, channel_name, expires_at, display_state }
// Also sets / refreshes the HttpOnly cookie when request comes from the TV
// (i.e., no ?token= param, cookie present).
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  try {
    const qToken   = req.nextUrl.searchParams.get('token');
    const cookie   = req.cookies.get(TV_COOKIE)?.value;
    const token    = qToken ?? cookie ?? null;

    if (!token) {
      return NextResponse.json({ valid: false, reason: 'not_found' });
    }

    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from('tv_sessions')
      .select('token, channel_name, expires_at, is_active, display_state')
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
      valid: true,
      channel_name: data.channel_name,
      expires_at:   data.expires_at,
      display_state: data.display_state,
    });

    // Refresh the cookie on every TV check-in so it stays alive
    if (cookie) setTVCookie(body, token);

    return body;
  } catch (err: unknown) {
    console.error('[GET /api/tv/session]', err);
    return NextResponse.json({ error: 'Failed to validate session' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/tv/session — admin auth required; updates display_state.
// Called by ConnectTVModal before broadcasting start/stop so the TV can
// recover the correct state after a refresh or internet interruption.
// Body: { token: string, display_state: boolean }
// ---------------------------------------------------------------------------
export async function PATCH(req: NextRequest) {
  try {
    await requireAuth();

    const body = await req.json() as { token?: string; display_state?: boolean };
    if (!body.token || typeof body.display_state !== 'boolean') {
      return NextResponse.json({ error: 'Missing token or display_state' }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from('tv_sessions')
      .update({ display_state: body.display_state })
      .eq('token', body.token)
      .eq('is_active', true);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('[PATCH /api/tv/session]', err);
    return NextResponse.json({ error: 'Failed to update display state' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/tv/session — admin auth required; revokes a session
// ---------------------------------------------------------------------------
export async function DELETE(req: NextRequest) {
  try {
    await requireAuth();

    const body = await req.json() as { token?: string };
    const { token } = body;
    if (!token) {
      return NextResponse.json({ error: 'Missing token' }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from('tv_sessions')
      .update({ is_active: false, display_state: false })
      .eq('token', token);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('[DELETE /api/tv/session]', err);
    return NextResponse.json({ error: 'Failed to revoke session' }, { status: 500 });
  }
}

// (cookie helpers live in @/lib/tv-cookie)
