/**
 * /api/store/selection
 *
 * GET  — return this store's current ordered selection (item IDs + master item data)
 * PUT  — replace this store's selection (array of item IDs in desired order)
 *
 * Both endpoints require a valid store-admin session cookie.
 * Server enforces that the store in the cookie owns the selection being read/written.
 */

import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { STORE_COOKIE, parseStoreCookie } from '@/lib/store-auth';
import { NextRequest, NextResponse } from 'next/server';
import type { LotteryItem } from '@/types';

export const dynamic = 'force-dynamic';

function normalize(item: LotteryItem): LotteryItem {
  return { ...item, price: item.price != null ? (Number(item.price) as LotteryItem['price']) : null };
}

/** Verify the store cookie and return storeId, or throw a 401/403 response. */
async function requireStoreSession(req: NextRequest): Promise<string> {
  const cookieVal = req.cookies.get(STORE_COOKIE)?.value;
  const parsed    = parseStoreCookie(cookieVal);
  if (!parsed) throw NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createSupabaseAdminClient();
  const { data: store, error } = await admin
    .from('stores')
    .select('id, session_version, is_active')
    .eq('id', parsed.storeId)
    .maybeSingle();

  if (error || !store || (store.session_version as number) !== parsed.sessionVersion) {
    throw NextResponse.json({ error: 'Session expired' }, { status: 401 });
  }
  if (!(store.is_active as boolean)) {
    throw NextResponse.json({ error: 'Account deactivated' }, { status: 403 });
  }

  return store.id as string;
}

// ---------------------------------------------------------------------------
// GET /api/store/selection
// Returns: { data: Array<{ item_id, sort_order, item: LotteryItem }> }
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  let storeId: string;
  try {
    storeId = await requireStoreSession(req);
  } catch (res) {
    return res as NextResponse;
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('store_selections')
    .select('item_id, sort_order, items:item_id ( id, number, code, title, image_url, price, enabled )')
    .eq('store_id', storeId)
    .order('sort_order', { ascending: true });

  if (error) {
    console.error('[GET /api/store/selection]', error);
    return NextResponse.json({ error: 'Failed to load selection' }, { status: 500 });
  }

  // Normalize price field
  const normalized = (data ?? []).map((row) => ({
    item_id:    row.item_id,
    sort_order: row.sort_order,
    item:       normalize(row.items as unknown as LotteryItem),
  }));

  return NextResponse.json({ data: normalized });
}

// ---------------------------------------------------------------------------
// PUT /api/store/selection
// Body: { item_ids: string[] }  — ordered list of item UUIDs
// Replaces the entire selection atomically (delete + re-insert).
// ---------------------------------------------------------------------------
export async function PUT(req: NextRequest) {
  let storeId: string;
  try {
    storeId = await requireStoreSession(req);
  } catch (res) {
    return res as NextResponse;
  }

  const body = await req.json() as { item_ids?: unknown };
  if (!Array.isArray(body.item_ids) || body.item_ids.some((id) => typeof id !== 'string')) {
    return NextResponse.json({ error: 'item_ids must be an array of strings' }, { status: 400 });
  }
  const itemIds: string[] = body.item_ids;

  const admin = createSupabaseAdminClient();

  // Verify all supplied IDs exist in the master items table to prevent bogus inserts
  if (itemIds.length > 0) {
    const { data: found, error: checkErr } = await admin
      .from('items')
      .select('id')
      .in('id', itemIds);
    if (checkErr) throw checkErr;
    const foundIds = new Set((found ?? []).map((r: { id: string }) => r.id));
    const invalid  = itemIds.filter((id) => !foundIds.has(id));
    if (invalid.length > 0) {
      return NextResponse.json({ error: `Unknown item IDs: ${invalid.slice(0, 3).join(', ')}` }, { status: 400 });
    }
  }

  // Atomic replace: delete all then insert new order
  const { error: delErr } = await admin
    .from('store_selections')
    .delete()
    .eq('store_id', storeId);
  if (delErr) {
    console.error('[PUT /api/store/selection] delete', delErr);
    return NextResponse.json({ error: 'Failed to save selection' }, { status: 500 });
  }

  if (itemIds.length > 0) {
    const rows = itemIds.map((id, idx) => ({
      store_id:   storeId,
      item_id:    id,
      sort_order: idx,
    }));
    const { error: insErr } = await admin.from('store_selections').insert(rows);
    if (insErr) {
      console.error('[PUT /api/store/selection] insert', insErr);
      return NextResponse.json({ error: 'Failed to save selection' }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true, count: itemIds.length });
}
