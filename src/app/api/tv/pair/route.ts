/**
 * /api/tv/pair
 *
 * POST   — PUBLIC; TV browser submits 6-digit code, receives tv_session cookie.
 *           Rate-limited. No X-Auth-Role required.
 *
 * PATCH  — Admin only; generates a fresh 6-digit pairing code for a session.
 *           Requires X-Auth-Role header (main_admin or store_admin).
 *           Store Admin may only generate codes for sessions in their own store.
 */

import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { setTVCookie } from '@/lib/tv-cookie';
import { resolveStrictAuth, authError } from '@/lib/admin-role';
import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateSixDigitCode(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return (buf[0] % 1_000_000).toString().padStart(6, '0');
}

function hashIp(ip: string): string {
  return createHash('sha256').update(ip + process.env.NEXT_PUBLIC_SUPABASE_URL).digest('hex').slice(0, 32);
}

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  );
}

// ---------------------------------------------------------------------------
// POST /api/tv/pair — PUBLIC; TV exchanges 6-digit code for a tv_session cookie
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  const admin = createSupabaseAdminClient();

  // Rate limiting: max 5 attempts per IP per 5-minute window
  const ipKey       = hashIp(getClientIp(req));
  const windowStart = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  const { count: recentAttempts, error: countErr } = await admin
    .from('pairing_attempts')
    .select('*', { count: 'exact', head: true })
    .eq('ip_key', ipKey)
    .gte('attempted_at', windowStart);

  if (countErr) {
    console.error('[POST /api/tv/pair] rate-limit error', countErr);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
  if ((recentAttempts ?? 0) >= 5) {
    return NextResponse.json({ error: 'Too many attempts. Please wait a few minutes.' }, { status: 429 });
  }
  await admin.from('pairing_attempts').insert({ ip_key: ipKey });

  // Parse code
  let code: string;
  try {
    const body = await req.json() as { code?: unknown };
    if (typeof body.code !== 'string' || !/^\d{6}$/.test(body.code)) {
      return NextResponse.json({ error: 'Invalid code format' }, { status: 400 });
    }
    code = body.code;
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  // Look up pairing code
  const { data: pairingRow, error: lookupErr } = await admin
    .from('pairing_codes')
    .select('id, token, expires_at, used_at')
    .eq('code', code)
    .maybeSingle();

  if (lookupErr) {
    console.error('[POST /api/tv/pair] lookup error', lookupErr);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
  if (!pairingRow)                           return NextResponse.json({ error: 'Invalid code' },        { status: 404 });
  if (pairingRow.used_at !== null)           return NextResponse.json({ error: 'Code already used' },   { status: 410 });
  if (new Date(pairingRow.expires_at) <= new Date()) return NextResponse.json({ error: 'Code expired' }, { status: 410 });

  // Mark code as used
  const { error: markErr } = await admin
    .from('pairing_codes')
    .update({ used_at: new Date().toISOString() })
    .eq('id', pairingRow.id);
  if (markErr) {
    console.error('[POST /api/tv/pair] mark-used error', markErr);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }

  // Fetch the associated session
  const { data: session, error: sessErr } = await admin
    .from('tv_sessions')
    .select('token, channel_name, expires_at, is_active, display_state')
    .eq('token', pairingRow.token)
    .maybeSingle();

  if (sessErr || !session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  if (!session.is_active || new Date(session.expires_at) <= new Date()) {
    return NextResponse.json({ error: 'Session expired or revoked' }, { status: 410 });
  }

  // Set HttpOnly tv_session cookie — token never exposed to JS
  const res = NextResponse.json({
    channel_name:  session.channel_name,
    display_state: (session as { display_state?: boolean }).display_state ?? false,
  });
  setTVCookie(res, session.token);
  return res;
}

// ---------------------------------------------------------------------------
// PATCH /api/tv/pair — Admin only; generate a fresh pairing code for a session.
// Requires X-Auth-Role header. No fallback between roles.
// ---------------------------------------------------------------------------
export async function PATCH(req: NextRequest) {
  let auth;
  try { auth = await resolveStrictAuth(req); }
  catch (e) {
    const err = authError(e);
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  try {
    const body = await req.json() as { token?: string };
    const { token } = body;
    if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 });

    const admin = createSupabaseAdminClient();

    // Verify session exists, is active
    const { data: session, error: sessErr } = await admin
      .from('tv_sessions')
      .select('token, expires_at, is_active, store_id')
      .eq('token', token)
      .maybeSingle();

    if (sessErr || !session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    if (!session.is_active || new Date(session.expires_at) <= new Date()) {
      return NextResponse.json({ error: 'Session expired or revoked' }, { status: 410 });
    }

    // Store Admin: session must belong to their store — storeId from verified cookie only
    if (auth.role === 'store_admin' && (session.store_id as string | null) !== auth.storeId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Invalidate any existing unused codes for this session
    await admin
      .from('pairing_codes')
      .update({ used_at: new Date().toISOString() })
      .eq('token', token)
      .is('used_at', null);

    // Generate fresh code (5 min expiry)
    const code      = generateSixDigitCode();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const { error: insertErr } = await admin.from('pairing_codes').insert({ code, token, expires_at: expiresAt });
    if (insertErr) throw insertErr;

    return NextResponse.json({ code, expires_at: expiresAt }, { status: 201 });
  } catch (err) {
    console.error('[PATCH /api/tv/pair]', err);
    return NextResponse.json({ error: 'Failed to generate code' }, { status: 500 });
  }
}
