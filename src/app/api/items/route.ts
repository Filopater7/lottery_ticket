import { NextResponse } from 'next/server';
import { MOCK_ITEMS } from '@/lib/mockData';
import type { LotteryItem } from '@/types';

export const dynamic = 'force-dynamic';

const DB_CONFIGURED =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY;

function normalize(item: LotteryItem): LotteryItem {
  return { ...item, price: item.price != null ? Number(item.price) as LotteryItem['price'] : null };
}

export async function GET() {
  try {
    if (!DB_CONFIGURED) {
      return NextResponse.json({ data: MOCK_ITEMS });
    }

    const { createSupabaseAdminClient } = await import('@/lib/supabase/server');
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
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
