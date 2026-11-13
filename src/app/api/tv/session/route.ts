import { createSupabaseServerClient, createSupabaseAdminClient } from '@/lib/supabase/server';
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
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        is_active: true,
      })
      .select('token, channel_name, expires_at')
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
// GET /api/tv/session?token= — public; validates a stored session token
// (used by TVReceiver on load to check if its localStorage token is still valid)
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get('token');
    if (!token) {
      return NextResponse.json({ valid: false, reason: 'not_found' });
    }

    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from('tv_sessions')
      .select('token, channel_name, expires_at, is_active')
      .eq('token', token)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return NextResponse.json({ valid: false, reason: 'not_found' });
    }

    if (!data.is_active) {
      return NextResponse.json({ valid: false, reason: 'revoked' });
    }

    if (new Date(data.expires_at) <= new Date()) {
      return NextResponse.json({ valid: false, reason: 'expired' });
    }

    return NextResponse.json({
      valid: true,
      channel_name: data.channel_name,
      expires_at: data.expires_at,
    });
  } catch (err: unknown) {
    console.error('[GET /api/tv/session]', err);
    return NextResponse.json({ error: 'Failed to validate session' }, { status: 500 });
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
      .update({ is_active: false })
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
