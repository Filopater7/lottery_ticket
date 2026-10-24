import { createSupabaseServerClient, createSupabaseAdminClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const BUCKET = 'ticket-images';

async function requireAuth() {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error('Unauthorized');
  return user;
}

export async function POST(req: NextRequest) {
  try {
    await requireAuth();

    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: 'Invalid file type. Use JPEG, PNG, WebP, or GIF.' }, { status: 400 });
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'File too large. Maximum size is 5 MB.' }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    const arrayBuffer = await file.arrayBuffer();
    const { error: uploadError } = await admin.storage
      .from(BUCKET)
      .upload(filename, arrayBuffer, { contentType: file.type, upsert: false });

    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = admin.storage.from(BUCKET).getPublicUrl(filename);

    return NextResponse.json({ url: publicUrl });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('[POST /api/admin/upload]', err);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
