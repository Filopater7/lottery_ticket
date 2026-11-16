/**
 * Store Admin authentication helpers.
 *
 * Access keys are stored as PBKDF2-SHA256 (100 000 iterations) with a
 * per-store random salt.  Node's WebCrypto (available on Vercel / Node 18+)
 * is used so no additional packages are needed.
 *
 * The store-admin HttpOnly cookie stores:
 *   "<store_id>:<session_version>"
 * When a store's access key is reset, session_version is incremented and
 * all existing cookies become invalid on next verification.
 */

import { NextResponse } from 'next/server';

export const STORE_COOKIE     = 'store_admin_session';
export const COOKIE_MAX_AGE   = 60 * 60 * 24 * 30; // 30 days
// Cookie path is scoped to /store-admin so it is never sent to other routes
const COOKIE_PATH = '/store-admin';

// ---------------------------------------------------------------------------
// PBKDF2 helpers (Node WebCrypto — no packages)
// ---------------------------------------------------------------------------

/** Generate a random 32-byte hex salt. */
export function generateSalt(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Generate a random access key (UUID, 122 bits of entropy). */
export function generateAccessKey(): string {
  return crypto.randomUUID();
}

/** Derive a PBKDF2-SHA256 hex digest from a plaintext key + hex salt. */
export async function hashAccessKey(key: string, salt: string): Promise<string> {
  const enc     = new TextEncoder();
  const keyMat  = await crypto.subtle.importKey('raw', enc.encode(key), 'PBKDF2', false, ['deriveBits']);
  const saltBuf = enc.encode(salt);
  const bits    = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBuf, iterations: 100_000 },
    keyMat,
    256,
  );
  return Array.from(new Uint8Array(bits)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time comparison via PBKDF2 re-derivation. */
export async function verifyAccessKey(
  candidate: string,
  storedHash: string,
  salt: string,
): Promise<boolean> {
  const derived = await hashAccessKey(candidate, salt);
  // Compare byte-by-byte to avoid short-circuit timing leaks
  if (derived.length !== storedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < derived.length; i++) {
    diff |= derived.charCodeAt(i) ^ storedHash.charCodeAt(i);
  }
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

/** Set the store-admin session cookie: "<store_id>:<session_version>" */
export function setStoreCookie(res: NextResponse, storeId: string, sessionVersion: number) {
  res.cookies.set(STORE_COOKIE, `${storeId}:${sessionVersion}`, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path:     COOKIE_PATH,
    maxAge:   COOKIE_MAX_AGE,
  });
}

export function clearStoreCookie(res: NextResponse) {
  res.cookies.set(STORE_COOKIE, '', {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path:     COOKIE_PATH,
    maxAge:   0,
  });
}

/** Parse the cookie value → { storeId, sessionVersion } or null. */
export function parseStoreCookie(value: string | undefined): { storeId: string; sessionVersion: number } | null {
  if (!value) return null;
  const parts = value.split(':');
  if (parts.length !== 2) return null;
  const [storeId, versionStr] = parts;
  const sessionVersion = parseInt(versionStr, 10);
  if (!storeId || isNaN(sessionVersion)) return null;
  return { storeId, sessionVersion };
}
