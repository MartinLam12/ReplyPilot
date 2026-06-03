import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const protectedRoutes = ["/dashboard", "/inbox", "/contacts", "/settings"];
const authRoutes = ["/login", "/signup"];
// User must be logged in but does not need an active subscription.
const subscriptionExemptRoutes = ["/subscribe"];

function buildCSP(nonce: string): string {
  const devEval = process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${devEval} https://challenges.cloudflare.com`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https: cid:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://challenges.cloudflare.com",
    "frame-src 'self' https://challenges.cloudflare.com",
    "frame-ancestors 'none'",
  ].join("; ");
}

export async function middleware(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCSP(nonce);

  // Next.js reads the nonce from the CSP in request headers and applies it to
  // its internal script tags — it must be on the request, not just the response.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  if (!supabaseUrl || !supabaseKey || !supabaseUrl.startsWith("http")) {
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set("x-nonce", nonce);
    response.headers.set("Content-Security-Policy", csp);
    return response;
  }

  let supabaseResponse = NextResponse.next({ request: { headers: requestHeaders } });

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookieOptions: {
      secure: process.env.NODE_ENV === "production",
    },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        supabaseResponse = NextResponse.next({ request: { headers: requestHeaders } });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  // Stripe webhook requests arrive with no session cookie — bypass all auth logic.
  if (request.nextUrl.pathname === "/api/stripe/webhook") {
    supabaseResponse.headers.set("x-nonce", nonce);
    supabaseResponse.headers.set("Content-Security-Policy", csp);
    return supabaseResponse;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  const isProtected = protectedRoutes.some((route) => pathname.startsWith(route));
  const isSubscriptionExempt = subscriptionExemptRoutes.some((route) =>
    pathname.startsWith(route)
  );

  if (!user && (isProtected || isSubscriptionExempt)) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.searchParams.set("redirect", pathname);
    const redirectResponse = NextResponse.redirect(redirectUrl);
    supabaseResponse.cookies.getAll().forEach((cookie) =>
      redirectResponse.cookies.set(cookie.name, cookie.value, cookie)
    );
    redirectResponse.headers.set("x-nonce", nonce);
    redirectResponse.headers.set("Content-Security-Policy", csp);
    return redirectResponse;
  }

  if (user && isProtected) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("subscription_status")
      .eq("id", user.id)
      .single();

    if (profile?.subscription_status !== "active") {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/subscribe";
      const redirectResponse = NextResponse.redirect(redirectUrl);
      supabaseResponse.cookies.getAll().forEach((cookie) =>
        redirectResponse.cookies.set(cookie.name, cookie.value, cookie)
      );
      redirectResponse.headers.set("x-nonce", nonce);
      redirectResponse.headers.set("Content-Security-Policy", csp);
      return redirectResponse;
    }
  }

  if (user && authRoutes.some((route) => pathname.startsWith(route))) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/dashboard";
    const redirectResponse = NextResponse.redirect(redirectUrl);
    // Copy any refreshed session cookies so the token update is not lost.
    supabaseResponse.cookies.getAll().forEach((cookie) =>
      redirectResponse.cookies.set(cookie.name, cookie.value, cookie)
    );
    redirectResponse.headers.set("x-nonce", nonce);
    redirectResponse.headers.set("Content-Security-Policy", csp);
    return redirectResponse;
  }

  supabaseResponse.headers.set("x-nonce", nonce);
  supabaseResponse.headers.set("Content-Security-Policy", csp);
  return supabaseResponse;
}

export const config = {
  matcher: [
    {
      source:
        "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
