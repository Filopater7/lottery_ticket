/**
 * /api/admin/stores  — Stores management, Main Admin only.
 *
 * GET    → list all stores (id, name, username, is_active, created_at)
 * POST   → create store; body: { name, username, password }
 * PATCH  → update store; body: { id, name? } | { id, username? } |
 *           { id, action: 'reset-password', password } |
 *           { id, action: 'toggle-active' }
 * DELETE → delete store (cascades selections; nullifies TV sessions)
 */

import { createSupabaseServerClient, createSupabaseAdminClient } from '@/lib/supabase/server';
import { generateSalt, hashPassword } from '@/lib/store-auth';
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
      .select('id, name, username, is_active, created_at, updated_at')
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
// Body: { name: string, username: string, password: string }
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    await requireMainAdmin();
    const body = await req.json() as { name?: string; username?: string; password?: string };
    const name     = body.name?.trim();
    const username = body.username?.trim().toLowerCase();
    const password = body.password;

    if (!name)     return NextResponse.json({ error: 'Store name is required' },  { status: 400 });
    if (!username) return NextResponse.json({ error: 'Username is required' },     { status: 400 });
    if (!password || password.length < 6)
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });

    const salt = generateSalt();
    const hash = await hashPassword(password, salt);

    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from('stores')
      .insert({
        name,
        username,
        password_hash: hash,
        password_salt: salt,
        session_version: 0,
        is_active: true,
        // legacy columns — set to placeholder so NOT NULL is satisfied if column exists
        access_key_hash: hash,
        key_salt: salt,
      })
      .select('id, name, username, is_active, created_at')
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: `Username "${username}" is already taken` }, { status: 409 });
      }
      throw error;
    }

    return NextResponse.json(data, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'error';
    if (msg === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('[POST /api/admin/stores]', err);
    return NextResponse.json({ error: 'Failed to create store' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/admin/stores
// { id, name }                           → rename store
// { id, username }                       → change username
// { id, action:'reset-password', password } → new password (bumps session_version)
// { id, action:'toggle-active' }         → flip is_active (bumps session_version if deactivating)
// ---------------------------------------------------------------------------
export async function PATCH(req: NextRequest) {
  try {
    await requireMainAdmin();
    const body = await req.json() as {
      id?: string;
      name?: string;
      username?: string;
      action?: string;
      password?: string;
    };
    const { id, action } = body;
    if (!id) return NextResponse.json({ error: 'Missing store id' }, { status: 400 });

    const admin = createSupabaseAdminClient();

    // Fetch current row for version bump
    const { data: current, error: fetchErr } = await admin
      .from('stores')
      .select('session_version, is_active, name')
      .eq('id', id)
      .maybeSingle();
    if (fetchErr || !current) return NextResponse.json({ error: 'Store not found' }, { status: 404 });

    if (action === 'reset-password') {
      const { password } = body;
      if (!password || password.length < 6)
        return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });

      const salt = generateSalt();
      const hash = await hashPassword(password, salt);
      const { error } = await admin
        .from('stores')
        .update({
          password_hash:   hash,
          password_salt:   salt,
          // keep legacy cols in sync so old code paths don't break
          access_key_hash: hash,
          key_salt:        salt,
          session_version: (current.session_version as number) + 1,
        })
        .eq('id', id);
      if (error) throw error;
      return NextResponse.json({ success: true });
    }

    if (action === 'toggle-active') {
      const nowActive = !(current.is_active as boolean);
      const updateData: Record<string, unknown> = { is_active: nowActive };
      // Bump session_version when deactivating so existing sessions are immediately revoked
      if (!nowActive) updateData.session_version = (current.session_version as number) + 1;
      const { error } = await admin.from('stores').update(updateData).eq('id', id);
      if (error) throw error;
      return NextResponse.json({ success: true, is_active: nowActive });
    }

    // Name / username update
    const updates: Record<string, string> = {};
    const trimmedName     = body.name?.trim();
    const trimmedUsername = body.username?.trim().toLowerCase();
    if (trimmedName)     updates.name     = trimmedName;
    if (trimmedUsername) updates.username = trimmedUsername;
    if (Object.keys(updates).length === 0)
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

    const { error } = await admin.from('stores').update(updates).eq('id', id);
    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: `Username "${trimmedUsername}" is already taken` }, { status: 409 });
      }
      throw error;
    }
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'error';
    if (msg === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('[PATCH /api/admin/stores]', err);
    return NextResponse.json({ error: 'Failed to update store' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/admin/stores?id=
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
