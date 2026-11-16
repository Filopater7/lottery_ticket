import { NextRequest, NextResponse } from 'next/server';
import { MOCK_ITEMS } from '@/lib/mockData';
import { TV_COOKIE } from '@/lib/tv-cookie';
import type { LotteryItem } from '@/types';

export const dynamic = 'force-dynamic';

const DB_CONFIGURED =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY;

function normalize(item: LotteryItem): LotteryItem {
  return { ...item, price: item.price != null ? Number(item.price) as LotteryItem['price'] : null };
}

export async function GET(req: NextRequest) {
  try {
    if (!DB_CONFIGURED) {
      return NextResponse.json({ data: MOCK_ITEMS });
    }

    const { createSupabaseAdminClient } = await import('@/lib/supabase/server');
    const admin = createSupabaseAdminClient();

    // ── Store-scoped TV path ──────────────────────────────────────────────
    // If the request carries a tv_session cookie, check whether that session
    // is linked to a store.  If it is, return only that store's ordered
    // selection (joined against master item data so images/titles are live).
    const tvToken = req.cookies.get(TV_COOKIE)?.value;
    if (tvToken) {
      const { data: session } = await admin
        .from('tv_sessions')
        .select('store_id, is_active, expires_at')
        .eq('token', tvToken)
        .maybeSingle();

      if (
        session &&
        session.is_active &&
        new Date(session.expires_at as string) > new Date() &&
        session.store_id
      ) {
        // Fetch the store's ordered selection joined with master item data
        const { data: selRows, error: selErr } = await admin
          .from('store_selections')
          .select('sort_order, items:item_id ( id, number, code, title, image_url, price, enabled )')
          .eq('store_id', session.store_id)
          .order('sort_order', { ascending: true });

        if (selErr) throw selErr;

        if (!selRows || selRows.length === 0) {
          // Option B: store has no selections → return empty with a message flag
          return NextResponse.json({ data: [], empty_store: true });
        }

        // Filter to only enabled master items (master admin may have hidden one)
        const items = (selRows ?? [])
          .map((r) => normalize(r.items as unknown as LotteryItem))
          .filter((item) => item.enabled);

        return NextResponse.json({ data: items });
      }
      // Session without store_id OR invalid/expired → fall through to full list
      // (backward-compat for TV sessions created before store feature)
    }

    // ── Default public path ───────────────────────────────────────────────
    // No TV cookie, or TV session has no store_id: return all enabled items.
    // This is the path used by the public homepage and legacy TV sessions.
    const { data, error } = await admin
      .from('items')
      .select('id, number, code, title, image_url, price, enabled')
      .eq('enabled', true)
      .order('number', { ascending: true })
      .limit(200);

    if (error) throw error;

    return NextResponse.json(
      { data: (data as LotteryItem[]).map(normalize) },
      { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } }
    );
  } catch (err) {
    console.error('[GET /api/items]', err);
    return NextResponse.json({ error: 'Failed to load items' }, { status: 500 });
  }
}
