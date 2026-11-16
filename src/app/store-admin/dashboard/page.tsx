import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { STORE_COOKIE, parseStoreCookie } from '@/lib/store-auth';
import StoreAdminClient from '@/components/StoreAdminClient';
import type { LotteryItem } from '@/types';

export const dynamic = 'force-dynamic';

async function getStoreContext() {
  const cookieStore = await cookies();
  const cookieVal   = cookieStore.get(STORE_COOKIE)?.value;
  const parsed      = parseStoreCookie(cookieVal);
  if (!parsed) return null;

  const { createSupabaseAdminClient } = await import('@/lib/supabase/server');
  const admin = createSupabaseAdminClient();

  const { data: store } = await admin
    .from('stores')
    .select('id, name, session_version, is_active')
    .eq('id', parsed.storeId)
    .maybeSingle();

  if (!store || (store.session_version as number) !== parsed.sessionVersion) return null;
  if (!(store.is_active as boolean)) return null;
  return { storeId: store.id as string, storeName: store.name as string };
}

async function getAllItems(): Promise<LotteryItem[]> {
  const { createSupabaseAdminClient } = await import('@/lib/supabase/server');
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from('items')
    .select('id, number, code, title, image_url, price, enabled')
    .order('number', { ascending: true });
  return ((data ?? []) as LotteryItem[]).map((item) => ({
    ...item,
    price: item.price != null ? (Number(item.price) as LotteryItem['price']) : null,
  }));
}

async function getStoreSelection(storeId: string): Promise<string[]> {
  const { createSupabaseAdminClient } = await import('@/lib/supabase/server');
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from('store_selections')
    .select('item_id')
    .eq('store_id', storeId)
    .order('sort_order', { ascending: true });
  return (data ?? []).map((r: { item_id: string }) => r.item_id);
}

export default async function StoreAdminDashboardPage() {
  const ctx = await getStoreContext();
  if (!ctx) redirect('/store-admin/logout');  // clears stale cookie, then → login

  const [allItems, selectedIds] = await Promise.all([
    getAllItems(),
    getStoreSelection(ctx.storeId),
  ]);

  return (
    <StoreAdminClient
      storeId={ctx.storeId}
      storeName={ctx.storeName}
      allItems={allItems}
      initialSelectedIds={selectedIds}
    />
  );
}
