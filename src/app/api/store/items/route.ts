/**
 * GET /api/store/items
 *
 * Returns all master items for browsing in the Store Admin dashboard.
 * Requires a valid store-admin session cookie.
 * Store Admins receive read-only item data — no edit/delete capability here.
 */

import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { STORE_COOKIE, parseStoreCookie } from '@/lib/store-auth';
import { NextRequest, NextResponse } from 'next/server';
import type { LotteryItem } from '@/types';

export const dynamic = 'force-dynamic';

function normalize(item: LotteryItem): LotteryItem {
  return { ...item, price: item.price != null ? (Number(item.price) as LotteryItem['price']) : null };
}

export async function GET(req: NextRequest) {
  // Verify store session
  const cookieVal = req.cookies.get(STORE_COOKIE)?.value;
  const parsed    = parseStoreCookie(cookieVal);
  if (!parsed) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Validate session_version (key-reset invalidation)
  const admin = createSupabaseAdminClient();
  const { data: store, error: storeErr } = await admin
    .from('stores')
    .select('session_version')
    .eq('id', parsed.storeId)
    .maybeSingle();

  if (storeErr || !store || (store.session_version as number) !== parsed.sessionVersion) {
    return NextResponse.json({ error: 'Session expired' }, { status: 401 });
  }

  // Fetch all master items (enabled and disabled — store admin needs to see all)
  const { data, error } = await admin
    .from('items')
    .select('id, number, code, title, image_url, price, enabled')
    .order('number', { ascending: true });

  if (error) {
    console.error('[GET /api/store/items]', error);
    return NextResponse.json({ error: 'Failed to load items' }, { status: 500 });
  }

  return NextResponse.json({ data: (data as LotteryItem[]).map(normalize) });
}
