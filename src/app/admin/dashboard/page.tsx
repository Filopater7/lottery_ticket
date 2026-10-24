import type { LotteryItem } from '@/types';
import AdminDashboardClient from '@/components/AdminDashboardClient';
import { MOCK_ITEMS } from '@/lib/mockData';

const DB_CONFIGURED =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY;

async function getItems(): Promise<LotteryItem[]> {
  if (!DB_CONFIGURED) return MOCK_ITEMS;
  const { createSupabaseAdminClient } = await import('@/lib/supabase/server');
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from('items')
    .select('*')
    .order('number', { ascending: true });
  if (error) return MOCK_ITEMS;
  // Normalize price: Supabase REST may return integer columns as strings
  return (data as LotteryItem[]).map((item) => ({
    ...item,
    price: item.price != null ? Number(item.price) as LotteryItem['price'] : null,
  }));
}

async function getSession() {
  if (!DB_CONFIGURED) return null;
  const { createSupabaseServerClient } = await import('@/lib/supabase/server');
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user ? { user } : null;
}

export default async function AdminDashboardPage() {
  const session = await getSession();

  // When DB is configured, require a real session
  if (DB_CONFIGURED && !session) {
    const { redirect } = await import('next/navigation');
    redirect('/admin/login');
  }

  const items = await getItems();
  const userEmail = session?.user?.email ?? 'demo@example.com';

  return (
    <AdminDashboardClient
      initialItems={items}
      userEmail={userEmail}
      isDemo={!DB_CONFIGURED}
    />
  );
}
