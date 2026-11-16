/**
 * /api/admin/stores  — Stores management, Main Admin only.
 *
 * GET    → list all stores (id, name, created_at — no hash/salt)
 * POST   → create store; returns plaintext key once
 * PATCH  → rename store OR reset access key (?action=reset-key)
 * DELETE → delete store (cascades selections; nullifies TV sessions)
 */

import { createSupabaseServerClient, createSupabaseAdminClient } from '@/lib/supabase/server';
import {
  generateAccessKey,
  generateSalt,
  hashAccessKey,
} from '@/lib/store-auth';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

async function requireMainAdmin() {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error('Unauthorized');
  return user;
}

// ---------------------------------------------------------------------------
// GET /api/admin/stores
// ---------------------------------------------------------------------------
export async function GET() {
  try {
    await requireMainAdmin();
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from('stores')
      .select('id, name, created_at, updated_at, session_version')
      .order('created_at', { ascending: true });
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'error';
    if (msg === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('[GET /api/admin/stores]', err);
    return NextResponse.json({ error: 'Failed to list stores' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST /api/admin/stores  — create a store
// Body: { name: string }
// Returns: { id, name, access_key }  (access_key shown once — never again)
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    await requireMainAdmin();
    const body = await req.json() as { name?: string };
    const name = body.name?.trim();
    if (!name) return NextResponse.json({ error: 'Store name is required' }, { status: 400 });

    const key  = generateAccessKey();
    const salt = generateSalt();
    const hash = await hashAccessKey(key, salt);

    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from('stores')
      .insert({ name, access_key_hash: hash, key_salt: salt, session_version: 0 })
      .select('id, name, created_at')
      .single();
    if (error) throw error;

    // Return the plaintext key exactly once
    return NextResponse.json({ ...data, access_key: key }, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'error';
    if (msg === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('[POST /api/admin/stores]', err);
    return NextResponse.json({ error: 'Failed to create store' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/admin/stores
// Body: { id: string, name?: string }  → rename
// Body: { id: string, action: 'reset-key' } → regenerate access key
// Returns: { success: true } or { success: true, access_key } for reset
// ---------------------------------------------------------------------------
export async function PATCH(req: NextRequest) {
  try {
    await requireMainAdmin();
    const body = await req.json() as { id?: string; name?: string; action?: string };
    const { id, name, action } = body;
    if (!id) return NextResponse.json({ error: 'Missing store id' }, { status: 400 });

    const admin = createSupabaseAdminClient();

    if (action === 'reset-key') {
      const key  = generateAccessKey();
      const salt = generateSalt();
      const hash = await hashAccessKey(key, salt);

      // Increment session_version to invalidate all existing store-admin cookies
      const { data: current, error: fetchErr } = await admin
        .from('stores')
        .select('session_version')
        .eq('id', id)
        .single();
      if (fetchErr || !current) return NextResponse.json({ error: 'Store not found' }, { status: 404 });

      const { error } = await admin
        .from('stores')
        .update({
          access_key_hash: hash,
          key_salt: salt,
          session_version: (current.session_version as number) + 1,
        })
        .eq('id', id);
      if (error) throw error;

      return NextResponse.json({ success: true, access_key: key });
    }

    // Rename
    const trimmedName = name?.trim();
    if (!trimmedName) return NextResponse.json({ error: 'Store name is required' }, { status: 400 });
    const { error } = await admin.from('stores').update({ name: trimmedName }).eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'error';
    if (msg === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('[PATCH /api/admin/stores]', err);
    return NextResponse.json({ error: 'Failed to update store' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/admin/stores?id=  — delete a store
// Cascades to store_selections; sets tv_sessions.store_id = NULL (ON DELETE SET NULL)
// Master items are NEVER touched.
// ---------------------------------------------------------------------------
export async function DELETE(req: NextRequest) {
  try {
    await requireMainAdmin();
    const id = req.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Missing store id' }, { status: 400 });

    const admin = createSupabaseAdminClient();
    const { error } = await admin.from('stores').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'error';
    if (msg === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('[DELETE /api/admin/stores]', err);
    return NextResponse.json({ error: 'Failed to delete store' }, { status: 500 });
  }
}
