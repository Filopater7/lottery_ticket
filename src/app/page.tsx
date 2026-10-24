import { Suspense } from 'react';
import type { LotteryItem } from '@/types';
import DisplayBoard from '@/components/DisplayBoard';
import { MOCK_ITEMS } from '@/lib/mockData';

export const dynamic = 'force-dynamic';

const DB_CONFIGURED =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY;

async function getItems(): Promise<LotteryItem[]> {
  if (!DB_CONFIGURED) return MOCK_ITEMS;

  const { createSupabaseAdminClient } = await import('@/lib/supabase/server');
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from('items')
    .select('id, number, title, image_url, enabled')
    .eq('enabled', true)
    .order('number', { ascending: true })
    .limit(200);

  if (error) {
    console.error('[page] Failed to load items:', error);
    return MOCK_ITEMS;
  }
  return data as LotteryItem[];
}

export default async function HomePage() {
  const items = await getItems();

  return (
    <main className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white border-b border-slate-100 shadow-sm">
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-brand-600 flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 6v.75m0 3v.75m0 3v.75m0 3V18m-9-5.25h5.25M7.5 15h3M3.375 5.25c-.621 0-1.125.504-1.125 1.125v3.026a2.999 2.999 0 010 5.198v3.026c0 .621.504 1.125 1.125 1.125h17.25c.621 0 1.125-.504 1.125-1.125v-3.026a2.999 2.999 0 010-5.198V6.375c0-.621-.504-1.125-1.125-1.125H3.375z" />
              </svg>
            </div>
            <h1 className="text-sm font-semibold text-slate-900 tracking-tight">Lottery Display</h1>
          </div>
          <p className="text-xs text-slate-400 tabular-nums">
            {items.length} ticket{items.length !== 1 ? 's' : ''}
          </p>
        </div>
      </header>

      {/* Content */}
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <Suspense fallback={<GridSkeleton />}>
          <DisplayBoard initialItems={items} />
        </Suspense>
      </div>
    </main>
  );
}

function GridSkeleton() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-3">
      {Array.from({ length: 50 }).map((_, i) => (
        <div key={i} className="card overflow-hidden animate-pulse">
          <div className="bg-slate-100" style={{aspectRatio: '5/3'}} />
          <div className="px-3 py-2.5">
            <div className="h-3 bg-slate-100 rounded w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
}
