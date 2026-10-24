import { NextResponse } from 'next/server';
import { MOCK_ITEMS } from '@/lib/mockData';

export const dynamic = 'force-dynamic';

const DB_CONFIGURED =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function GET() {
  try {
    if (!DB_CONFIGURED) {
      return NextResponse.json({ data: MOCK_ITEMS });
    }

    const { createSupabaseAdminClient } = await import('@/lib/supabase/server');
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from('items')
      .select('id, number, title, image_url, enabled')
      .eq('enabled', true)
      .order('number', { ascending: true })
      .limit(200);

    if (error) throw error;

    return NextResponse.json({ data }, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    });
  } catch (err) {
    console.error('[GET /api/items]', err);
    return NextResponse.json({ error: 'Failed to load items' }, { status: 500 });
  }
}
