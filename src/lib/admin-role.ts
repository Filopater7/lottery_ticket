/**
 * X-Auth-Role header enforcement for TV session API routes.
 *
 * SECURITY MODEL
 * ──────────────
 * The X-Auth-Role header selects WHICH authentication mechanism to verify.
 * It never grants permissions by itself. The header is an instruction to the
 * server about which credential to check — the credential is always verified
 * independently.
 *
 * Valid values:
 *   'main_admin'  → verify Supabase Auth (sb-* cookies); return 401 if absent/invalid
 *   'store_admin' → verify store_admin_session cookie; return 401 if absent/invalid
 *
 * No header / unknown value → used by TV browser public endpoints; handled separately.
 *
 * NO FALLBACK: if the declared role's credential is missing or invalid, the
 * request is rejected with 401. The server never tries another auth method.
 * This prevents the cookie-sharing attack where a Store Admin browser carries
 * the Main Admin's Supabase cookies and accidentally authenticates as Main Admin.
 */

import { NextRequest } from 'next/server';
import { createSupabaseServerClient, createSupabaseAdminClient } from '@/lib/supabase/server';
import { STORE_COOKIE, parseStoreCookie } from '@/lib/store-auth';

export type AdminRole = 'main_admin' | 'store_admin';

export type ResolvedAuth =
  | { role: 'main_admin' }
  | { role: 'store_admin'; storeId: string };

/** Read and validate X-Auth-Role header. Returns the role or null if absent/unknown. */
export function getRequestedRole(req: NextRequest): AdminRole | null {
  const header = req.headers.get('x-auth-role');
  if (header === 'main_admin' || header === 'store_admin') return header;
  return null;
}

/**
 * Resolve the caller's identity strictly based on the X-Auth-Role header.
 *
 * Returns ResolvedAuth on success.
 * Throws { status, message } on failure — caller must return the appropriate
 * HTTP error response.
 */
export async function resolveStrictAuth(req: NextRequest): Promise<ResolvedAuth> {
  const requestedRole = getRequestedRole(req);

  // ── main_admin path ──────────────────────────────────────────────────
  if (requestedRole === 'main_admin') {
    try {
      const supabase = await createSupabaseServerClient();
      const { data: { user }, error } = await supabase.auth.getUser();
      if (!error && user) return { role: 'main_admin' };
    } catch { /* fall through to 401 */ }
    throw { status: 401, message: 'Main Admin authentication required' };
  }

  // ── store_admin path ─────────────────────────────────────────────────
  if (requestedRole === 'store_admin') {
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
        // store_id is derived exclusively from the verified cookie — never from client input
        return { role: 'store_admin', storeId: store.id as string };
      }
    }
    throw { status: 401, message: 'Store Admin authentication required' };
  }

  // ── No role header ───────────────────────────────────────────────────
  // The caller is either the TV browser (public endpoints) or unauthenticated.
  // Admin-only endpoints must set X-Auth-Role; if they don't, treat as 401.
  throw { status: 401, message: 'X-Auth-Role header is required' };
}

/** Convenience: build a NextResponse-compatible 401 from a thrown auth error. */
export function authError(e: unknown): { status: number; message: string } {
  if (e && typeof e === 'object' && 'status' in e && 'message' in e) {
    return e as { status: number; message: string };
  }
  return { status: 401, message: 'Unauthorized' };
}
