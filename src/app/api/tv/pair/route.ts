/**
 * /api/tv/pair
 *
 * Two endpoints:
 *
 * POST /api/tv/pair/code  — admin-auth; generates a 6-digit pairing code for
 *                           the current active session.  Codes expire in 5 min
 *                           and are single-use.
 *
 * POST /api/tv/pair       — public; TV submits its 6-digit code and receives
 *                           back the channel_name + session token so it can
 *                           subscribe to Realtime and store the token locally.
 *                           Rate-limited to 5 attempts per IP per 5 minutes.
 */

import { createSupabaseServerClient, createSupabaseAdminClient } from '@/lib/supabase/server';
import { setTVCookie } from '@/lib/tv-cookie';
import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function requireAuth() {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error('Unauthorized');
  return user;
}

/** Generate a cryptographically random 6-digit code (000000–999999). */
function generateSixDigitCode(): string {
  // Use crypto.getRandomValues-equivalent in Node: generate a random 32-bit
  // integer and take modulo 1_000_000 to get uniform-ish distribution.
  // For 6 digits the bias is negligible (2^32 / 10^6 ≈ 4295, so the top
  // 4295 * 10^6 values wrap; bias < 0.0001%).
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  const n = buf[0] % 1_000_000;
  return n.toString().padStart(6, '0');
}

/** Hash an IP for storage — we never store raw IPs. */
function hashIp(ip: string): string {
  return createHash('sha256').update(ip + process.env.NEXT_PUBLIC_SUPABASE_URL).digest('hex').slice(0, 32);
}

/** Extract a best-effort client IP from request headers (Vercel passes x-forwarded-for). */
function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  );
}

// ---------------------------------------------------------------------------
// POST /api/tv/pair — PUBLIC; TV exchanges 6-digit code for session token
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  const admin = createSupabaseAdminClient();

  // --- Rate limiting: max 5 attempts per IP per 5-minute window ---
  const ip = getClientIp(req);
  const ipKey = hashIp(ip);
  const windowStart = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  const { count: recentAttempts, error: countErr } = await admin
    .from('pairing_attempts')
    .select('*', { count: 'exact', head: true })
    .eq('ip_key', ipKey)
    .gte('attempted_at', windowStart);

  if (countErr) {
    console.error('[POST /api/tv/pair] rate-limit check error', countErr);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }

  if ((recentAttempts ?? 0) >= 5) {
    return NextResponse.json(
      { error: 'Too many attempts. Please wait a few minutes and try again.' },
      { status: 429 }
    );
  }

  // Record this attempt before validating (count-then-record avoids races but
  // is acceptable here: worst case an extra attempt slips through on a race).
  await admin.from('pairing_attempts').insert({ ip_key: ipKey });

  // --- Parse and validate input ---
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

  // --- Look up the pairing code ---
  const { data: pairingRow, error: lookupErr } = await admin
    .from('pairing_codes')
    .select('id, token, expires_at, used_at')
    .eq('code', code)
    .maybeSingle();

  if (lookupErr) {
    console.error('[POST /api/tv/pair] lookup error', lookupErr);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }

  if (!pairingRow) {
    return NextResponse.json({ error: 'Invalid code' }, { status: 404 });
  }

  if (pairingRow.used_at !== null) {
    return NextResponse.json({ error: 'Code already used' }, { status: 410 });
  }

  if (new Date(pairingRow.expires_at) <= new Date()) {
    return NextResponse.json({ error: 'Code expired' }, { status: 410 });
  }

  // --- Mark the code as used (single-use) ---
  const { error: markErr } = await admin
    .from('pairing_codes')
    .update({ used_at: new Date().toISOString() })
    .eq('id', pairingRow.id);

  if (markErr) {
    console.error('[POST /api/tv/pair] mark-used error', markErr);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }

  // --- Fetch the associated tv_session to return channel_name ---
  const { data: session, error: sessErr } = await admin
    .from('tv_sessions')
    .select('token, channel_name, expires_at, is_active, display_state')
    .eq('token', pairingRow.token)
    .maybeSingle();

  if (sessErr || !session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  if (!session.is_active || new Date(session.expires_at) <= new Date()) {
    return NextResponse.json({ error: 'Session expired or revoked' }, { status: 410 });
  }

  // Set an HttpOnly cookie on the TV browser so the token is never exposed to JS
  // or URLs.  The TV just receives channel_name and display_state — the token
  // stays server-side only from this point.
  const res = NextResponse.json({
    channel_name:  session.channel_name,
    display_state: (session as { display_state?: boolean }).display_state ?? false,
  });
  setTVCookie(res, session.token);
  return res;
}

// ---------------------------------------------------------------------------
// POST /api/tv/pair/code is handled via a sub-route: /api/tv/pair/code/route.ts
// But since Next.js App Router doesn't allow siblings of catch-all routes,
// we use a query-param convention instead:
//
// POST /api/tv/pair?action=generate — admin-auth; generates a code for the
//                                     current session.
// ---------------------------------------------------------------------------
// NOTE: We re-export a named PATCH handler as the "generate code" endpoint
// to avoid creating an extra directory. Admin calls PATCH, TV calls POST.
// ---------------------------------------------------------------------------

export async function PATCH(req: NextRequest) {
  try {
    await requireAuth();

    const body = await req.json() as { token?: string };
    const { token } = body;
    if (!token) {
      return NextResponse.json({ error: 'Missing token' }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();

    // Verify the session exists and is active
    const { data: session, error: sessErr } = await admin
      .from('tv_sessions')
      .select('token, expires_at, is_active')
      .eq('token', token)
      .maybeSingle();

    if (sessErr || !session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    if (!session.is_active || new Date(session.expires_at) <= new Date()) {
      return NextResponse.json({ error: 'Session expired or revoked' }, { status: 410 });
    }

    // Invalidate any existing unused codes for this session to avoid confusion
    await admin
      .from('pairing_codes')
      .update({ used_at: new Date().toISOString() })
      .eq('token', token)
      .is('used_at', null);

    // Generate and insert a fresh 6-digit code (expires in 5 minutes)
    const code = generateSixDigitCode();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    const { error: insertErr } = await admin
      .from('pairing_codes')
      .insert({ code, token, expires_at: expiresAt });

    if (insertErr) throw insertErr;

    return NextResponse.json({ code, expires_at: expiresAt }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('[PATCH /api/tv/pair]', err);
    return NextResponse.json({ error: 'Failed to generate code' }, { status: 500 });
  }
}
