import { createSupabaseServerClient, createSupabaseAdminClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import type { LotteryItem } from '@/types';

// Supabase REST can return integer columns as strings — normalize price
function normalize(item: LotteryItem): LotteryItem {
  return { ...item, price: item.price != null ? Number(item.price) as LotteryItem['price'] : null };
}

async function requireAuth() {
  const supabase = await createSupabaseServerClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Unauthorized');
  return session;
}

export async function GET() {
  try {
    await requireAuth();
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from('items')
      .select('*')
      .order('number', { ascending: true });
    if (error) throw error;
    return NextResponse.json({ data: (data as LotteryItem[]).map(normalize) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: 'Failed to load items' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAuth();
    const body = await req.json();
    const { number, title, code, image_url, price, enabled } = body;

    if (!number || typeof number !== 'number' || number < 1 || number > 9999) {
      return NextResponse.json({ error: 'Invalid item number (1-9999)' }, { status: 400 });
    }
    if (typeof title !== 'string') {
      return NextResponse.json({ error: 'Invalid title' }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from('items')
      .insert({ number, code: code?.trim() || null, title: title.trim(), image_url: image_url || null, price: price ?? null, enabled: enabled ?? true })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') return NextResponse.json({ error: `Item #${number} already exists` }, { status: 409 });
      throw error;
    }

    revalidatePath('/');
    revalidatePath('/api/items');
    return NextResponse.json({ data: normalize(data as LotteryItem) }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: 'Failed to create item' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    await requireAuth();
    const body = await req.json();
    const { id, number, title, code, image_url, price, enabled } = body;

    if (!id) return NextResponse.json({ error: 'Missing item id' }, { status: 400 });
    if (typeof number !== 'number' || number < 1 || number > 9999) {
      return NextResponse.json({ error: 'Invalid item number (1-9999)' }, { status: 400 });
    }
    if (typeof title !== 'string') {
      return NextResponse.json({ error: 'Invalid title' }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from('items')
      .update({ number, code: code?.trim() || null, title: title.trim(), image_url: image_url || null, price: price ?? null, enabled: enabled ?? true })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') return NextResponse.json({ error: `Item #${number} already exists` }, { status: 409 });
      throw error;
    }

    revalidatePath('/');
    revalidatePath('/api/items');
    return NextResponse.json({ data: normalize(data as LotteryItem) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: 'Failed to update item' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await requireAuth();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Missing item id' }, { status: 400 });

    const admin = createSupabaseAdminClient();
    const { error } = await admin.from('items').delete().eq('id', id);
    if (error) throw error;

    revalidatePath('/');
    revalidatePath('/api/items');
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: 'Failed to delete item' }, { status: 500 });
  }
}
