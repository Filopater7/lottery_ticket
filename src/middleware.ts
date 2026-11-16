import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { STORE_COOKIE, parseStoreCookie } from '@/lib/store-auth';

const DB_CONFIGURED =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // ── Store Admin guard ────────────────────────────────────────────────
  if (path.startsWith('/store-admin')) {
    const isStoreLoginPath  = path === '/store-admin/login';
    const isStoreLogoutPath = path === '/store-admin/logout'; // must always pass through
    const cookieVal = request.cookies.get(STORE_COOKIE)?.value;
    const parsed    = parseStoreCookie(cookieVal);

    // Always allow the logout route — it clears the cookie itself
    if (isStoreLogoutPath) return NextResponse.next();

    if (!isStoreLoginPath && !parsed) {
      return NextResponse.redirect(new URL('/store-admin/login', request.url));
    }
    if (isStoreLoginPath && parsed) {
      return NextResponse.redirect(new URL('/store-admin/dashboard', request.url));
    }
    return NextResponse.next();
  }

  // ── Main Admin guard ─────────────────────────────────────────────────
  const isAdminPath  = path.startsWith('/admin');
  const isLoginPath  = path === '/admin/login';

  if (!DB_CONFIGURED) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set(name, value);
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set(name, value, options);
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set(name, '');
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set(name, '', { ...options, maxAge: 0 });
        },
      },
    }
  );

  const { data: { session } } = await supabase.auth.getSession();

  if (isAdminPath && !isLoginPath && !session) {
    return NextResponse.redirect(new URL('/admin/login', request.url));
  }

  if (isLoginPath && session) {
    return NextResponse.redirect(new URL('/admin/dashboard', request.url));
  }

  return response;
}

export const config = {
  matcher: ['/admin/:path*', '/store-admin/:path*'],
};
