import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { STORE_COOKIE, parseStoreCookie } from '@/lib/store-auth';

const DB_CONFIGURED =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Cookie clear options — must match the original Set-Cookie path/domain exactly
function storeCookieClearOptions() {
  return {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path:     '/',
    maxAge:   0,
  };
}

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // ── Store Admin guard ────────────────────────────────────────────────
  //
  // Rules:
  //   /store-admin/login   → always publicly accessible (never redirect away)
  //   /store-admin/logout  → always pass through (the route handler clears the cookie)
  //   /store-admin/*       → require a structurally-valid cookie; redirect to login if absent
  //
  // We do NOT redirect authenticated users away from login here — that caused
  // the infinite loop.  The login page's server action handles post-login
  // navigation.  The only redirect we make is unauthenticated → login.
  // ─────────────────────────────────────────────────────────────────────
  if (path.startsWith('/store-admin')) {
    // Login and logout are always reachable with no cookie check
    if (path === '/store-admin/login' || path === '/store-admin/logout') {
      return NextResponse.next();
    }

    const cookieVal = request.cookies.get(STORE_COOKIE)?.value;
    const parsed    = parseStoreCookie(cookieVal);

    // No valid cookie → redirect to login, clearing any malformed cookie value
    if (!parsed) {
      const res = NextResponse.redirect(new URL('/store-admin/login', request.url));
      if (cookieVal) {
        // Stale/malformed cookie — clear it so the browser doesn't keep sending it
        res.cookies.set(STORE_COOKIE, '', storeCookieClearOptions());
      }
      return res;
    }

    // Cookie looks structurally valid — let the page/route do the DB check
    return NextResponse.next();
  }

  // ── Main Admin guard ─────────────────────────────────────────────────
  const isAdminPath = path.startsWith('/admin');
  const isLoginPath = path === '/admin/login';

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
