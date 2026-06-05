commit bc1857eee68593f94dcd2d715e5ef0aad7660313
Author: Martin Lam <martinlam16061@gmail.com>
Date:   Tue Jun 2 16:38:12 2026 -0700

    security: fix A01 broken access control and A02 misconfig findings
    
    A01 — Broken Access Control (OWASP A01:2025):
    - Gmail OAuth CSRF: add per-request state nonce (cookie + URL param)
      so the callback rejects flows not initiated by the current session.
      Without this an attacker could link their Gmail to the victim's account.
    - approveGeneration, send route, getThreadDetail: add .eq("user_id") to
      the three thread/generation writes that were missing the defense-in-depth
      user_id filter, consistent with the rest of the codebase.
    
    A02 — Security Misconfiguration (OWASP A02:2025):
    - CSP img-src: drop http: (cleartext image sources); https: is sufficient.
    - Add Strict-Transport-Security header (2-year max-age, includeSubDomains,
      preload) so browsers enforce HTTPS-only going forward.
    
    Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>

diff --git a/middleware.ts b/middleware.ts
index fa6b54f..1352e14 100644
--- a/middleware.ts
+++ b/middleware.ts
@@ -11,7 +11,7 @@ function buildCSP(nonce: string): string {
     `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${devEval}`,
     "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
     "font-src 'self' https://fonts.gstatic.com",
-    "img-src 'self' data: blob: https: http: cid:",
+    "img-src 'self' data: blob: https: cid:",
     "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
     "frame-ancestors 'none'",
   ].join("; ");
diff --git a/next.config.ts b/next.config.ts
index ab35454..1113a0c 100644
--- a/next.config.ts
+++ b/next.config.ts
@@ -6,6 +6,10 @@ const nextConfig: NextConfig = {
       {
         source: "/(.*)",
         headers: [
+          {
+            key: "Strict-Transport-Security",
+            value: "max-age=63072000; includeSubDomains; preload",
+          },
           {
             key: "X-Content-Type-Options",
             value: "nosniff",
diff --git a/src/app/actions/ai-generations.ts b/src/app/actions/ai-generations.ts
index fdfa71d..d75471f 100644
--- a/src/app/actions/ai-generations.ts
+++ b/src/app/actions/ai-generations.ts
@@ -27,7 +27,8 @@ export async function approveGeneration(
   await supabase
     .from("email_threads")
     .update({ status: "replied" })
-    .eq("id", threadId);
+    .eq("id", threadId)
+    .eq("user_id", user.id);
 
   // ── Style learning: add this sent reply as a voice sample ─────────────────
   // Runs after DB update, never throws — a failure here must not affect the UX.
diff --git a/src/app/actions/threads.ts b/src/app/actions/threads.ts
index 6ddcba5..78cbd3d 100644
--- a/src/app/actions/threads.ts
+++ b/src/app/actions/threads.ts
@@ -39,6 +39,7 @@ export async function getThreadDetail(threadId: string): Promise<EmailThread | n
     .from("ai_generations")
     .select("*")
     .eq("thread_id", threadId)
+    .eq("user_id", user.id)
     .order("created_at", { ascending: false })
     .limit(1)
     .single();
diff --git a/src/app/api/gmail/auth/route.ts b/src/app/api/gmail/auth/route.ts
index f533707..ebdf9b6 100644
--- a/src/app/api/gmail/auth/route.ts
+++ b/src/app/api/gmail/auth/route.ts
@@ -1,6 +1,7 @@
 import { NextResponse } from "next/server";
 import { google } from "googleapis";
 import { createClient } from "@/lib/supabase/server";
+import { randomBytes } from "crypto";
 
 export async function GET() {
   const supabase = await createClient();
@@ -10,6 +11,12 @@ export async function GET() {
     return NextResponse.redirect(new URL("/login", process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"));
   }
 
+  // Generate a per-request state nonce. Stored in an HTTP-only cookie and
+  // echoed back by Google's redirect — the callback verifies they match to
+  // prevent CSRF (an attacker tricking the victim into using the attacker's
+  // OAuth code to replace the victim's Gmail connection).
+  const state = randomBytes(32).toString("hex");
+
   const oauth2Client = new google.auth.OAuth2(
     process.env.GOOGLE_CLIENT_ID,
     process.env.GOOGLE_CLIENT_SECRET,
@@ -24,7 +31,16 @@ export async function GET() {
       "https://www.googleapis.com/auth/gmail.modify",
     ],
     prompt: "consent",
+    state,
   });
 
-  return NextResponse.redirect(authUrl);
+  const response = NextResponse.redirect(authUrl);
+  response.cookies.set("oauth_gmail_state", state, {
+    httpOnly: true,
+    secure: process.env.NODE_ENV === "production",
+    sameSite: "lax",
+    maxAge: 60 * 10, // 10 minutes — long enough for the consent flow
+    path: "/",
+  });
+  return response;
 }
diff --git a/src/app/api/gmail/callback/route.ts b/src/app/api/gmail/callback/route.ts
index fdfc796..c15b7dc 100644
--- a/src/app/api/gmail/callback/route.ts
+++ b/src/app/api/gmail/callback/route.ts
@@ -7,11 +7,21 @@ export async function GET(request: NextRequest) {
   const { searchParams, origin } = new URL(request.url);
   const code = searchParams.get("code");
   const error = searchParams.get("error");
+  const state = searchParams.get("state");
 
   if (error || !code) {
     return NextResponse.redirect(`${origin}/settings?error=gmail_denied`);
   }
 
+  // Verify the state parameter matches the cookie set in /api/gmail/auth.
+  // A missing or mismatched state means this request was not initiated by this
+  // session — reject it to prevent CSRF (attacker linking their Gmail to the
+  // victim's account).
+  const expectedState = request.cookies.get("oauth_gmail_state")?.value;
+  if (!state || !expectedState || state !== expectedState) {
+    return NextResponse.redirect(`${origin}/settings?error=gmail_invalid_state`);
+  }
+
   const supabase = await createClient();
   const { data: { user } } = await supabase.auth.getUser();
 
@@ -43,5 +53,8 @@ export async function GET(request: NextRequest) {
     { onConflict: "user_id" }
   );
 
-  return NextResponse.redirect(`${origin}/settings?connected=true`);
+  const response = NextResponse.redirect(`${origin}/settings?connected=true`);
+  // Clear the state cookie now that it has been consumed.
+  response.cookies.set("oauth_gmail_state", "", { maxAge: 0, path: "/" });
+  return response;
 }
diff --git a/src/app/api/gmail/send/route.ts b/src/app/api/gmail/send/route.ts
index d2d69bc..1b9ae6e 100644
--- a/src/app/api/gmail/send/route.ts
+++ b/src/app/api/gmail/send/route.ts
@@ -79,7 +79,8 @@ export async function POST(request: Request) {
   await supabase
     .from("email_threads")
     .update({ status: "replied", last_message_at: sentAt })
-    .eq("id", threadId);
+    .eq("id", threadId)
+    .eq("user_id", user.id);
 
   return NextResponse.json({ success: true });
 }

commit 0abfcd76b9f5b31215078a1e225f775a9c260bff
Author: Martin Lam <martinlam16061@gmail.com>
Date:   Wed Jun 3 00:36:54 2026 -0700

    OWASP and stripe

diff --git a/.gitignore b/.gitignore
index 47f0ae8..3f4eeac 100644
--- a/.gitignore
+++ b/.gitignore
@@ -45,3 +45,6 @@ next-env.d.ts
 .swarm/
 ruvector.db
 test-gemini.mjs
+
+# python virtualenv
+.venv/
diff --git a/middleware.ts b/middleware.ts
index 1352e14..9278ca0 100644
--- a/middleware.ts
+++ b/middleware.ts
@@ -3,16 +3,19 @@ import { NextResponse, type NextRequest } from "next/server";
 
 const protectedRoutes = ["/dashboard", "/inbox", "/contacts", "/settings"];
 const authRoutes = ["/login", "/signup"];
+// User must be logged in but does not need an active subscription.
+const subscriptionExemptRoutes = ["/subscribe"];
 
 function buildCSP(nonce: string): string {
   const devEval = process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'";
   return [
     "default-src 'self'",
-    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${devEval}`,
+    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${devEval} https://challenges.cloudflare.com`,
     "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
     "font-src 'self' https://fonts.gstatic.com",
     "img-src 'self' data: blob: https: cid:",
-    "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
+    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://challenges.cloudflare.com",
+    "frame-src 'self' https://challenges.cloudflare.com",
     "frame-ancestors 'none'",
   ].join("; ");
 }
@@ -40,6 +43,9 @@ export async function middleware(request: NextRequest) {
   let supabaseResponse = NextResponse.next({ request: { headers: requestHeaders } });
 
   const supabase = createServerClient(supabaseUrl, supabaseKey, {
+    cookieOptions: {
+      secure: process.env.NODE_ENV === "production",
+    },
     cookies: {
       getAll() {
         return request.cookies.getAll();
@@ -62,20 +68,52 @@ export async function middleware(request: NextRequest) {
 
   const { pathname } = request.nextUrl;
 
-  if (!user && protectedRoutes.some((route) => pathname.startsWith(route))) {
+  const isProtected = protectedRoutes.some((route) => pathname.startsWith(route));
+  const isSubscriptionExempt = subscriptionExemptRoutes.some((route) =>
+    pathname.startsWith(route)
+  );
+
+  if (!user && (isProtected || isSubscriptionExempt)) {
     const redirectUrl = request.nextUrl.clone();
     redirectUrl.pathname = "/login";
     redirectUrl.searchParams.set("redirect", pathname);
     const redirectResponse = NextResponse.redirect(redirectUrl);
+    supabaseResponse.cookies.getAll().forEach((cookie) =>
+      redirectResponse.cookies.set(cookie.name, cookie.value, cookie)
+    );
     redirectResponse.headers.set("x-nonce", nonce);
     redirectResponse.headers.set("Content-Security-Policy", csp);
     return redirectResponse;
   }
 
+  if (user && isProtected) {
+    const { data: profile } = await supabase
+      .from("profiles")
+      .select("subscription_status")
+      .eq("id", user.id)
+      .single();
+
+    if (profile?.subscription_status !== "active") {
+      const redirectUrl = request.nextUrl.clone();
+      redirectUrl.pathname = "/subscribe";
+      const redirectResponse = NextResponse.redirect(redirectUrl);
+      supabaseResponse.cookies.getAll().forEach((cookie) =>
+        redirectResponse.cookies.set(cookie.name, cookie.value, cookie)
+      );
+      redirectResponse.headers.set("x-nonce", nonce);
+      redirectResponse.headers.set("Content-Security-Policy", csp);
+      return redirectResponse;
+    }
+  }
+
   if (user && authRoutes.some((route) => pathname.startsWith(route))) {
     const redirectUrl = request.nextUrl.clone();
     redirectUrl.pathname = "/dashboard";
     const redirectResponse = NextResponse.redirect(redirectUrl);
+    // Copy any refreshed session cookies so the token update is not lost.
+    supabaseResponse.cookies.getAll().forEach((cookie) =>
+      redirectResponse.cookies.set(cookie.name, cookie.value, cookie)
+    );
     redirectResponse.headers.set("x-nonce", nonce);
     redirectResponse.headers.set("Content-Security-Policy", csp);
     return redirectResponse;
diff --git a/package-lock.json b/package-lock.json
index ce700e3..7d76c54 100644
--- a/package-lock.json
+++ b/package-lock.json
@@ -8,15 +8,17 @@
       "name": "replypilot",
       "version": "0.1.0",
       "dependencies": {
-        "@google/generative-ai": "^0.24.1",
-        "@supabase/ssr": "^0.10.0",
-        "@supabase/supabase-js": "^2.102.1",
-        "clsx": "^2.1.1",
-        "googleapis": "^171.4.0",
-        "lucide-react": "^1.7.0",
-        "next": "16.2.2",
+        "@google/generative-ai": "0.24.1",
+        "@marsidev/react-turnstile": "^1.5.2",
+        "@supabase/ssr": "0.10.0",
+        "@supabase/supabase-js": "2.102.1",
+        "clsx": "2.1.1",
+        "googleapis": "171.4.0",
+        "lucide-react": "1.7.0",
+        "next": "16.2.7",
         "react": "19.2.4",
-        "react-dom": "19.2.4"
+        "react-dom": "19.2.4",
+        "stripe": "^22.2.0"
       },
       "devDependencies": {
         "@tailwindcss/postcss": "^4",
@@ -25,7 +27,7 @@
         "@types/react": "^19",
         "@types/react-dom": "^19",
         "eslint": "^9",
-        "eslint-config-next": "16.2.2",
+        "eslint-config-next": "16.2.7",
         "jest": "^30.4.2",
         "jest-environment-node": "^30.4.1",
         "tailwindcss": "^4",
@@ -77,7 +79,6 @@
       "integrity": "sha512-CGOfOJqWjg2qW/Mb6zNsDm+u5vFQ8DxXfbM09z69p5Z6+mE1ikP2jUXw+j42Pf1XTYED2Rni5f95npYeuwMDQA==",
       "dev": true,
       "license": "MIT",
-      "peer": true,
       "dependencies": {
         "@babel/code-frame": "^7.29.0",
         "@babel/generator": "^7.29.0",
@@ -1824,6 +1825,16 @@
         "@jridgewell/sourcemap-codec": "^1.4.14"
       }
     },
+    "node_modules/@marsidev/react-turnstile": {
+      "version": "1.5.2",
+      "resolved": "https://registry.npmjs.org/@marsidev/react-turnstile/-/react-turnstile-1.5.2.tgz",
+      "integrity": "sha512-+3aBPxp86JzSC0ZmgyonoGoUEENcUkH3LGahXSpkV87ArvD2DzRCmPgh0FyQk6PQRmJwQJDAfwNavFsxUxMQWA==",
+      "license": "MIT",
+      "peerDependencies": {
+        "react": "^17.0.2 || ^18.0.0 || ^19.0",
+        "react-dom": "^17.0.2 || ^18.0.0 || ^19.0"
+      }
+    },
     "node_modules/@napi-rs/wasm-runtime": {
       "version": "0.2.12",
       "resolved": "https://registry.npmjs.org/@napi-rs/wasm-runtime/-/wasm-runtime-0.2.12.tgz",
@@ -1838,15 +1849,15 @@
       }
     },
     "node_modules/@next/env": {
-      "version": "16.2.2",
-      "resolved": "https://registry.npmjs.org/@next/env/-/env-16.2.2.tgz",
-      "integrity": "sha512-LqSGz5+xGk9EL/iBDr2yo/CgNQV6cFsNhRR2xhSXYh7B/hb4nePCxlmDvGEKG30NMHDFf0raqSyOZiQrO7BkHQ==",
+      "version": "16.2.7",
+      "resolved": "https://registry.npmjs.org/@next/env/-/env-16.2.7.tgz",
+      "integrity": "sha512-tMJizPlj6ZYpBMMdK8S0LJufrP4QTdR6pcv9KQ/bVETPAmg0j1mlHE9G2c38UyGHxoBapgwuj7XjbGJ2RcDFOg==",
       "license": "MIT"
     },
     "node_modules/@next/eslint-plugin-next": {
-      "version": "16.2.2",
-      "resolved": "https://registry.npmjs.org/@next/eslint-plugin-next/-/eslint-plugin-next-16.2.2.tgz",
-      "integrity": "sha512-IOPbWzDQ+76AtjZioaCjpIY72xNSDMnarZ2GMQ4wjNLvnJEJHqxQwGFhgnIWLV9klb4g/+amg88Tk5OXVpyLTw==",
+      "version": "16.2.7",
+      "resolved": "https://registry.npmjs.org/@next/eslint-plugin-next/-/eslint-plugin-next-16.2.7.tgz",
+      "integrity": "sha512-VbS+QgMHqvIDMTIqD2xMBKK1otIpdAUKA8VLHFwR9h6OfU/mOm7w/69nQcvdmI8hCk99Wr2AsGLn/PJ/tMHw1w==",
       "dev": true,
       "license": "MIT",
       "dependencies": {
@@ -1854,9 +1865,9 @@
       }
     },
     "node_modules/@next/swc-darwin-arm64": {
-      "version": "16.2.2",
-      "resolved": "https://registry.npmjs.org/@next/swc-darwin-arm64/-/swc-darwin-arm64-16.2.2.tgz",
-      "integrity": "sha512-B92G3ulrwmkDSEJEp9+XzGLex5wC1knrmCSIylyVeiAtCIfvEJYiN3v5kXPlYt5R4RFlsfO/v++aKV63Acrugg==",
+      "version": "16.2.7",
+      "resolved": "https://registry.npmjs.org/@next/swc-darwin-arm64/-/swc-darwin-arm64-16.2.7.tgz",
+      "integrity": "sha512-vm1EDI/pVaBNNiychmxk3fft+OhQPVD9cIM/tReLZIQ3TfQ4kqI9DwKk00dzuS1ulC7icbrzCFrmRRlk9PfNdw==",
       "cpu": [
         "arm64"
       ],
@@ -1870,9 +1881,9 @@
       }
     },
     "node_modules/@next/swc-darwin-x64": {
-      "version": "16.2.2",
-      "resolved": "https://registry.npmjs.org/@next/swc-darwin-x64/-/swc-darwin-x64-16.2.2.tgz",
-      "integrity": "sha512-7ZwSgNKJNQiwW0CKhNm9B1WS2L1Olc4B2XY0hPYCAL3epFnugMhuw5TMWzMilQ3QCZcCHoYm9NGWTHbr5REFxw==",
+      "version": "16.2.7",
+      "resolved": "https://registry.npmjs.org/@next/swc-darwin-x64/-/swc-darwin-x64-16.2.7.tgz",
+      "integrity": "sha512-O3IRSv1ZBL1zs0WrIgefTEcTKFVn+ryxBNe54erJ6KsD+2f/Mmt7g2jOYh8PSBdUwPtKQJuCsTMlZ7tIu2AcsQ==",
       "cpu": [
         "x64"
       ],
@@ -1886,9 +1897,9 @@
       }
     },
     "node_modules/@next/swc-linux-arm64-gnu": {
-      "version": "16.2.2",
-      "resolved": "https://registry.npmjs.org/@next/swc-linux-arm64-gnu/-/swc-linux-arm64-gnu-16.2.2.tgz",
-      "integrity": "sha512-c3m8kBHMziMgo2fICOP/cd/5YlrxDU5YYjAJeQLyFsCqVF8xjOTH/QYG4a2u48CvvZZSj1eHQfBCbyh7kBr30Q==",
+      "version": "16.2.7",
+      "resolved": "https://registry.npmjs.org/@next/swc-linux-arm64-gnu/-/swc-linux-arm64-gnu-16.2.7.tgz",
+      "integrity": "sha512-Re6PZtjBDd0aMU+VcZcC/PrIvj4WhrjDYtMhhCVQamWN4L90EVP0pcEOBQD25prSlw7OzNw5QpHLWMilRLsRNw==",
       "cpu": [
         "arm64"
       ],
@@ -1902,9 +1913,9 @@
       }
     },
     "node_modules/@next/swc-linux-arm64-musl": {
-      "version": "16.2.2",
-      "resolved": "https://registry.npmjs.org/@next/swc-linux-arm64-musl/-/swc-linux-arm64-musl-16.2.2.tgz",
-      "integrity": "sha512-VKLuscm0P/mIfzt+SDdn2+8TNNJ7f0qfEkA+az7OqQbjzKdBxAHs0UvuiVoCtbwX+dqMEL9U54b5wQ/aN3dHeg==",
+      "version": "16.2.7",
+      "resolved": "https://registry.npmjs.org/@next/swc-linux-arm64-musl/-/swc-linux-arm64-musl-16.2.7.tgz",
+      "integrity": "sha512-qyogG9QtBzWxgJfeGBvOEHI3851gTfCF3wLZ5RDLTBJGAmE9p1qDwKCOdrBrvBzRvYDT+gUDp72pzlSEfAXgNA==",
       "cpu": [
         "arm64"
       ],
@@ -1918,9 +1929,9 @@
       }
     },
     "node_modules/@next/swc-linux-x64-gnu": {
-      "version": "16.2.2",
-      "resolved": "https://registry.npmjs.org/@next/swc-linux-x64-gnu/-/swc-linux-x64-gnu-16.2.2.tgz",
-      "integrity": "sha512-kU3OPHJq6sBUjOk7wc5zJ7/lipn8yGldMoAv4z67j6ov6Xo/JvzA7L7LCsyzzsXmgLEhk3Qkpwqaq/1+XpNR3g==",
+      "version": "16.2.7",
+      "resolved": "https://registry.npmjs.org/@next/swc-linux-x64-gnu/-/swc-linux-x64-gnu-16.2.7.tgz",
+      "integrity": "sha512-Vhe4ZDuBpmMogrGi5D4R2Kq4JAQlj6+wvgaFYy31zfES0zPmt6TLA+cuYpM/OLrPZjo2MYQTHVqNUSCR6+fDZQ==",
       "cpu": [
         "x64"
       ],
@@ -1934,9 +1945,9 @@
       }
     },
     "node_modules/@next/swc-linux-x64-musl": {
-      "version": "16.2.2",
-      "resolved": "https://registry.npmjs.org/@next/swc-linux-x64-musl/-/swc-linux-x64-musl-16.2.2.tgz",
-      "integrity": "sha512-CKXRILyErMtUftp+coGcZ38ZwE/Aqq45VMCcRLr2I4OXKrgxIBDXHnBgeX/UMil0S09i2JXaDL3Q+TN8D/cKmg==",
+      "version": "16.2.7",
+      "resolved": "https://registry.npmjs.org/@next/swc-linux-x64-musl/-/swc-linux-x64-musl-16.2.7.tgz",
+      "integrity": "sha512-srvian89JahFLw1YLBEuhvPJ0DO5lpUeJQMXy4xYo7g628ZlNgXdNkqoxSAv9OYrBfByh6vxISMwW/mRbzCY+g==",
       "cpu": [
         "x64"
       ],
@@ -1950,9 +1961,9 @@
       }
     },
     "node_modules/@next/swc-win32-arm64-msvc": {
-      "version": "16.2.2",
-      "resolved": "https://registry.npmjs.org/@next/swc-win32-arm64-msvc/-/swc-win32-arm64-msvc-16.2.2.tgz",
-      "integrity": "sha512-sS/jSk5VUoShUqINJFvNjVT7JfR5ORYj/+/ZpOYbbIohv/lQfduWnGAycq2wlknbOql2xOR0DoV0s6Xfcy49+g==",
+      "version": "16.2.7",
+      "resolved": "https://registry.npmjs.org/@next/swc-win32-arm64-msvc/-/swc-win32-arm64-msvc-16.2.7.tgz",
+      "integrity": "sha512-GX3wvLpULFuRFJzwHaKfm7QZJ18F4ZSuxlPJ96BoBglCzBmdSjyeBKF+ZhWhvL/ckxNfLnNa7bsObO2ipYpszw==",
       "cpu": [
         "arm64"
       ],
@@ -1966,9 +1977,9 @@
       }
     },
     "node_modules/@next/swc-win32-x64-msvc": {
-      "version": "16.2.2",
-      "resolved": "https://registry.npmjs.org/@next/swc-win32-x64-msvc/-/swc-win32-x64-msvc-16.2.2.tgz",
-      "integrity": "sha512-aHaKceJgdySReT7qeck5oShucxWRiiEuwCGK8HHALe6yZga8uyFpLkPgaRw3kkF04U7ROogL/suYCNt/+CuXGA==",
+      "version": "16.2.7",
+      "resolved": "https://registry.npmjs.org/@next/swc-win32-x64-msvc/-/swc-win32-x64-msvc-16.2.7.tgz",
+      "integrity": "sha512-J4WlM72NMk076Qsg0jTdK3SNXatlSdnjW7L7oNGLst1tAGjHrJh/FYi+pw9wyIjEtGRKDNzD0zuiY16oWYWVaw==",
       "cpu": [
         "x64"
       ],
@@ -2174,7 +2185,6 @@
       "resolved": "https://registry.npmjs.org/@supabase/supabase-js/-/supabase-js-2.102.1.tgz",
       "integrity": "sha512-bChxPVeLDnYN9M2d/u4fXsvylwSQG5grAl+HN8f+ZD9a9PuVU+Ru+xGmEsk+b9Iz3rJC9ZQnQUJYQ28fApdWYA==",
       "license": "MIT",
-      "peer": true,
       "dependencies": {
         "@supabase/auth-js": "2.102.1",
         "@supabase/functions-js": "2.102.1",
@@ -2596,7 +2606,6 @@
       "integrity": "sha512-ilcTH/UniCkMdtexkoCN0bI7pMcJDvmQFPvuPvmEaYA/NSfFTAgdUSLAoVjaRJm7+6PvcM+q1zYOwS4wTYMF9w==",
       "dev": true,
       "license": "MIT",
-      "peer": true,
       "dependencies": {
         "csstype": "^3.2.2"
       }
@@ -2689,7 +2698,6 @@
       "integrity": "sha512-gGkiNMPqerb2cJSVcruigx9eHBlLG14fSdPdqMoOcBfh+vvn4iCq2C8MzUB89PrxOXk0y3GZ1yIWb9aOzL93bw==",
       "dev": true,
       "license": "MIT",
-      "peer": true,
       "dependencies": {
         "@typescript-eslint/scope-manager": "8.58.1",
         "@typescript-eslint/types": "8.58.1",
@@ -2844,9 +2852,9 @@
       }
     },
     "node_modules/@typescript-eslint/typescript-estree/node_modules/brace-expansion": {
-      "version": "5.0.5",
-      "resolved": "https://registry.npmjs.org/brace-expansion/-/brace-expansion-5.0.5.tgz",
-      "integrity": "sha512-VZznLgtwhn+Mact9tfiwx64fA9erHH/MCXEUfB/0bX/6Fz6ny5EGTXYltMocqg4xFAQZtnO3DHWWXi8RiuN7cQ==",
+      "version": "5.0.6",
+      "resolved": "https://registry.npmjs.org/brace-expansion/-/brace-expansion-5.0.6.tgz",
+      "integrity": "sha512-kLpxurY4Z4r9sgMsyG0Z9uzsBlgiU/EFKhj/h91/8yHu0edo7XuixOIH3VcJ8kkxs6/jPzoI6U9Vj3WqbMQ94g==",
       "dev": true,
       "license": "MIT",
       "dependencies": {
@@ -3222,7 +3230,6 @@
       "integrity": "sha512-UVJyE9MttOsBQIDKw1skb9nAwQuR5wuGD3+82K6JgJlm/Y+KI92oNsMNGZCYdDsVtRHSak0pcV5Dno5+4jh9sw==",
       "dev": true,
       "license": "MIT",
-      "peer": true,
       "bin": {
         "acorn": "bin/acorn"
       },
@@ -3746,7 +3753,6 @@
         }
       ],
       "license": "MIT",
-      "peer": true,
       "dependencies": {
         "baseline-browser-mapping": "^2.10.12",
         "caniuse-lite": "^1.0.30001782",
@@ -4588,7 +4594,6 @@
       "integrity": "sha512-XoMjdBOwe/esVgEvLmNsD3IRHkm7fbKIUGvrleloJXUZgDHig2IPWNniv+GwjyJXzuNqVjlr5+4yVUZjycJwfQ==",
       "dev": true,
       "license": "MIT",
-      "peer": true,
       "dependencies": {
         "@eslint-community/eslint-utils": "^4.8.0",
         "@eslint-community/regexpp": "^4.12.1",
@@ -4644,13 +4649,13 @@
       }
     },
     "node_modules/eslint-config-next": {
-      "version": "16.2.2",
-      "resolved": "https://registry.npmjs.org/eslint-config-next/-/eslint-config-next-16.2.2.tgz",
-      "integrity": "sha512-6VlvEhwoug2JpVgjZDhyXrJXUEuPY++TddzIpTaIRvlvlXXFgvQUtm3+Zr84IjFm0lXtJt73w19JA08tOaZVwg==",
+      "version": "16.2.7",
+      "resolved": "https://registry.npmjs.org/eslint-config-next/-/eslint-config-next-16.2.7.tgz",
+      "integrity": "sha512-CQ2aNXkrsjaGA2oJBE1LYnlRdphIAQE9ZQfX9hSv1PNGPyiOMSaVeBfTIO29QxYz+ij/hZudK0cfpCG1HXWstg==",
       "dev": true,
       "license": "MIT",
       "dependencies": {
-        "@next/eslint-plugin-next": "16.2.2",
+        "@next/eslint-plugin-next": "16.2.7",
         "eslint-import-resolver-node": "^0.3.6",
         "eslint-import-resolver-typescript": "^3.5.2",
         "eslint-plugin-import": "^2.32.0",
@@ -4774,7 +4779,6 @@
       "integrity": "sha512-whOE1HFo/qJDyX4SnXzP4N6zOWn79WhnCUY/iDR0mPfQZO8wcYE4JClzI2oZrhBnnMUCBCHZhO6VQyoBU95mZA==",
       "dev": true,
       "license": "MIT",
-      "peer": true,
       "dependencies": {
         "@rtsao/scc": "^1.1.0",
         "array-includes": "^3.1.9",
@@ -6502,7 +6506,6 @@
       "integrity": "sha512-Yi1jqNC/Oq0N4hBgNH/YvBpP1P57QqundgytzYqy3yqAa7NZPNjSoi4SGbRAXDMdBzNE6xBCi5U7RgfrvMEUVQ==",
       "dev": true,
       "license": "MIT",
-      "peer": true,
       "dependencies": {
         "@jest/core": "30.4.2",
         "@jest/types": "30.4.1",
@@ -7799,9 +7802,9 @@
       "license": "MIT"
     },
     "node_modules/nanoid": {
-      "version": "3.3.11",
-      "resolved": "https://registry.npmjs.org/nanoid/-/nanoid-3.3.11.tgz",
-      "integrity": "sha512-N8SpfPUnUp1bK+PMYW8qSWdl9U+wwNWI4QKxOYDy9JAro3WMX7p2OeVRF9v+347pnakNevPmiHhNmZ2HbFA76w==",
+      "version": "3.3.12",
+      "resolved": "https://registry.npmjs.org/nanoid/-/nanoid-3.3.12.tgz",
+      "integrity": "sha512-ZB9RH/39qpq5Vu6Y+NmUaFhQR6pp+M2Xt76XBnEwDaGcVAqhlvxrl3B2bKS5D3NH3QR76v3aSrKaF/Kiy7lEtQ==",
       "funding": [
         {
           "type": "github",
@@ -7847,12 +7850,12 @@
       "license": "MIT"
     },
     "node_modules/next": {
-      "version": "16.2.2",
-      "resolved": "https://registry.npmjs.org/next/-/next-16.2.2.tgz",
-      "integrity": "sha512-i6AJdyVa4oQjyvX/6GeER8dpY/xlIV+4NMv/svykcLtURJSy/WzDnnUk/TM4d0uewFHK7xSQz4TbIwPgjky+3A==",
+      "version": "16.2.7",
+      "resolved": "https://registry.npmjs.org/next/-/next-16.2.7.tgz",
+      "integrity": "sha512-eMJxgjRzBaj3olkP4cBamHDXL79A8FC6u1GcsO1D1Tsx8bw/LLXUJCaoajVxtnhD3A1IJqIT8IcRJjgBIPJq4w==",
       "license": "MIT",
       "dependencies": {
-        "@next/env": "16.2.2",
+        "@next/env": "16.2.7",
         "@swc/helpers": "0.5.15",
         "baseline-browser-mapping": "^2.9.19",
         "caniuse-lite": "^1.0.30001579",
@@ -7866,14 +7869,14 @@
         "node": ">=20.9.0"
       },
       "optionalDependencies": {
-        "@next/swc-darwin-arm64": "16.2.2",
-        "@next/swc-darwin-x64": "16.2.2",
-        "@next/swc-linux-arm64-gnu": "16.2.2",
-        "@next/swc-linux-arm64-musl": "16.2.2",
-        "@next/swc-linux-x64-gnu": "16.2.2",
-        "@next/swc-linux-x64-musl": "16.2.2",
-        "@next/swc-win32-arm64-msvc": "16.2.2",
-        "@next/swc-win32-x64-msvc": "16.2.2",
+        "@next/swc-darwin-arm64": "16.2.7",
+        "@next/swc-darwin-x64": "16.2.7",
+        "@next/swc-linux-arm64-gnu": "16.2.7",
+        "@next/swc-linux-arm64-musl": "16.2.7",
+        "@next/swc-linux-x64-gnu": "16.2.7",
+        "@next/swc-linux-x64-musl": "16.2.7",
+        "@next/swc-win32-arm64-msvc": "16.2.7",
+        "@next/swc-win32-x64-msvc": "16.2.7",
         "sharp": "^0.34.5"
       },
       "peerDependencies": {
@@ -8456,9 +8459,9 @@
       }
     },
     "node_modules/postcss": {
-      "version": "8.5.9",
-      "resolved": "https://registry.npmjs.org/postcss/-/postcss-8.5.9.tgz",
-      "integrity": "sha512-7a70Nsot+EMX9fFU3064K/kdHWZqGVY+BADLyXc8Dfv+mTLLVl6JzJpPaCZ2kQL9gIJvKXSLMHhqdRRjwQeFtw==",
+      "version": "8.5.15",
+      "resolved": "https://registry.npmjs.org/postcss/-/postcss-8.5.15.tgz",
+      "integrity": "sha512-FfR8sjd4em2T6fb3I2MwAJU7HWVMr9zba+enmQeeWFfCbm+UOC/0X4DS8XtpUTMwWMGbjKYP7xjfNekzyGmB3A==",
       "dev": true,
       "funding": [
         {
@@ -8476,7 +8479,7 @@
       ],
       "license": "MIT",
       "dependencies": {
-        "nanoid": "^3.3.11",
+        "nanoid": "^3.3.12",
         "picocolors": "^1.1.1",
         "source-map-js": "^1.2.1"
       },
@@ -8563,9 +8566,9 @@
       "license": "MIT"
     },
     "node_modules/qs": {
-      "version": "6.15.1",
-      "resolved": "https://registry.npmjs.org/qs/-/qs-6.15.1.tgz",
-      "integrity": "sha512-6YHEFRL9mfgcAvql/XhwTvf5jKcOiiupt2FiJxHkiX1z4j7WL8J/jRHYLluORvc1XxB5rV20KoeK00gVJamspg==",
+      "version": "6.15.2",
+      "resolved": "https://registry.npmjs.org/qs/-/qs-6.15.2.tgz",
+      "integrity": "sha512-Rzq0KEyX/w/tEybncDgdkZrJgVUsUMk3xjh3t5bv3S1HTAtg+uOYt72+ZfwiQwKdysThkTBdL/rTi6HDmX9Ddw==",
       "license": "BSD-3-Clause",
       "dependencies": {
         "side-channel": "^1.1.0"
@@ -8603,7 +8606,6 @@
       "resolved": "https://registry.npmjs.org/react/-/react-19.2.4.tgz",
       "integrity": "sha512-9nfp2hYpCwOjAN+8TZFGhtWEwgvWHXqESH8qT89AT/lWklpLON22Lc8pEtnpsZz7VmawabSU0gCjnj8aC0euHQ==",
       "license": "MIT",
-      "peer": true,
       "engines": {
         "node": ">=0.10.0"
       }
@@ -8613,7 +8615,6 @@
       "resolved": "https://registry.npmjs.org/react-dom/-/react-dom-19.2.4.tgz",
       "integrity": "sha512-AXJdLo8kgMbimY95O2aKQqsz2iWi9jMgKJhRBAxECE4IFxfcazB2LmzloIoibJI3C12IlY20+KFaLv+71bUJeQ==",
       "license": "MIT",
-      "peer": true,
       "dependencies": {
         "scheduler": "^0.27.0"
       },
@@ -8626,8 +8627,7 @@
       "resolved": "https://registry.npmjs.org/react-is/-/react-is-16.13.1.tgz",
       "integrity": "sha512-24e6ynE2H+OKt4kqsOvNd8kBpV65zoxbA4BVsEOB3ARVWQki/DHzaUoC5KuON/BiccDaCCTZBuOcfZs70kR8bQ==",
       "dev": true,
-      "license": "MIT",
-      "peer": true
+      "license": "MIT"
     },
     "node_modules/react-is-18": {
       "name": "react-is",
@@ -9485,6 +9485,23 @@
         "url": "https://github.com/sponsors/sindresorhus"
       }
     },
+    "node_modules/stripe": {
+      "version": "22.2.0",
+      "resolved": "https://registry.npmjs.org/stripe/-/stripe-22.2.0.tgz",
+      "integrity": "sha512-WFGpMOom9QZqso1kcnSwJsCdC1QHDlMoCOxBZRf3JraMzhkfw7dgSdD2a1CFZrqC+mzAfqeEtYILrZhWKIDruA==",
+      "license": "MIT",
+      "engines": {
+        "node": ">=18"
+      },
+      "peerDependencies": {
+        "@types/node": ">=18"
+      },
+      "peerDependenciesMeta": {
+        "@types/node": {
+          "optional": true
+        }
+      }
+    },
     "node_modules/styled-jsx": {
       "version": "5.1.6",
       "resolved": "https://registry.npmjs.org/styled-jsx/-/styled-jsx-5.1.6.tgz",
@@ -9649,7 +9666,6 @@
       "integrity": "sha512-QP88BAKvMam/3NxH6vj2o21R6MjxZUAd6nlwAS/pnGvN9IVLocLHxGYIzFhg6fUQ+5th6P4dv4eW9jX3DSIj7A==",
       "dev": true,
       "license": "MIT",
-      "peer": true,
       "engines": {
         "node": ">=12"
       },
@@ -9921,7 +9937,6 @@
       "integrity": "sha512-jl1vZzPDinLr9eUt3J/t7V6FgNEw9QjvBPdysz9KfQDD41fQrC2Y4vKQdiaUpFT4bXlb1RHhLpp8wtm6M5TgSw==",
       "dev": true,
       "license": "Apache-2.0",
-      "peer": true,
       "bin": {
         "tsc": "bin/tsc",
         "tsserver": "bin/tsserver"
@@ -10348,9 +10363,9 @@
       }
     },
     "node_modules/ws": {
-      "version": "8.20.0",
-      "resolved": "https://registry.npmjs.org/ws/-/ws-8.20.0.tgz",
-      "integrity": "sha512-sAt8BhgNbzCtgGbt2OxmpuryO63ZoDk/sqaB/znQm94T4fCEsy/yV+7CdC1kJhOU9lboAEU7R3kquuycDoibVA==",
+      "version": "8.21.0",
+      "resolved": "https://registry.npmjs.org/ws/-/ws-8.21.0.tgz",
+      "integrity": "sha512-Vsp28b7DRcimFQvrqu2Wek3z1iYxDCWqHYB8Qsnk/S4RfaCQzPGPyBNuVjJV3cd6UiKtUtp6sNM77gWvzcCH+g==",
       "license": "MIT",
       "engines": {
         "node": ">=10.0.0"
@@ -10478,7 +10493,6 @@
       "integrity": "sha512-rftlrkhHZOcjDwkGlnUtZZkvaPHCsDATp4pGpuOOMDaTdDDXF91wuVDJoWoPsKX/3YPQ5fHuF3STjcYyKr+Qhg==",
       "dev": true,
       "license": "MIT",
-      "peer": true,
       "funding": {
         "url": "https://github.com/sponsors/colinhacks"
       }
diff --git a/package.json b/package.json
index 6be9cb7..aec4af3 100644
--- a/package.json
+++ b/package.json
@@ -11,15 +11,17 @@
     "test:coverage": "jest --coverage"
   },
   "dependencies": {
-    "@google/generative-ai": "^0.24.1",
-    "@supabase/ssr": "^0.10.0",
-    "@supabase/supabase-js": "^2.102.1",
-    "clsx": "^2.1.1",
-    "googleapis": "^171.4.0",
-    "lucide-react": "^1.7.0",
-    "next": "16.2.2",
+    "@google/generative-ai": "0.24.1",
+    "@marsidev/react-turnstile": "^1.5.2",
+    "@supabase/ssr": "0.10.0",
+    "@supabase/supabase-js": "2.102.1",
+    "clsx": "2.1.1",
+    "googleapis": "171.4.0",
+    "lucide-react": "1.7.0",
+    "next": "16.2.7",
     "react": "19.2.4",
-    "react-dom": "19.2.4"
+    "react-dom": "19.2.4",
+    "stripe": "^22.2.0"
   },
   "devDependencies": {
     "@tailwindcss/postcss": "^4",
@@ -28,7 +30,7 @@
     "@types/react": "^19",
     "@types/react-dom": "^19",
     "eslint": "^9",
-    "eslint-config-next": "16.2.2",
+    "eslint-config-next": "16.2.7",
     "jest": "^30.4.2",
     "jest-environment-node": "^30.4.1",
     "tailwindcss": "^4",
diff --git a/src/app/actions/ai-generations.ts b/src/app/actions/ai-generations.ts
index d75471f..a1fb344 100644
--- a/src/app/actions/ai-generations.ts
+++ b/src/app/actions/ai-generations.ts
@@ -36,6 +36,11 @@ export async function approveGeneration(
   if (finalBody?.trim().length > 20) {
     await addStyleSample(supabase, user.id, finalBody, generationId ? { generationId } : {});
     await updateStyleProfile(supabase, user.id);
+  } else {
+    console.warn(
+      "[approveGeneration] style learning skipped — body too short",
+      JSON.stringify({ threadId, generationId: generationId ?? null, bodyLength: finalBody?.trim().length ?? 0 })
+    );
   }
 
   revalidatePath("/inbox");
diff --git a/src/app/api/ai/generate/route.ts b/src/app/api/ai/generate/route.ts
index e943671..5b308da 100644
--- a/src/app/api/ai/generate/route.ts
+++ b/src/app/api/ai/generate/route.ts
@@ -56,12 +56,16 @@ export async function POST(request: Request) {
   const gymName    = gymSettings?.gym_name?.trim()    || "our gym";
   const gymContext = gymSettings?.gym_context?.trim() || "";
 
+  // Wrap each message in an XML tag so adversarial email bodies cannot inject
+  // text that looks like prompt instructions outside the conversation block.
   const conversationContext = (messages || [])
     .slice(-2)
-    .map((m: EmailMessage) =>
-      `${m.direction === "inbound" ? "THEM" : "US"}: ${toPlainText(m.body_text || "").slice(0, 180)}`
-    )
-    .join("\n\n");
+    .map((m: EmailMessage) => {
+      const role = m.direction === "inbound" ? "sender" : "us";
+      const text = toPlainText(m.body_text || "").slice(0, 180);
+      return `<email role="${role}">${text}</email>`;
+    })
+    .join("\n");
 
   const cleanSubject = (subject || "").replace(/^Re:\s*/i, "");
 
@@ -88,9 +92,10 @@ export async function POST(request: Request) {
     : "- Friendly and warm, like a coach";
 
   const prompt = `Write a reply for ${gymName}, a boxing/martial arts gym.
-${gymContext ? `\nReply rules — follow these exactly:\n${gymContext}\n` : ""}${styleSection ? `\n${styleSection}` : ""}Subject: ${subject || "(no subject)"}
-Conversation:
+${gymContext ? `\n<gym_rules>\n${gymContext}\n</gym_rules>\n` : ""}${styleSection ? `\n${styleSection}` : ""}<subject>${subject || "(no subject)"}</subject>
+<conversation>
 ${conversationContext}
+</conversation>
 
 Rules:
 - Under 100 words
@@ -98,7 +103,7 @@ ${toneRule}
 - Include one clear next step or question
 - No markdown, no JSON
 
-Return only the reply body text.`;
+Return only the reply body text. Do not reproduce XML tags in your response.`;
 
   const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
 
diff --git a/src/app/api/gmail/callback/route.ts b/src/app/api/gmail/callback/route.ts
index c15b7dc..f213e84 100644
--- a/src/app/api/gmail/callback/route.ts
+++ b/src/app/api/gmail/callback/route.ts
@@ -1,6 +1,7 @@
 import { NextResponse } from "next/server";
 import { google } from "googleapis";
 import { createClient } from "@/lib/supabase/server";
+import { encryptToken } from "@/lib/token-crypto";
 import type { NextRequest } from "next/server";
 
 export async function GET(request: NextRequest) {
@@ -47,7 +48,7 @@ export async function GET(request: NextRequest) {
     {
       user_id: user.id,
       gmail_email: gmailEmail,
-      gmail_refresh_token: tokens.refresh_token || "",
+      gmail_refresh_token: encryptToken(tokens.refresh_token || ""),
       updated_at: new Date().toISOString(),
     },
     { onConflict: "user_id" }
diff --git a/src/app/api/gmail/send/route.ts b/src/app/api/gmail/send/route.ts
index 1b9ae6e..3589979 100644
--- a/src/app/api/gmail/send/route.ts
+++ b/src/app/api/gmail/send/route.ts
@@ -1,6 +1,7 @@
 import { NextResponse } from "next/server";
 import { google } from "googleapis";
 import { createClient } from "@/lib/supabase/server";
+import { decryptToken } from "@/lib/token-crypto";
 
 export async function POST(request: Request) {
   const supabase = await createClient();
@@ -11,7 +12,12 @@ export async function POST(request: Request) {
 
   // Reject CR/LF in header-bound fields — they would otherwise inject extra
   // headers (Bcc:, Reply-To:, …) into the raw MIME payload below.
-  if (typeof to !== "string" || typeof subject !== "string" || /[\r\n]/.test(to) || /[\r\n]/.test(subject)) {
+  if (
+    typeof to !== "string" ||
+    typeof subject !== "string" ||
+    /[\r\n]/.test(to) ||
+    /[\r\n]/.test(subject)
+  ) {
     return NextResponse.json({ error: "Invalid header value" }, { status: 400 });
   }
 
@@ -25,12 +31,18 @@ export async function POST(request: Request) {
     return NextResponse.json({ error: "Gmail not connected" }, { status: 400 });
   }
 
+  // Defense-in-depth: gmail_email comes from the Google API and is not user
+  // input, but a CRLF here would inject extra MIME headers.
+  if (/[\r\n]/.test(settings.gmail_email ?? "")) {
+    return NextResponse.json({ error: "Invalid sender address" }, { status: 400 });
+  }
+
   const oauth2Client = new google.auth.OAuth2(
     process.env.GOOGLE_CLIENT_ID,
     process.env.GOOGLE_CLIENT_SECRET,
     process.env.GOOGLE_REDIRECT_URI
   );
-  oauth2Client.setCredentials({ refresh_token: settings.gmail_refresh_token });
+  oauth2Client.setCredentials({ refresh_token: decryptToken(settings.gmail_refresh_token) });
   const gmail = google.gmail({ version: "v1", auth: oauth2Client });
 
   const raw = [
@@ -43,44 +55,57 @@ export async function POST(request: Request) {
     body,
   ].join("\r\n");
 
-  const sendRes = await gmail.users.messages.send({
-    userId: "me",
-    requestBody: {
-      raw: Buffer.from(raw).toString("base64url"),
-      threadId: gmailThreadId,
-    },
-  });
+  try {
+    const sendRes = await gmail.users.messages.send({
+      userId: "me",
+      requestBody: {
+        raw: Buffer.from(raw).toString("base64url"),
+        threadId: gmailThreadId,
+      },
+    });
 
-  const sentAt = new Date().toISOString();
+    const sentAt = new Date().toISOString();
 
-  // Persist the sent reply immediately so it shows in the conversation view
-  // without waiting for the next Gmail sync. The real Gmail message id is used
-  // as the conflict key, so the next sync's upsert dedupes against this row
-  // (and may refine body_text from the canonical MIME).
-  const sentMessageId = sendRes.data.id;
-  if (sentMessageId) {
-    await supabase.from("email_messages").upsert(
-      {
-        thread_id: threadId,
-        gmail_message_id: sentMessageId,
-        direction: "outbound",
-        from_email: settings.gmail_email,
-        to_email: to,
-        subject,
-        body_text: body,
-        sent_at: sentAt,
-      },
-      { onConflict: "gmail_message_id" }
-    );
-  }
+    // Persist the sent reply immediately so it shows in the conversation view
+    // without waiting for the next Gmail sync. The real Gmail message id is used
+    // as the conflict key, so the next sync's upsert dedupes against this row
+    // (and may refine body_text from the canonical MIME).
+    const sentMessageId = sendRes.data.id;
+    if (sentMessageId) {
+      await supabase.from("email_messages").upsert(
+        {
+          thread_id: threadId,
+          gmail_message_id: sentMessageId,
+          direction: "outbound",
+          from_email: settings.gmail_email,
+          to_email: to,
+          subject,
+          body_text: body,
+          sent_at: sentAt,
+        },
+        { onConflict: "gmail_message_id" }
+      );
+    }
 
-  // Mark replied and move the thread to the top — the reply is now the latest
-  // message, mirroring Gmail's "active conversation rises" behaviour.
-  await supabase
-    .from("email_threads")
-    .update({ status: "replied", last_message_at: sentAt })
-    .eq("id", threadId)
-    .eq("user_id", user.id);
+    // Mark replied and move the thread to the top — the reply is now the latest
+    // message, mirroring Gmail's "active conversation rises" behaviour.
+    await supabase
+      .from("email_threads")
+      .update({ status: "replied", last_message_at: sentAt })
+      .eq("id", threadId)
+      .eq("user_id", user.id);
 
-  return NextResponse.json({ success: true });
+    return NextResponse.json({ success: true });
+  } catch (err) {
+    const msg = err instanceof Error ? err.message : String(err);
+    const isRevoked = /invalid_grant|token.*revoked|Token has been expired/i.test(msg);
+    console.error("[gmail/send] Gmail API error:", msg);
+    if (isRevoked) {
+      return NextResponse.json(
+        { error: "Gmail access was revoked — reconnect Gmail in Settings to send emails." },
+        { status: 401 }
+      );
+    }
+    return NextResponse.json({ error: "Failed to send email via Gmail." }, { status: 502 });
+  }
 }
diff --git a/src/app/api/gmail/sync/route.ts b/src/app/api/gmail/sync/route.ts
index 07c7fe5..4d6088b 100644
--- a/src/app/api/gmail/sync/route.ts
+++ b/src/app/api/gmail/sync/route.ts
@@ -1,6 +1,7 @@
 import { NextResponse } from "next/server";
 import { google } from "googleapis";
 import { createClient } from "@/lib/supabase/server";
+import { decryptToken } from "@/lib/token-crypto";
 import type { gmail_v1 } from "googleapis";
 
 // ─── MIME helpers ─────────────────────────────────────────────────────────────
@@ -159,13 +160,13 @@ export async function POST() {
     } = await supabase.auth.getUser();
     if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
 
-    const missingEnv: string[] = [];
-    if (!process.env.GOOGLE_CLIENT_ID) missingEnv.push("GOOGLE_CLIENT_ID");
-    if (!process.env.GOOGLE_CLIENT_SECRET) missingEnv.push("GOOGLE_CLIENT_SECRET");
-    if (!process.env.GOOGLE_REDIRECT_URI) missingEnv.push("GOOGLE_REDIRECT_URI");
-    if (missingEnv.length) {
+    if (
+      !process.env.GOOGLE_CLIENT_ID ||
+      !process.env.GOOGLE_CLIENT_SECRET ||
+      !process.env.GOOGLE_REDIRECT_URI
+    ) {
       return NextResponse.json(
-        { error: `Missing env vars: ${missingEnv.join(", ")}` },
+        { error: "Service configuration error" },
         { status: 500 }
       );
     }
@@ -185,7 +186,7 @@ export async function POST() {
       process.env.GOOGLE_CLIENT_SECRET,
       process.env.GOOGLE_REDIRECT_URI
     );
-    oauth2Client.setCredentials({ refresh_token: settings.gmail_refresh_token });
+    oauth2Client.setCredentials({ refresh_token: decryptToken(settings.gmail_refresh_token) });
     const gmail = google.gmail({ version: "v1", auth: oauth2Client });
 
     const threadsResponse = await gmail.users.threads.list({
@@ -358,15 +359,19 @@ export async function POST() {
     const syncedThreadIds = threads.map((t) => t.id).filter((id): id is string => !!id);
     let archived = 0;
     if (syncedThreadIds.length) {
-      const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
-      const idList = `("${syncedThreadIds.join('","')}")`;
-      const { count } = await supabase
-        .from("email_threads")
-        .update({ status: "archived" }, { count: "exact" })
-        .neq("status", "archived")
-        .gte("last_message_at", fourteenDaysAgo)
-        .not("gmail_thread_id", "in", idList);
-      archived = count ?? 0;
+      // Reject any ID that is not a plain hex string (Gmail's documented format)
+      // before interpolating into the PostgREST filter string.
+      const safeIds = syncedThreadIds.filter((id) => /^[0-9a-f]+$/i.test(id));
+      if (safeIds.length) {
+        const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
+        const { count } = await supabase
+          .from("email_threads")
+          .update({ status: "archived" }, { count: "exact" })
+          .neq("status", "archived")
+          .gte("last_message_at", fourteenDaysAgo)
+          .not("gmail_thread_id", "in", `(${safeIds.join(",")})`);
+        archived = count ?? 0;
+      }
     }
 
     await supabase
diff --git a/src/app/api/stripe/checkout/route.ts b/src/app/api/stripe/checkout/route.ts
new file mode 100644
index 0000000..93a5399
--- /dev/null
+++ b/src/app/api/stripe/checkout/route.ts
@@ -0,0 +1,53 @@
+import { NextResponse } from "next/server";
+import Stripe from "stripe";
+import { createClient } from "@/lib/supabase/server";
+
+const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
+
+export async function POST() {
+  const supabase = await createClient();
+  const {
+    data: { user },
+  } = await supabase.auth.getUser();
+
+  if (!user) {
+    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
+  }
+
+  const priceId = process.env.NEXT_PUBLIC_STRIPE_PRICE_ID;
+  if (!priceId) {
+    return NextResponse.json(
+      { error: "Stripe price not configured" },
+      { status: 500 }
+    );
+  }
+
+  // Retrieve existing stripe_customer_id if present.
+  const { data: profile } = await supabase
+    .from("profiles")
+    .select("stripe_customer_id")
+    .eq("id", user.id)
+    .single();
+
+  let customerId = profile?.stripe_customer_id as string | undefined;
+
+  if (!customerId) {
+    const customer = await stripe.customers.create({
+      email: user.email,
+      metadata: { supabase_uid: user.id },
+    });
+    customerId = customer.id;
+  }
+
+  const origin = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
+
+  const session = await stripe.checkout.sessions.create({
+    customer: customerId,
+    mode: "subscription",
+    line_items: [{ price: priceId, quantity: 1 }],
+    success_url: `${origin}/dashboard`,
+    cancel_url: `${origin}/subscribe`,
+  });
+
+  return NextResponse.json({ url: session.url });
+}
diff --git a/src/app/api/stripe/webhook/route.ts b/src/app/api/stripe/webhook/route.ts
new file mode 100644
index 0000000..b0dcdfc
--- /dev/null
+++ b/src/app/api/stripe/webhook/route.ts
@@ -0,0 +1,147 @@
+import { NextRequest, NextResponse } from "next/server";
+import Stripe from "stripe";
+import { createClient } from "@supabase/supabase-js";
+
+const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
+
+// Service role client — only for writing subscription status from webhook.
+function createServiceClient() {
+  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
+  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
+  return createClient(url, key, { auth: { persistSession: false } });
+}
+
+// In Stripe SDK v22+ current_period_end moved from Subscription to SubscriptionItem.
+function getPeriodEnd(subscription: Stripe.Subscription): string | null {
+  const item = subscription.items?.data?.[0];
+  if (!item?.current_period_end) return null;
+  return new Date(item.current_period_end * 1000).toISOString();
+}
+
+export async function POST(request: NextRequest) {
+  const body = await request.text();
+  const sig = request.headers.get("stripe-signature");
+
+  if (!sig) {
+    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
+  }
+
+  let event: Stripe.Event;
+  try {
+    event = stripe.webhooks.constructEvent(
+      body,
+      sig,
+      process.env.STRIPE_WEBHOOK_SECRET!
+    );
+  } catch (err) {
+    console.error("[webhook] signature verification failed:", err);
+    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
+  }
+
+  const supabase = createServiceClient();
+
+  try {
+    switch (event.type) {
+      case "checkout.session.completed": {
+        const session = event.data.object as Stripe.Checkout.Session;
+        if (session.mode !== "subscription") break;
+
+        const customerId = session.customer as string;
+        const subscriptionId = session.subscription as string;
+
+        const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
+          expand: ["items"],
+        });
+        const periodEnd = getPeriodEnd(subscription);
+
+        const { error } = await supabase
+          .from("profiles")
+          .update({
+            stripe_customer_id: customerId,
+            subscription_id: subscriptionId,
+            subscription_status: "active",
+            current_period_end: periodEnd,
+            updated_at: new Date().toISOString(),
+          })
+          .eq("stripe_customer_id", customerId);
+
+        if (error) {
+          // stripe_customer_id may not be set yet on first checkout —
+          // fall back to supabase uid stored in customer metadata.
+          const customer = await stripe.customers.retrieve(customerId);
+          if (customer.deleted) {
+            console.error("[webhook] customer deleted:", customerId);
+            break;
+          }
+          const uid = (customer as Stripe.Customer).metadata?.supabase_uid;
+          if (!uid) {
+            console.error("[webhook] no supabase_uid on customer:", customerId);
+            break;
+          }
+          const { error: err2 } = await supabase
+            .from("profiles")
+            .update({
+              stripe_customer_id: customerId,
+              subscription_id: subscriptionId,
+              subscription_status: "active",
+              current_period_end: periodEnd,
+              updated_at: new Date().toISOString(),
+            })
+            .eq("id", uid);
+          if (err2) {
+            console.error("[webhook] checkout.session.completed update failed:", err2);
+          } else {
+            console.log("[webhook] checkout.session.completed: activated uid", uid);
+          }
+        } else {
+          console.log("[webhook] checkout.session.completed: activated customer", customerId);
+        }
+        break;
+      }
+
+      case "customer.subscription.updated": {
+        const subscription = event.data.object as Stripe.Subscription;
+        const periodEnd = getPeriodEnd(subscription);
+        const { error } = await supabase
+          .from("profiles")
+          .update({
+            subscription_status: subscription.status === "active" ? "active" : "inactive",
+            current_period_end: periodEnd,
+            updated_at: new Date().toISOString(),
+          })
+          .eq("subscription_id", subscription.id);
+        if (error) {
+          console.error("[webhook] customer.subscription.updated failed:", error);
+        } else {
+          console.log("[webhook] customer.subscription.updated:", subscription.id, subscription.status);
+        }
+        break;
+      }
+
+      case "customer.subscription.deleted": {
+        const subscription = event.data.object as Stripe.Subscription;
+        const { error } = await supabase
+          .from("profiles")
+          .update({
+            subscription_status: "inactive",
+            updated_at: new Date().toISOString(),
+          })
+          .eq("subscription_id", subscription.id);
+        if (error) {
+          console.error("[webhook] customer.subscription.deleted failed:", error);
+        } else {
+          console.log("[webhook] customer.subscription.deleted:", subscription.id);
+        }
+        break;
+      }
+
+      default:
+        break;
+    }
+  } catch (err) {
+    console.error("[webhook] handler error for", event.type, err);
+    return NextResponse.json({ error: "Handler error" }, { status: 500 });
+  }
+
+  return NextResponse.json({ received: true });
+}
diff --git a/src/app/inbox/components/EmailHtmlFrame.tsx b/src/app/inbox/components/EmailHtmlFrame.tsx
index 1313c5d..5a24277 100644
--- a/src/app/inbox/components/EmailHtmlFrame.tsx
+++ b/src/app/inbox/components/EmailHtmlFrame.tsx
@@ -14,6 +14,7 @@ function upgradeHttpUrls(html: string): string {
 const BASE_STYLES = `
 <base target="_blank">
 <meta name="color-scheme" content="light">
+<meta http-equiv="Content-Security-Policy" content="default-src * data: blob:; script-src 'unsafe-inline'; connect-src 'none'; object-src 'none'; frame-src 'none';">
 <style>
   img{max-width:100%!important;height:auto}
   table{max-width:100%!important}
diff --git a/src/app/inbox/components/ThreadView.tsx b/src/app/inbox/components/ThreadView.tsx
index 0d83bbe..f6b56ba 100644
--- a/src/app/inbox/components/ThreadView.tsx
+++ b/src/app/inbox/components/ThreadView.tsx
@@ -62,21 +62,41 @@ export function ThreadView({
     if (!draftBody.trim() || !replyTo) return;
     setSending(true);
 
-    await fetch("/api/gmail/send", {
-      method: "POST",
-      headers: { "Content-Type": "application/json" },
-      body: JSON.stringify({
-        threadId: thread.id,
-        gmailThreadId: thread.gmail_thread_id,
-        to: replyTo,
-        subject: generation?.generated_subject || `Re: ${thread.subject}`,
-        body: draftBody,
-      }),
-    });
+    let sendOk = false;
+    let sendErrorMsg: string | null = null;
+    try {
+      const res = await fetch("/api/gmail/send", {
+        method: "POST",
+        headers: { "Content-Type": "application/json" },
+        body: JSON.stringify({
+          threadId: thread.id,
+          gmailThreadId: thread.gmail_thread_id,
+          to: replyTo,
+          subject: generation?.generated_subject || `Re: ${thread.subject}`,
+          body: draftBody,
+        }),
+      });
+      if (res.ok) {
+        sendOk = true;
+      } else {
+        const data = await res.json().catch(() => null);
+        sendErrorMsg =
+          (typeof data?.error === "string" && data.error) ||
+          `Failed to send email (HTTP ${res.status}). Try again.`;
+      }
+    } catch {
+      sendErrorMsg = "Failed to reach the server. Check your connection.";
+    }
+
+    if (!sendOk) {
+      setGenerateError(sendErrorMsg);
+      setSending(false);
+      return;
+    }
 
-    // Record the sent reply for style learning on every send. A generation row
-    // only exists when one was loaded for this thread; pass it when present so
-    // its status is updated, but learning fires either way.
+    // Only record the send and trigger style learning after confirmed delivery.
+    // A generation row only exists when one was loaded for this thread; pass it
+    // when present so its status is updated, but learning fires either way.
     await approveGeneration(draftBody, thread.id, generation?.id ?? null);
 
     setSent(true);
diff --git a/src/app/login/page.tsx b/src/app/login/page.tsx
index 8120512..d697535 100644
--- a/src/app/login/page.tsx
+++ b/src/app/login/page.tsx
@@ -5,12 +5,14 @@ import Link from "next/link";
 import { createClient } from "@/lib/supabase/client";
 import { Button } from "@/components/ui";
 import { Input } from "@/components/ui";
+import { Turnstile } from '@marsidev/react-turnstile'
 
 export default function LoginPage() {
   const [email, setEmail] = useState("");
   const [password, setPassword] = useState("");
   const [loading, setLoading] = useState(false);
   const [error, setError] = useState("");
+  const [turnstileToken, setTurnstileToken] = useState("");
 
   const handleSubmit = async (e: React.FormEvent) => {
     e.preventDefault();
@@ -18,11 +20,15 @@ export default function LoginPage() {
     setError("");
     try {
       const supabase = createClient();
-      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
+      const { error: authError } = await supabase.auth.signInWithPassword({
+        email,
+        password,
+        options: { captchaToken: turnstileToken }
+      });
       if (authError) throw authError;
       window.location.href = "/dashboard";
-    } catch (err) {
-      setError(err instanceof Error ? err.message : "Failed to sign in");
+    } catch {
+      setError("Invalid email or password. Please try again.");
     } finally {
       setLoading(false);
     }
@@ -65,6 +71,10 @@ export default function LoginPage() {
               required
               autoComplete="current-password"
             />
+            <Turnstile
+              siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY!}
+              onSuccess={(token) => setTurnstileToken(token)}
+            />
             <Button type="submit" loading={loading} className="w-full">
               Sign In
             </Button>
@@ -80,4 +90,4 @@ export default function LoginPage() {
       </div>
     </div>
   );
-}
+}
\ No newline at end of file
diff --git a/src/app/signup/page.tsx b/src/app/signup/page.tsx
index 4ae0a0f..fceca03 100644
--- a/src/app/signup/page.tsx
+++ b/src/app/signup/page.tsx
@@ -5,6 +5,7 @@ import Link from "next/link";
 import { createClient } from "@/lib/supabase/client";
 import { Button } from "@/components/ui";
 import { Input } from "@/components/ui";
+import { Turnstile } from '@marsidev/react-turnstile';
 
 export default function SignupPage() {
   const [name, setName] = useState("");
@@ -13,6 +14,7 @@ export default function SignupPage() {
   const [loading, setLoading] = useState(false);
   const [error, setError] = useState("");
   const [done, setDone] = useState(false);
+  const [turnstileToken, setTurnstileToken] = useState("");
 
   const handleSubmit = async (e: React.FormEvent) => {
     e.preventDefault();
@@ -23,12 +25,21 @@ export default function SignupPage() {
       const { error: authError } = await supabase.auth.signUp({
         email,
         password,
-        options: { data: { name } },
+        options: {
+          data: { name },
+          captchaToken: turnstileToken,
+        },
       });
-      if (authError) throw authError;
+      // "User already registered" reveals account existence — always show the
+      // same confirmation screen so the email address cannot be enumerated.
+      if (authError && authError.message !== "User already registered") {
+        throw authError;
+      }
       setDone(true);
     } catch (err) {
-      setError(err instanceof Error ? err.message : "Failed to create account");
+      setError(err instanceof Error && err.message
+        ? "Something went wrong. Please try again."
+        : "Failed to create account");
     } finally {
       setLoading(false);
     }
@@ -99,6 +110,10 @@ export default function SignupPage() {
               autoComplete="new-password"
               hint="At least 8 characters"
             />
+            <Turnstile
+              siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY!}
+              onSuccess={(token) => setTurnstileToken(token)}
+            />
             <Button type="submit" loading={loading} className="w-full">
               Create Account
             </Button>
@@ -114,4 +129,4 @@ export default function SignupPage() {
       </div>
     </div>
   );
-}
+}
\ No newline at end of file
diff --git a/src/app/subscribe/page.tsx b/src/app/subscribe/page.tsx
new file mode 100644
index 0000000..4906066
--- /dev/null
+++ b/src/app/subscribe/page.tsx
@@ -0,0 +1,84 @@
+"use client";
+
+import { useState } from "react";
+import Link from "next/link";
+import { Button } from "@/components/ui";
+
+export default function SubscribePage() {
+  const [loading, setLoading] = useState(false);
+  const [error, setError] = useState("");
+
+  async function handleSubscribe() {
+    setLoading(true);
+    setError("");
+    try {
+      const res = await fetch("/api/stripe/checkout", { method: "POST" });
+      const data = await res.json();
+      if (!res.ok) throw new Error(data.error ?? "Checkout failed");
+      window.location.href = data.url;
+    } catch (err) {
+      setError(err instanceof Error ? err.message : "Something went wrong");
+      setLoading(false);
+    }
+  }
+
+  return (
+    <div className="min-h-screen flex items-center justify-center px-4 bg-surface-50">
+      <div className="w-full max-w-md">
+        <div className="text-center mb-8">
+          <Link href="/" className="inline-flex items-center gap-2 mb-6">
+            <div className="w-8 h-8 rounded-lg gradient-brand flex items-center justify-center">
+              <span className="text-white font-bold text-sm">R</span>
+            </div>
+            <span className="text-lg font-bold text-surface-900">ReplyPilot</span>
+          </Link>
+          <h1 className="text-2xl font-bold text-surface-900">
+            Subscribe to ReplyPilot
+          </h1>
+          <p className="text-surface-500 mt-2 text-sm">
+            Your subscription is required to access the app.
+          </p>
+        </div>
+
+        <div className="bg-white rounded-2xl border border-surface-200 shadow-soft-sm p-8 space-y-6">
+          <ul className="space-y-3 text-sm text-surface-700">
+            <li className="flex items-start gap-2">
+              <span className="text-brand-500 font-bold mt-0.5">✓</span>
+              AI-powered email reply drafts tailored to your style
+            </li>
+            <li className="flex items-start gap-2">
+              <span className="text-brand-500 font-bold mt-0.5">✓</span>
+              Automated follow-up scheduling for leads and members
+            </li>
+            <li className="flex items-start gap-2">
+              <span className="text-brand-500 font-bold mt-0.5">✓</span>
+              Gmail inbox sync with smart contact tracking
+            </li>
+            <li className="flex items-start gap-2">
+              <span className="text-brand-500 font-bold mt-0.5">✓</span>
+              Unlimited drafts and replies every month
+            </li>
+          </ul>
+
+          {error && (
+            <div className="p-3 bg-danger-50 border border-danger-200 rounded-xl text-sm text-danger-700">
+              {error}
+            </div>
+          )}
+
+          <Button
+            onClick={handleSubscribe}
+            disabled={loading}
+            className="w-full"
+          >
+            {loading ? "Redirecting to checkout…" : "Subscribe — monthly billing"}
+          </Button>
+
+          <p className="text-xs text-center text-surface-400">
+            Payments are handled securely by Stripe. Cancel any time.
+          </p>
+        </div>
+      </div>
+    </div>
+  );
+}
diff --git a/src/lib/subscription.ts b/src/lib/subscription.ts
new file mode 100644
index 0000000..347c2ad
--- /dev/null
+++ b/src/lib/subscription.ts
@@ -0,0 +1,24 @@
+import { createClient } from "@/lib/supabase/server";
+
+export async function getUserSubscriptionStatus(
+  userId: string
+): Promise<{ active: boolean; currentPeriodEnd: Date | null }> {
+  const supabase = await createClient();
+
+  const { data } = await supabase
+    .from("profiles")
+    .select("subscription_status, current_period_end")
+    .eq("id", userId)
+    .single();
+
+  if (!data) {
+    return { active: false, currentPeriodEnd: null };
+  }
+
+  return {
+    active: data.subscription_status === "active",
+    currentPeriodEnd: data.current_period_end
+      ? new Date(data.current_period_end)
+      : null,
+  };
+}
diff --git a/src/lib/supabase/server.ts b/src/lib/supabase/server.ts
index 5e1c8b7..ce777b8 100644
--- a/src/lib/supabase/server.ts
+++ b/src/lib/supabase/server.ts
@@ -17,6 +17,9 @@ export async function createClient() {
     process.env.NEXT_PUBLIC_SUPABASE_URL!,
     process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
     {
+      cookieOptions: {
+        secure: process.env.NODE_ENV === "production",
+      },
       cookies: {
         getAll() {
           return cookieStore.getAll();
diff --git a/src/lib/token-crypto.ts b/src/lib/token-crypto.ts
new file mode 100644
index 0000000..54dea1f
--- /dev/null
+++ b/src/lib/token-crypto.ts
@@ -0,0 +1,57 @@
+import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
+
+// AES-256-GCM: authenticated encryption that protects both confidentiality
+// and integrity. 96-bit IV is the NIST-recommended size for GCM.
+const ALGORITHM = "aes-256-gcm";
+const ENCRYPTED_PREFIX = "enc:v1:";
+
+function getKey(): Buffer {
+  const raw = process.env.GMAIL_TOKEN_ENCRYPTION_KEY;
+  if (!raw) {
+    throw new Error(
+      "GMAIL_TOKEN_ENCRYPTION_KEY env var is not set. " +
+      "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
+    );
+  }
+  const key = Buffer.from(raw, "hex");
+  if (key.length !== 32) {
+    throw new Error(
+      "GMAIL_TOKEN_ENCRYPTION_KEY must be exactly 32 bytes (64 hex characters)"
+    );
+  }
+  return key;
+}
+
+export function encryptToken(plaintext: string): string {
+  const key = getKey();
+  const iv = randomBytes(12); // 96-bit IV — standard for GCM
+  const cipher = createCipheriv(ALGORITHM, key, iv);
+  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
+  const authTag = cipher.getAuthTag();
+  return (
+    ENCRYPTED_PREFIX +
+    [iv, authTag, encrypted].map((b) => b.toString("hex")).join(".")
+  );
+}
+
+// Returns the plaintext token. If the stored value was written before
+// encryption was introduced (no "enc:v1:" prefix), it is returned as-is
+// so existing connections continue to work until the user re-connects Gmail.
+export function decryptToken(stored: string): string {
+  if (!stored.startsWith(ENCRYPTED_PREFIX)) {
+    return stored; // legacy plaintext — will be re-encrypted on next OAuth callback
+  }
+  const key = getKey();
+  const body = stored.slice(ENCRYPTED_PREFIX.length);
+  const parts = body.split(".");
+  if (parts.length !== 3) {
+    throw new Error("Malformed encrypted token");
+  }
+  const [ivHex, authTagHex, ciphertextHex] = parts;
+  const iv = Buffer.from(ivHex, "hex");
+  const authTag = Buffer.from(authTagHex, "hex");
+  const ciphertext = Buffer.from(ciphertextHex, "hex");
+  const decipher = createDecipheriv(ALGORITHM, key, iv);
+  decipher.setAuthTag(authTag);
+  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
+}
diff --git a/src/lib/usage-limits.ts b/src/lib/usage-limits.ts
index 8fdd6f9..c4e5521 100644
--- a/src/lib/usage-limits.ts
+++ b/src/lib/usage-limits.ts
@@ -46,7 +46,12 @@ export async function enforceDailyLimit(
   });
 
   if (error) {
-    console.error("[usage-limits] increment_usage failed — failing open:", error.message);
+    // Structured so this line is grep-able and distinguishable from one-off noise.
+    // A persistent stream of these means the usage_counters table/RPC is broken.
+    console.error(
+      "[usage-limits] increment_usage failed — failing open",
+      JSON.stringify({ kind, limit, ts: new Date().toISOString(), error: error.message })
+    );
     return { allowed: true, newCount: 0, limit };
   }
 
diff --git a/src/lib/user-context.tsx b/src/lib/user-context.tsx
index c067ba0..acfdede 100644
--- a/src/lib/user-context.tsx
+++ b/src/lib/user-context.tsx
@@ -44,7 +44,15 @@ export function UserProvider({ children }: { children: React.ReactNode }) {
   }, []); // eslint-disable-line react-hooks/exhaustive-deps
 
   const signOut = useCallback(async () => {
-    if (supabase) await supabase.auth.signOut();
+    if (supabase) {
+      try {
+        await supabase.auth.signOut();
+      } catch {
+        // Proceed with local navigation even if the server-side revocation
+        // call fails. The middleware will catch any lingering session on the
+        // next protected request.
+      }
+    }
     window.location.href = "/";
   }, [supabase]); // eslint-disable-line react-hooks/exhaustive-deps
 
diff --git a/supabase/schema.sql b/supabase/schema.sql
index b855262..6e277e8 100644
--- a/supabase/schema.sql
+++ b/supabase/schema.sql
@@ -172,6 +172,42 @@ create policy "users own their activity_logs"
   using (auth.uid() = user_id)
   with check (auth.uid() = user_id);
 
+-- ============================================================
+-- Profiles (subscription tracking, one row per user)
+-- ============================================================
+
+create table if not exists profiles (
+  id                    uuid primary key references auth.users on delete cascade,
+  stripe_customer_id    text,
+  subscription_status   text not null default 'inactive',
+  subscription_id       text,
+  current_period_end    timestamptz,
+  created_at            timestamptz default now(),
+  updated_at            timestamptz default now()
+);
+
+alter table profiles enable row level security;
+create policy "users read own profile"
+  on profiles for select
+  using (auth.uid() = id);
+-- Inserts and updates are done via service role in the webhook handler only.
+
+-- Auto-create a profile row when a new user signs up.
+create or replace function handle_new_user()
+returns trigger language plpgsql security definer as $$
+begin
+  insert into public.profiles (id)
+  values (new.id)
+  on conflict (id) do nothing;
+  return new;
+end;
+$$;
+
+drop trigger if exists on_auth_user_created on auth.users;
+create trigger on_auth_user_created
+  after insert on auth.users
+  for each row execute procedure handle_new_user();
+
 -- ============================================================
 -- Seed system templates
 -- ============================================================

commit a9c040a7b3fbc4d53c5f22fbb772805d5d670058
Author: Martin Lam <martinlam16061@gmail.com>
Date:   Thu Jun 4 12:11:04 2026 -0700

    oswap 1

diff --git a/KNOWLEDGE_TRANSFER.md b/KNOWLEDGE_TRANSFER.md
index a74595b..0a7625a 100644
--- a/KNOWLEDGE_TRANSFER.md
+++ b/KNOWLEDGE_TRANSFER.md
@@ -4,7 +4,7 @@
 > **Scope:** Documents the system *as it currently exists*. No improvements are suggested.
 > **Method:** Every non-obvious claim cites the file(s) it came from. Confidence is labelled **[High]**, **[Medium]**, or **[Low]**. Where something cannot be determined from the code, it says so explicitly.
 > **Generated from:** a full read of `src/`, `supabase/`, root config, and the build manifest.
-> **Last revised:** 2026-06-02, after the "fix reply thread and text settings" change set — reflects the inbox component split, incremental Gmail sync, feedback-weighted style retrieval, style-example management, removal of the duplicate middleware, and pruning of unused deps/components.
+> **Last revised:** 2026-06-04, after the **Stripe subscription / billing** change set. This revision adds the payments subsystem (Stripe Checkout + webhook), **subscription gating in middleware**, the new `profiles` table and its auto-create trigger, **AES-256-GCM encryption of Gmail refresh tokens at rest** (`token-crypto.ts`), **Cloudflare Turnstile** captcha on login/signup, and the **first use of the Supabase service-role key** (in the Stripe webhook). The earlier 2026-06-02 baseline (inbox component split, incremental Gmail sync, feedback-weighted style retrieval, style-example management, single middleware, dep pruning) is retained and still accurate.
 
 ---
 
@@ -39,7 +39,7 @@
 
 **The core problem it solves.** A gym owner spends a lot of time answering repetitive lead and member emails. ReplyPilot reduces each reply to: read the thread → click "Suggest a Reply" → lightly edit → send. The reply already obeys the gym's rules and matches the owner's tone, so it needs minimal editing.
 
-**Who the users are.** Gym owners/coaches. The README states it was "Built for a gym with 2 locations" ([README.md:7](README.md#L7)), and the usage-limit defaults are explicitly "sized for a single trusted client" ([src/lib/usage-limits.ts:12-18](src/lib/usage-limits.ts#L12-L18)). **[High]** This is effectively a single-tenant / small-tenant product today, even though the auth and data model are per-user and could support more.
+**Who the users are.** Gym owners/coaches. The README states it was "Built for a gym with 2 locations" ([README.md:7](README.md#L7)), and the usage-limit defaults are explicitly "sized for a single trusted client" ([src/lib/usage-limits.ts:12-18](src/lib/usage-limits.ts#L12-L18)). **[High]** The data model and auth are per-user, and the product now has the scaffolding of a **paid multi-tenant SaaS**: open self-serve signup (with a Cloudflare Turnstile captcha), a **Stripe subscription paywall** that gates every app page, and a per-user `profiles` table tracking subscription state. So while the *operational* footprint may still be small, the code is no longer single-tenant-by-construction — anyone can sign up, but **no one reaches the app without an active subscription** ([middleware.ts:96-114](middleware.ts#L96-L114)). **[High]**
 
 **Major features.**
 1. **Gmail sync** — pull last-14-day Primary-category inbox threads ([src/app/api/gmail/sync/route.ts](src/app/api/gmail/sync/route.ts)).
@@ -48,10 +48,11 @@
 4. **Send replies** — via Gmail API in the original thread ([src/app/api/gmail/send/route.ts](src/app/api/gmail/send/route.ts)).
 5. **Contacts CRM** — auto-created from senders; lead/trial/member/inactive ([src/app/contacts/page.tsx](src/app/contacts/page.tsx)).
 6. **Settings** — gym rules, Gmail connection, manual style examples ([src/app/settings/page.tsx](src/app/settings/page.tsx)).
-7. **Auth** — email/password via Supabase ([src/app/login/page.tsx](src/app/login/page.tsx), [src/app/signup/page.tsx](src/app/signup/page.tsx)).
+7. **Auth** — email/password via Supabase, protected by a Cloudflare Turnstile captcha ([src/app/login/page.tsx](src/app/login/page.tsx), [src/app/signup/page.tsx](src/app/signup/page.tsx)).
 8. **Daily usage caps** — soft per-user limits on billed AI endpoints ([src/lib/usage-limits.ts](src/lib/usage-limits.ts)).
+9. **Subscription billing / paywall** — Stripe Checkout subscription, a webhook that records status into `profiles`, and a middleware gate that redirects un-subscribed users to `/subscribe` ([src/app/api/stripe/](src/app/api/stripe/), [middleware.ts](middleware.ts), [src/app/subscribe/page.tsx](src/app/subscribe/page.tsx)).
 
-**Overall architecture style.** A **single Next.js 16 App Router application** that is its own frontend *and* backend. The "backend" is split between **Server Actions** (first-party CRUD) and **Route Handlers** (external integrations + HTTP endpoints). **Supabase Postgres** is the database, with **Row-Level Security (RLS) as the authorization boundary**. **Google Gemini** (generation + embeddings) and the **Gmail API** are the external services. Deployed on **Vercel**. It is a feature-based, layered monolith — there is no separate API server or microservices. **[High]**
+**Overall architecture style.** A **single Next.js 16 App Router application** that is its own frontend *and* backend. The "backend" is split between **Server Actions** (first-party CRUD) and **Route Handlers** (external integrations + HTTP endpoints). **Supabase Postgres** is the database, with **Row-Level Security (RLS) as the authorization boundary** — with one deliberate exception: the Stripe webhook uses the **service-role key** (which bypasses RLS) to write subscription state, because it runs with no user session. **Google Gemini** (generation + embeddings), the **Gmail API**, **Stripe** (billing), and **Cloudflare Turnstile** (captcha) are the external services. Deployed on **Vercel**. It is a feature-based, layered monolith — there is no separate API server or microservices. **[High]**
 
 **Day-one mental model for a new engineer:** "A Next.js app where pages are thin clients that call Server Actions for CRUD and `fetch()` API routes for AI/Gmail. Security is enforced in the database (RLS), not in app code. The clever part is `style-memory.ts`."
 
@@ -70,8 +71,9 @@ Source for all versions: [package.json](package.json).
 | **Tailwind CSS 4** | Utility-first styling | All components; tokens in [tailwind.config.ts](tailwind.config.ts), [src/app/globals.css](src/app/globals.css) | Styling via class names; custom `brand`/`surface`/`success` color scales |
 | **lucide-react** | Icon set | Navbar, pages, buttons | SVG icons |
 | **clsx** (via `cn()`) | Conditional class merging | [src/lib/utils.ts](src/lib/utils.ts#L3) | Compose Tailwind class strings |
+| **@marsidev/react-turnstile** | Cloudflare Turnstile widget | [login](src/app/login/page.tsx#L8), [signup](src/app/signup/page.tsx#L8) | Renders the captcha; token passed to Supabase `signUp`/`signInWithPassword` as `captchaToken` |
 
-> The runtime dependency list is now lean (9 packages — see [package.json](package.json)): `@google/generative-ai`, `@supabase/ssr`, `@supabase/supabase-js`, `clsx`, `googleapis`, `lucide-react`, `next`, `react`, `react-dom`. Earlier leftovers `framer-motion` and `recharts` were **removed** (commit `99a72c7`); no unused runtime deps remain. **[High]**
+> The runtime dependency list is 11 packages (see [package.json](package.json)): `@google/generative-ai`, `@marsidev/react-turnstile`, `@supabase/ssr`, `@supabase/supabase-js`, `clsx`, `googleapis`, `lucide-react`, `next`, `react`, `react-dom`, `stripe`. The earlier leftovers `framer-motion`/`recharts` were removed (commit `99a72c7`); `stripe` and `@marsidev/react-turnstile` were **added** in the billing/captcha work. Token encryption uses Node's built-in `crypto` (no dependency). **[High]**
 
 ### Backend (within Next.js)
 | Tech | Why | Where | Responsibility |
@@ -91,7 +93,8 @@ Source for all versions: [package.json](package.json).
 | Tech | Why | Where | Responsibility |
 |---|---|---|---|
 | **Supabase Auth** | Email/password identity | [src/lib/supabase/](src/lib/supabase/), middleware, login/signup pages | User identity, cookie sessions, `auth.uid()` for RLS |
-| **Google OAuth 2.0** (separate) | Gmail access | [src/app/api/gmail/auth/route.ts](src/app/api/gmail/auth/route.ts), [callback](src/app/api/gmail/callback/route.ts) | Obtain Gmail refresh token (read/send/modify scopes) |
+| **Cloudflare Turnstile** | Bot/abuse protection on auth | [login](src/app/login/page.tsx), [signup](src/app/signup/page.tsx) | Client widget yields a token; **verification happens inside Supabase Auth** (configured server-side in the Supabase project), not in app code |
+| **Google OAuth 2.0** (separate) | Gmail access | [src/app/api/gmail/auth/route.ts](src/app/api/gmail/auth/route.ts), [callback](src/app/api/gmail/callback/route.ts) | Obtain Gmail refresh token (read/send/modify scopes); token **encrypted at rest** via [token-crypto.ts](src/lib/token-crypto.ts) |
 
 ### State management
 | Tech | Why | Where | Responsibility |
@@ -108,6 +111,8 @@ Source for all versions: [package.json](package.json).
 ### Third-party services
 - **Google Gemini** — `gemini-2.5-flash-lite` (generation) and `gemini-embedding-001` (embeddings). [src/app/api/ai/generate/route.ts:103](src/app/api/ai/generate/route.ts#L103), [src/lib/style-memory.ts:171](src/lib/style-memory.ts#L171).
 - **Gmail API** (`googleapis`) — read threads, send messages.
+- **Stripe** (`stripe`) — subscription Checkout sessions ([api/stripe/checkout](src/app/api/stripe/checkout/route.ts)) and event webhook ([api/stripe/webhook](src/app/api/stripe/webhook/route.ts)). Uses the default API version pinned by the installed `stripe@^22` SDK (no explicit `apiVersion` passed).
+- **Cloudflare Turnstile** — captcha on login/signup, verified by Supabase Auth.
 
 ### Build tools
 - **Next.js build** (`next build`/`next dev`) — uses **Turbopack** in dev (visible in build chunk names in [.next/dev/server/middleware-manifest.json](.next/dev/server/middleware-manifest.json)). **[High]**
@@ -129,7 +134,8 @@ ReplyPilot/
 ├── src/
 │   ├── app/                  ← App Router: pages + API + actions
 │   │   ├── actions/          ← Server Actions (first-party CRUD)
-│   │   ├── api/              ← Route Handlers (external + HTTP)
+│   │   ├── api/              ← Route Handlers (external + HTTP): gmail/, ai/, style/, stripe/
+│   │   ├── subscribe/        ← Paywall page (Stripe Checkout launch)
 │   │   ├── auth/callback/    ← Supabase code-exchange handler
 │   │   ├── inbox/            ← page.tsx (orchestrator) + components/ + utils.ts
 │   │   │   └── components/   ← ThreadView, MessageBubble, EmailHtmlFrame, ReplyPanel, StyleFeedback
@@ -144,6 +150,8 @@ ReplyPilot/
 │       ├── supabase/         ← Supabase client factories
 │       ├── style-memory.ts   ← Style-learning engine (the core IP)
 │       ├── usage-limits.ts   ← Daily caps
+│       ├── subscription.ts   ← Read a user's subscription status from profiles
+│       ├── token-crypto.ts   ← AES-256-GCM encrypt/decrypt of Gmail refresh tokens
 │       ├── user-context.tsx  ← Auth context
 │       ├── types.ts          ← Shared types
 │       └── utils.ts          ← cn(), formatDate()
@@ -171,8 +179,8 @@ ReplyPilot/
 
 ### `src/app/api/` — Route Handlers
 - **Purpose:** Endpoints needing HTTP semantics or external SDKs.
-- **Subfolders:** `gmail/` (auth, callback, sync, send), `ai/generate`, `style/` (add-sample, backfill, feedback, status, **samples** — list/delete examples), and `style/__tests__/`.
-- **Interactions:** Called via `fetch()` from pages; call Gemini/Gmail/Supabase and `lib/`.
+- **Subfolders:** `gmail/` (auth, callback, sync, send), `ai/generate`, `style/` (add-sample, backfill, feedback, status, **samples** — list/delete examples) + `style/__tests__/`, and **`stripe/`** (`checkout` — creates a Checkout session; `webhook` — applies Stripe events to `profiles` using the service-role client).
+- **Interactions:** Called via `fetch()` from pages (or by Stripe, for the webhook); call Gemini/Gmail/Stripe/Supabase and `lib/`.
 
 ### `src/app/auth/callback/`
 - **Purpose:** Supabase OAuth/email-confirm code exchange ([route.ts](src/app/auth/callback/route.ts)). Distinct from Gmail callback.
@@ -189,8 +197,8 @@ ReplyPilot/
 - **Dependencies:** `user-context` (for `useUser`/`signOut`), `ui/Button`.
 
 ### `src/lib/` — domain + infra
-- **Purpose:** Non-UI logic. **Files:** [style-memory.ts](src/lib/style-memory.ts) (core), [usage-limits.ts](src/lib/usage-limits.ts), [user-context.tsx](src/lib/user-context.tsx), [types.ts](src/lib/types.ts), [utils.ts](src/lib/utils.ts), and [supabase/](src/lib/supabase/).
-- **`lib/supabase/`:** [client.ts](src/lib/supabase/client.ts) (browser singleton), [server.ts](src/lib/supabase/server.ts) (per-request, cookie-bound).
+- **Purpose:** Non-UI logic. **Files:** [style-memory.ts](src/lib/style-memory.ts) (core), [usage-limits.ts](src/lib/usage-limits.ts), [subscription.ts](src/lib/subscription.ts) (reads `profiles.subscription_status`), [token-crypto.ts](src/lib/token-crypto.ts) (AES-256-GCM for Gmail tokens), [user-context.tsx](src/lib/user-context.tsx), [types.ts](src/lib/types.ts), [utils.ts](src/lib/utils.ts), and [supabase/](src/lib/supabase/).
+- **`lib/supabase/`:** [client.ts](src/lib/supabase/client.ts) (browser singleton), [server.ts](src/lib/supabase/server.ts) (per-request, cookie-bound). Note: the Stripe webhook constructs its **own** service-role client directly (not via these factories) so it can bypass RLS without a session ([api/stripe/webhook/route.ts:7-11](src/app/api/stripe/webhook/route.ts#L7-L11)).
 
 ### `supabase/` — database definition
 - **Purpose:** Source of truth for schema, RLS policies, and RPCs (not auto-applied; run manually per [README.md:73-79](README.md#L73-L79)). **Files:** [schema.sql](supabase/schema.sql) (core tables + seed templates), [style-memory-schema.sql](supabase/style-memory-schema.sql) (pgvector tables + RPCs), [usage-limits-schema.sql](supabase/usage-limits-schema.sql) (counters + `increment_usage`).
@@ -213,11 +221,13 @@ Feature-based, layered **Next.js monolith**. Layers:
 3. **Service/Action** — Server Actions ([src/app/actions/](src/app/actions/)) and the domain library ([src/lib/](src/lib/)).
 4. **API** — Route Handlers ([src/app/api/](src/app/api/)).
 5. **Data** — Supabase Postgres (RLS) + RPCs.
-6. **External** — Gemini, Gmail.
-7. **Cross-cutting** — Middleware (auth + CSP), `next.config.ts` headers.
+6. **External** — Gemini, Gmail, Stripe, Cloudflare Turnstile.
+7. **Cross-cutting** — Middleware (auth + **subscription gate** + CSP), `next.config.ts` headers.
 
 ### Separation of concerns
 - **Authorization lives in the database** (RLS), not in app code. [AGENTS.md](AGENTS.md) explicitly forbids redundant `.eq("user_id", …)` filters because RLS already scopes the anon-key client. **[High]** (In practice many call sites still add them — see §18.)
+- **One sanctioned RLS bypass: the Stripe webhook.** It has no user session (Stripe calls it server-to-server), so it uses the **service-role key** to write `profiles`. This is the single place RLS is bypassed, and per [AGENTS.md](AGENTS.md) it is exactly the kind of code that "needs review." Its safety rests on Stripe **signature verification** ([webhook:29-37](src/app/api/stripe/webhook/route.ts#L29-L37)) and on only ever writing the `profiles` row matched by `supabase_uid`/`stripe_customer_id`/`subscription_id`.
+- **Access control has two layers now:** RLS (data ownership) *and* a **subscription gate** in middleware (un-subscribed authenticated users are bounced from app pages to `/subscribe`).
 - **Output validation lives at the sink**, not in middleware — e.g. CRLF header-injection checks happen inside the Gmail send route ([src/app/api/gmail/send/route.ts:14-16](src/app/api/gmail/send/route.ts#L14-L16)), per [AGENTS.md](AGENTS.md).
 - **Untrusted email HTML containment lives in an iframe sandbox** ([src/app/inbox/components/EmailHtmlFrame.tsx](src/app/inbox/components/EmailHtmlFrame.tsx)); the regex sanitizer is defence-in-depth only.
 
@@ -289,9 +299,22 @@ This traces a fresh page load (e.g. a logged-out user visiting `/inbox`). **[Hig
    - Sets `x-nonce` + `Content-Security-Policy` on the request headers so Next can apply the nonce to its own scripts ([middleware.ts:29-31](middleware.ts#L29-L31)).
    - Creates a server Supabase client bound to request cookies and calls `auth.getUser()` ([middleware.ts:42-61](middleware.ts#L42-L61)).
 
-2. **Route guard.** `protectedRoutes = ["/dashboard", "/inbox", "/contacts", "/settings"]` and `authRoutes = ["/login", "/signup"]` ([middleware.ts:4-5](middleware.ts#L4-L5)). If no user and path is protected → redirect to `/login?redirect=…`. If logged-in and on an auth route → redirect to `/dashboard`. The list now matches the actual app pages (the previous stale `/assessment`/`/reports` entries and the missing `/inbox`/`/contacts` were corrected in commit `6c27e79`).
-
-3. **Configuration loading.** Env vars are read at request time inside middleware, the Supabase factories ([src/lib/supabase/server.ts:5-12](src/lib/supabase/server.ts#L5-L12), [client.ts:7-15](src/lib/supabase/client.ts#L7-L15)), and the integration routes (Google creds checked in [sync/route.ts:139-148](src/app/api/gmail/sync/route.ts#L139-L148)). There is no central config module. **[High]** Required vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `GEMINI_API_KEY` ([README.md:64-68](README.md#L64-L68)), plus `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REDIRECT_URI` and optionally `NEXT_PUBLIC_APP_URL` (used in [gmail/auth/route.ts:10](src/app/api/gmail/auth/route.ts#L10)).
+2. **Route guard (now three checks).** `protectedRoutes = ["/dashboard", "/inbox", "/contacts", "/settings"]`, `authRoutes = ["/login", "/signup"]`, and `subscriptionExemptRoutes = ["/subscribe"]` ([middleware.ts:4-7](middleware.ts#L4-L7)). Order of decisions:
+   - **Webhook bypass first:** `POST /api/stripe/webhook` returns immediately with no auth logic, because Stripe sends no session cookie ([middleware.ts:65-70](middleware.ts#L65-L70)).
+   - **Not logged in** + on a protected *or* `/subscribe` route → redirect to `/login?redirect=…` ([middleware.ts:83-94](middleware.ts#L83-L94)).
+   - **Logged in + protected route → subscription gate:** middleware reads `profiles.subscription_status` for the user; if it is not `"active"`, redirect to `/subscribe` ([middleware.ts:96-114](middleware.ts#L96-L114)). This is an **extra DB round-trip on every protected request**.
+   - **Logged in + on an auth route** → redirect to `/dashboard`.
+   - The protected list matches the actual app pages (the previous stale `/assessment`/`/reports` entries and the missing `/inbox`/`/contacts` were corrected in commit `6c27e79`).
+
+3. **Configuration loading.** Env vars are read at request time inside middleware, the Supabase factories ([src/lib/supabase/server.ts:5-12](src/lib/supabase/server.ts#L5-L12), [client.ts:7-15](src/lib/supabase/client.ts#L7-L15)), and the integration routes. There is no central config module. **[High]** The full set of env vars referenced in code (`grep process.env`):
+   - **Supabase:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (webhook only).
+   - **Gemini:** `GEMINI_API_KEY`.
+   - **Google/Gmail OAuth:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`.
+   - **Stripe:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PRICE_ID`.
+   - **Token encryption:** `GMAIL_TOKEN_ENCRYPTION_KEY` (32-byte hex; required by [token-crypto.ts](src/lib/token-crypto.ts#L8-L23) whenever a Gmail token is read/written).
+   - **Captcha:** `NEXT_PUBLIC_TURNSTILE_SITE_KEY`.
+   - **App URL:** `NEXT_PUBLIC_APP_URL` (Checkout success/cancel URLs + Gmail auth; falls back to `http://localhost:3000`).
+   - `NODE_ENV` (dev-only CSP `'unsafe-eval'`, secure-cookie toggle).
 
 4. **Root layout renders.** [src/app/layout.tsx](src/app/layout.tsx) is an async server component. It calls `await connection()` ([layout.tsx:17](src/app/layout.tsx#L17)) — a Next.js API that opts the render into dynamic/request-time rendering. **[Medium]** (purpose: ensure per-request behaviour, likely so the nonce/session are fresh). It injects Google Fonts and renders `<ClientLayout>`.
 
@@ -313,19 +336,21 @@ This traces a fresh page load (e.g. a logged-out user visiting `/inbox`). **[Hig
 Format: **User Action → UI Component → Handler → State → API/Action → Backend → DB → Response → UI**.
 
 ### Journey A — Sign up
-- **Action:** fill form, submit. **Component:** [signup/page.tsx](src/app/signup/page.tsx).
-- **Handler:** `handleSubmit` → `createClient().auth.signUp({ email, password, options:{ data:{ name } } })` ([signup/page.tsx:17-35](src/app/signup/page.tsx#L17-L35)).
-- **Backend/DB:** Supabase Auth creates the user; `name` stored in `user_metadata`.
-- **Response/UI:** sets `done=true` → "Check your email" confirmation screen ([signup/page.tsx:37-54](src/app/signup/page.tsx#L37-L54)). Email confirmation link → [auth/callback/route.ts](src/app/auth/callback/route.ts) `exchangeCodeForSession` → redirect to `/dashboard`.
+- **Action:** fill form, complete the **Turnstile captcha**, submit. **Component:** [signup/page.tsx](src/app/signup/page.tsx). The `<Turnstile>` widget's `onSuccess` stores a token in state ([signup:113-116](src/app/signup/page.tsx#L113-L116)).
+- **Handler:** `handleSubmit` → `auth.signUp({ email, password, options:{ data:{ name }, captchaToken } })` ([signup:25-32](src/app/signup/page.tsx#L25-L32)). Supabase verifies the captcha token server-side (Turnstile must be enabled in the Supabase project).
+- **Backend/DB:** Supabase Auth creates the user (`name` → `user_metadata`); the `on_auth_user_created` trigger auto-inserts a `profiles` row with `subscription_status='inactive'` ([schema.sql:195-209](supabase/schema.sql#L195-L209)).
+- **Anti-enumeration:** a `"User already registered"` error is swallowed and the same "Check your email" screen is shown, so an attacker cannot probe which emails have accounts ([signup:33-38](src/app/signup/page.tsx#L33-L38)). **[High]**
+- **Response/UI:** `done=true` → "Check your email" screen. Email confirmation link → [auth/callback/route.ts](src/app/auth/callback/route.ts) `exchangeCodeForSession` → `/dashboard` → (middleware) → bounced to `/subscribe` until they pay.
 
 ### Journey B — Log in
-- **Action/Component:** [login/page.tsx](src/app/login/page.tsx). **Handler:** `signInWithPassword` → on success `window.location.href="/dashboard"` ([login/page.tsx:15-29](src/app/login/page.tsx#L15-L29)). Full navigation (not client router) so middleware re-runs and session cookie is present.
+- **Action/Component:** [login/page.tsx](src/app/login/page.tsx), also gated by a Turnstile captcha (token passed as `captchaToken`). **Handler:** `signInWithPassword` → on success `window.location.href="/dashboard"`. Full navigation (not client router) so middleware re-runs, the session cookie is present, and the subscription gate evaluates.
 
 ### Journey C — Connect Gmail
 1. Settings → "Connect Gmail" is an `<a href="/api/gmail/auth">` ([settings/page.tsx:259-263](src/app/settings/page.tsx#L259-L263)).
-2. [gmail/auth/route.ts](src/app/api/gmail/auth/route.ts) builds Google consent URL with scopes `gmail.readonly`, `gmail.send`, `gmail.modify`, `access_type:"offline"`, `prompt:"consent"` → redirects to Google.
-3. Google redirects back to [gmail/callback/route.ts](src/app/api/gmail/callback/route.ts): exchanges `code` for tokens, fetches the Gmail address via `users.getProfile`, and **upserts `gmail_email` + `gmail_refresh_token` into `gym_settings`** ([callback:28-44](src/app/api/gmail/callback/route.ts#L28-L44)).
-4. Redirects to `/settings?connected=true`; the page re-reads settings and cleans the URL ([settings/page.tsx:38-43](src/app/settings/page.tsx#L38-L43)).
+2. [gmail/auth/route.ts](src/app/api/gmail/auth/route.ts) builds Google consent URL with scopes `gmail.readonly`, `gmail.send`, `gmail.modify`, `access_type:"offline"`, `prompt:"consent"`, and sets an `oauth_gmail_state` cookie carrying a random `state` value → redirects to Google.
+3. Google redirects back to [gmail/callback/route.ts](src/app/api/gmail/callback/route.ts): **verifies the `state` param matches the `oauth_gmail_state` cookie** (CSRF protection — stops an attacker linking *their* Gmail to the victim's account; mismatch → `/settings?error=gmail_invalid_state`) ([callback:17-24](src/app/api/gmail/callback/route.ts#L17-L24)), exchanges `code` for tokens, fetches the Gmail address via `users.getProfile`, and **upserts `gmail_email` + an AES-256-GCM-`encryptToken`-ed `gmail_refresh_token` into `gym_settings`** ([callback:47-55](src/app/api/gmail/callback/route.ts#L47-L55)). It then clears the state cookie.
+4. Redirects to `/settings?connected=true`; the page re-reads settings and cleans the URL.
+5. On every later read (sync/send), the stored token is `decryptToken`-ed before use; values written before encryption existed (no `enc:v1:` prefix) are returned as-is and re-encrypted on the next OAuth callback ([token-crypto.ts:40-43](src/lib/token-crypto.ts#L40-L43)).
 
 ### Journey D — Sync inbox  *(core)*
 - **Action:** click "Sync". **Component/Handler:** `handleSync` in [inbox/page.tsx:118-138](src/app/inbox/page.tsx#L118-L138) → `POST /api/gmail/sync`.
@@ -375,6 +400,23 @@ Format: **User Action → UI Component → Handler → State → API/Action →
 ### Journey J — Backfill historical sent mail
 - **Trigger:** manual `POST /api/style/backfill` (e.g. curl per [README.md:80-87](README.md#L80-L87)). Processes 20 outbound messages per call, excluding already-processed `message_id`s; returns `{ processed, skipped, remaining }`. ([style/backfill/route.ts](src/app/api/style/backfill/route.ts)).
 
+### Journey K — Subscribe (paywall) *(gates all app access)*
+1. A logged-in but un-subscribed user hits any protected page; middleware redirects them to `/subscribe` ([middleware.ts:96-114](middleware.ts#L96-L114)).
+2. [subscribe/page.tsx](src/app/subscribe/page.tsx) shows the plan and a "Subscribe" button → `POST /api/stripe/checkout`.
+3. [stripe/checkout/route.ts](src/app/api/stripe/checkout/route.ts): `getUser` (401 if absent); reads `NEXT_PUBLIC_STRIPE_PRICE_ID` (500 if unset); finds-or-creates a Stripe **Customer** (storing `stripe_customer_id` on `profiles` so repeat checkouts reuse it); creates a `mode:"subscription"` Checkout Session with `success_url=/dashboard`, `cancel_url=/subscribe`, and `metadata.supabase_uid = user.id`; returns `{ url }`.
+4. Client does `window.location.href = url` → Stripe-hosted checkout. On success Stripe redirects to `/dashboard`.
+5. **Asynchronously**, Stripe calls [stripe/webhook/route.ts](src/app/api/stripe/webhook/route.ts) (see Journey L). The `/dashboard` redirect and the activation are decoupled — if the webhook hasn't landed yet, middleware may briefly bounce the user back to `/subscribe` until `subscription_status` flips to `active`. **[Medium]**
+
+### Journey L — Stripe webhook (subscription state sync) *(server-to-server)*
+- **Trigger:** Stripe POSTs events to `/api/stripe/webhook`. Middleware lets it through untouched (no session) ([middleware.ts:65-70](middleware.ts#L65-L70)).
+- **Handler:** [stripe/webhook/route.ts](src/app/api/stripe/webhook/route.ts):
+  1. Reads the raw body + `stripe-signature`; **verifies the signature** with `STRIPE_WEBHOOK_SECRET` (400 on failure) — this is what authenticates the caller in lieu of a session.
+  2. Builds a **service-role** Supabase client (bypasses RLS).
+  3. `checkout.session.completed` → retrieve the subscription, compute `current_period_end`, and set `subscription_status='active'` + ids on `profiles`. **Primary key path is `session.metadata.supabase_uid`**; a fallback matches by `stripe_customer_id` (with a zero-row `count` check) and logs loudly if neither works.
+  4. `customer.subscription.updated` → set status `active`/`inactive` by `subscription_id`.
+  5. `customer.subscription.deleted` → set `inactive`.
+  - **Note:** the handler currently emits verbose `console.log`/`warn` debug lines (added while debugging activation) — see §18.
+
 ---
 
 # 7. Frontend Deep Dive
@@ -387,8 +429,9 @@ Format: **User Action → UI Component → Handler → State → API/Action →
 | `/inbox` | [inbox/page.tsx](src/app/inbox/page.tsx) | client | Thread list + reader + AI reply (core; orchestrator ~274 lines + [components/](src/app/inbox/components/)) |
 | `/contacts` | [contacts/page.tsx](src/app/contacts/page.tsx) | client | CRM table with filters + inline type edit |
 | `/settings` | [settings/page.tsx](src/app/settings/page.tsx) | client | Gym rules, style examples, Gmail connection |
-| `/login`, `/signup` | [login](src/app/login/page.tsx), [signup](src/app/signup/page.tsx) | client | Supabase auth |
-| `/about`, `/contact`, `/privacy`, `/terms` | respective `page.tsx` | client | Marketing/legal static |
+| `/login`, `/signup` | [login](src/app/login/page.tsx), [signup](src/app/signup/page.tsx) | client | Supabase auth + Turnstile captcha |
+| `/subscribe` | [subscribe/page.tsx](src/app/subscribe/page.tsx) | client | Paywall; launches Stripe Checkout. Auth-required but subscription-exempt |
+| `/about`, `/contact`, `/privacy`, `/terms` | respective `page.tsx` | client | Marketing/legal static. `/privacy` (261 lines) + `/terms` (217 lines) are substantive legal copy; `/contact` (113) has a **decorative, non-functional** form (`onSubmit` just `preventDefault()`s) and mailto links |
 | `/auth/callback` | [auth/callback/route.ts](src/app/auth/callback/route.ts) | handler | Session exchange |
 
 ### Layouts & providers
@@ -474,6 +517,8 @@ The backend = **Server Actions** + **Route Handlers** + **domain library** + **P
 | `/api/style/samples` | GET | — | `{samples[]}` | unauth 401 | `style_samples` (RLS-scoped) |
 | `/api/style/samples` | DELETE | `?id` | `{ok,sampleCount}` | unauth 401; missing-id 400 | `style_samples`, `updateStyleProfile` |
 | `/api/style/status` | GET | — | `{sampleCount,toneScore,avgWordCount,updatedAt}` | unauth 401 | `style_profile` |
+| `/api/stripe/checkout` | POST | — | `{url}` (Checkout session) | unauth 401; missing price 500 | Stripe, `profiles` (read+write `stripe_customer_id`) |
+| `/api/stripe/webhook` | POST | raw Stripe event + `stripe-signature` | `{received:true}` | **signature verify** 400; handler error 500 | Stripe, `profiles` via **service-role** client |
 | `/auth/callback` | GET | `?code`,`?next` | 302 | exchange error → `/login?error` | Supabase Auth |
 
 ### Domain/business logic
@@ -489,11 +534,15 @@ The backend = **Server Actions** + **Route Handlers** + **domain library** + **P
 
 **`src/lib/usage-limits.ts`** — `enforceDailyLimit(supabase, kind)` calls `increment_usage` RPC; **fails open** on RPC error ([usage-limits.ts:37-67](src/lib/usage-limits.ts#L37-L67)). Defaults: `generate:200/day`, `add_sample:50/day`.
 
+**`src/lib/subscription.ts`** — `getUserSubscriptionStatus(userId)` reads `profiles.subscription_status`/`current_period_end` and returns `{ active, currentPeriodEnd }`. A convenience reader; note the *actual* gate in middleware queries `profiles` directly rather than calling this helper, so the two could drift. **[Medium]**
+
+**`src/lib/token-crypto.ts`** — `encryptToken`/`decryptToken` for the Gmail refresh token. AES-256-GCM (authenticated encryption: confidentiality + integrity), 96-bit random IV per call, output format `enc:v1:<ivHex>.<authTagHex>.<ciphertextHex>`. Key from `GMAIL_TOKEN_ENCRYPTION_KEY` (must be 32 bytes / 64 hex chars, else throws). `decryptToken` is **backward-compatible**: a stored value without the `enc:v1:` prefix is treated as legacy plaintext and returned unchanged (so existing connections keep working until the next OAuth re-connect re-encrypts them).
+
 ### Middleware (cross-cutting)
 [middleware.ts](middleware.ts): CSP nonce + session refresh + route guards (detailed in §5/§11). Also static security headers in [next.config.ts](next.config.ts).
 
 ### Database access
-All via the Supabase query builder with the **anon key**, scoped by RLS. RPCs used: `match_style_samples` (security invoker), `apply_style_feedback` (security invoker), `increment_usage` (security definer). No service-role key is used anywhere. **[High]**
+Almost all access is via the Supabase query builder with the **anon key**, scoped by RLS. RPCs used: `match_style_samples` (security invoker), `apply_style_feedback` (security invoker), `increment_usage` (security definer). **One exception:** the Stripe webhook ([api/stripe/webhook/route.ts](src/app/api/stripe/webhook/route.ts)) builds a client with the **service-role key** (`SUPABASE_SERVICE_ROLE_KEY`), which **bypasses RLS**, to write subscription state into `profiles`. This is required because the webhook has no user session; its trust comes from Stripe signature verification, not from `auth.uid()`. It is the only service-role usage in the codebase. **[High]**
 
 ---
 
@@ -506,6 +555,7 @@ Source: [supabase/schema.sql](supabase/schema.sql), [style-memory-schema.sql](su
 ```
 auth.users (Supabase-managed)
    │ 1
+   ├──1── profiles            (subscription state; PK=auth.users.id; auto-created by trigger)
    ├──1── gym_settings        (gym rules + Gmail token; one row/user)
    ├──*── contacts            (unique: user_id+email)
    ├──*── email_threads ──────────────┐ (unique: user_id+gmail_thread_id)
@@ -527,7 +577,8 @@ auth.users (Supabase-managed)
 
 | Table | Why it exists | Used by | Key constraints |
 |---|---|---|---|
-| `gym_settings` | Per-user gym name, reply rules, **Gmail email + refresh token**, last-sync time | settings, gmail/*, ai/generate | `unique(user_id)`; RLS all |
+| `profiles` | Per-user **subscription state**: `stripe_customer_id`, `subscription_id`, `subscription_status` (default `'inactive'`), `current_period_end` | middleware gate, checkout, webhook, [subscription.ts](src/lib/subscription.ts) | PK = `auth.users.id` (cascade delete); RLS **select-only** for owners (`auth.uid()=id`); **no insert/update policy** — writes happen only via the service-role webhook. Rows auto-created by the `on_auth_user_created` trigger |
+| `gym_settings` | Per-user gym name, reply rules, **Gmail email + encrypted refresh token**, last-sync time | settings, gmail/*, ai/generate | `unique(user_id)`; RLS all |
 | `contacts` | CRM of senders | contacts page, sync | `unique(user_id,email)`; type check; RLS all |
 | `email_threads` | Grouped Gmail conversations | inbox, dashboard, sync | `unique(user_id,gmail_thread_id)`; status check; **`gmail_history_id`** (lets sync skip unchanged threads); indexes on `(user_id,status)` and `(user_id,last_message_at desc)` |
 | `email_messages` | Individual messages (raw HTML/plain body) | thread detail, sync, backfill | `unique(gmail_message_id)`; FK thread cascade; **RLS via parent thread's user_id** (subquery policy) |
@@ -544,12 +595,14 @@ auth.users (Supabase-managed)
 - `match_style_samples(query_emb vector(768), match_count int=3)` — kNN over `style_samples`, security **invoker** (RLS applies), `where embedding is not null and word_count>=10`. **Ranking now blends in feedback `weight`** (`effective_rank = cosine_distance * (1.0 / weight)`), so a "👍"-boosted sample surfaces first and a "wrong style"-demoted one sinks; it returns `weight` in the result row. Trade-off: the `ORDER BY` can no longer be served by the IVFFlat distance index, so it does a per-user scan+sort (fine at per-user sample volumes). ([style-memory-schema.sql](supabase/style-memory-schema.sql)).
 - `apply_style_feedback(p_generation_id, p_rating)` — adjusts sample `weight` by rating delta, clamped 0.1–2.0, security invoker ([style-memory-schema.sql:129-153](supabase/style-memory-schema.sql#L129-L153)).
 - `increment_usage(p_kind, p_limit)` — atomic upsert+increment, returns `(new_count, exceeded)`, security **definer** with `search_path=public` ([usage-limits-schema.sql:27-46](supabase/usage-limits-schema.sql#L27-L46)).
+- `handle_new_user()` + trigger `on_auth_user_created` — `security definer` trigger that inserts a `profiles` row (`on conflict do nothing`) **after every new `auth.users` insert**, so every account starts with an `inactive` subscription profile ([schema.sql:195-209](supabase/schema.sql#L195-L209)).
 
 ### Data lifecycle
 - A sync creates/updates `contacts`, `email_threads`, `email_messages`; stale threads auto-archived.
 - Sending sets `email_threads.status='replied'` and (when a generation exists) `ai_generations.status='sent'`.
 - Style: outbound text → `style_samples` (+embedding) → recompute `style_profile`; feedback adjusts `weight`.
 - Usage: each billed call increments `usage_counters` for `(user, today, kind)`.
+- Subscription: signup → trigger creates `profiles(inactive)`; checkout creates/stores `stripe_customer_id`; webhook flips `subscription_status` (`active`/`inactive`) + `current_period_end`; middleware reads it on every protected request.
 
 > **Note [High]:** `weight` in `style_samples` is written by feedback **and now consumed by retrieval** — `match_style_samples` divides cosine distance by `weight`, so the "Sound like you? Yes/No" feedback actually reorders which examples get injected into future drafts (changed in commit `13b9e29`). (This resolves the earlier "weight written but unused" gap.)
 
@@ -594,15 +647,18 @@ No global store, so navigating between Dashboard and Inbox **refetches** threads
 
 ### Token handling
 - Supabase tokens: managed in cookies by `@supabase/ssr`.
-- Gmail refresh token: stored in `gym_settings.gmail_refresh_token` in **plaintext**; each Gmail route reconstructs an `OAuth2` client and `setCredentials({ refresh_token })` ([sync:160-165](src/app/api/gmail/sync/route.ts#L160-L165), [send:28-33](src/app/api/gmail/send/route.ts#L28-L33)). **[High]**
+- Gmail refresh token: stored in `gym_settings.gmail_refresh_token`, now **encrypted at rest** with AES-256-GCM ([token-crypto.ts](src/lib/token-crypto.ts)). Written `encryptToken`-ed in the OAuth callback ([callback:51](src/app/api/gmail/callback/route.ts#L51)); each Gmail route `decryptToken`s it before `setCredentials({ refresh_token })` ([sync:189](src/app/api/gmail/sync/route.ts#L189), [send:45](src/app/api/gmail/send/route.ts#L45)). Legacy plaintext rows decrypt to themselves and get re-encrypted on the next re-connect. Requires `GMAIL_TOKEN_ENCRYPTION_KEY`. **[High]**
+- Captcha: a Cloudflare Turnstile token is collected on login/signup and handed to Supabase Auth (`captchaToken`), which verifies it server-side; the app does not verify it itself.
 - `signOut()` ([user-context.tsx:46-49](src/lib/user-context.tsx#L46-L49)) calls `auth.signOut()` then redirects to `/`.
 
 ### Authorization model
 - **Primary boundary = Postgres RLS.** Every table has `auth.uid() = user_id` policies (or, for `email_messages`, an EXISTS subquery on the parent thread). The anon-key client cannot read/write other users' rows. [AGENTS.md](AGENTS.md) states RLS is *the* ownership boundary and warns against redundant `.eq("user_id")` filters.
-- **Secondary checks:** every action/route calls `getUser()` and returns 401/empty if absent; feedback route additionally verifies generation ownership before acting ([feedback:30-39](src/app/api/style/feedback/route.ts#L30-L39)).
+- **Secondary checks:** every action/route calls `getUser()` and returns 401/empty if absent; the billed API routes (`/api/ai/generate`, `/api/gmail/*`, `/api/style/*`) go further and call `requirePaidUser(supabase)` ([subscription.ts](src/lib/subscription.ts)), which combines the `getUser()` check with an `active`-subscription check (401/402); feedback route additionally verifies generation ownership before acting ([feedback:30-39](src/app/api/style/feedback/route.ts#L30-L39)).
 
-### Protected routes
-Enforced by the (single, root) middleware's `protectedRoutes`/`authRoutes` lists ([middleware.ts:4-5](middleware.ts#L4-L5)). The list now correctly guards all four app pages — `/dashboard`, `/inbox`, `/contacts`, `/settings` — redirecting anonymous visits to `/login` and bouncing logged-in users off `/login`/`/signup`. (The earlier stale entries and the duplicate `src/middleware.ts` were fixed/removed in commit `6c27e79`.) RLS remains the actual data boundary; the middleware is UX/defence-in-depth.
+### Protected routes & subscription gate
+Enforced by the (single, root) middleware's `protectedRoutes`/`authRoutes`/`subscriptionExemptRoutes` lists ([middleware.ts:4-7](middleware.ts#L4-L7)). It guards all four app pages — `/dashboard`, `/inbox`, `/contacts`, `/settings` — redirecting anonymous visits to `/login` and bouncing logged-in users off `/login`/`/signup`. **On top of auth, it enforces billing:** a logged-in user with `profiles.subscription_status !== 'active'` visiting a protected page is redirected to `/subscribe` ([middleware.ts:96-114](middleware.ts#L96-L114)). `/subscribe` itself requires login but is subscription-exempt. The Stripe webhook is bypassed entirely (no session). RLS remains the actual *data* boundary; the middleware enforces *access* (auth + payment) and is UX/defence-in-depth for the former.
+
+> **Note [High]:** the *middleware* subscription gate still only fires for paths in `protectedRoutes` — the four **page** routes; `/api/*` is not in that list. The billed API routes no longer rely on it, though: each one calls `requirePaidUser(supabase)` ([subscription.ts](src/lib/subscription.ts)) at the top of the handler, which checks auth **and** `profiles.subscription_status === 'active'` and returns 401/402 otherwise. So a logged-in-but-un-subscribed (or churned) user who calls `POST /api/ai/generate`, `/api/gmail/sync`, `/api/gmail/send`, or any `/api/style/*` endpoint **directly** is now rejected at the billed-work layer, not just redirected at the UI layer. Daily usage caps remain as a second guard. **[High]**
 
 ---
 
@@ -612,8 +668,8 @@ Enforced by the (single, root) middleware's `protectedRoutes`/`authRoutes` lists
 - **Purpose:** database, auth, RLS, RPCs.
 - **Data exchanged:** all user data; auth credentials/sessions.
 - **Entry points:** [src/lib/supabase/client.ts](src/lib/supabase/client.ts) (browser), [server.ts](src/lib/supabase/server.ts) (server), [middleware.ts](middleware.ts).
-- **Failure handling:** factories throw a descriptive error if env vars are missing/invalid ([client.ts:11-15](src/lib/supabase/client.ts#L11-L15)); middleware degrades gracefully if Supabase env is absent ([middleware.ts:33-38](middleware.ts#L33-L38)); `UserProvider` wraps `createClient()` in try/catch ([user-context.tsx:27-29](src/lib/user-context.tsx#L27-L29)).
-- **Security:** anon key + RLS; no service-role key.
+- **Failure handling:** factories throw a descriptive error if env vars are missing/invalid ([client.ts:11-15](src/lib/supabase/client.ts#L11-L15)); middleware degrades gracefully if Supabase env is absent ([middleware.ts:36-41](middleware.ts#L36-L41)); `UserProvider` wraps `createClient()` in try/catch ([user-context.tsx:27-29](src/lib/user-context.tsx#L27-L29)).
+- **Security:** anon key + RLS everywhere **except** the Stripe webhook, which uses the **service-role key** (`SUPABASE_SERVICE_ROLE_KEY`, bypasses RLS) to write `profiles`.
 
 ### B. Google Gemini (`@google/generative-ai`)
 - **Purpose:** reply generation (`gemini-2.5-flash-lite`) + embeddings (`gemini-embedding-001`).
@@ -627,9 +683,21 @@ Enforced by the (single, root) middleware's `protectedRoutes`/`authRoutes` lists
 - **Data exchanged:** OAuth code/tokens; thread & message payloads (in); raw MIME messages (out).
 - **Entry points:** [gmail/auth](src/app/api/gmail/auth/route.ts), [callback](src/app/api/gmail/callback/route.ts), [sync](src/app/api/gmail/sync/route.ts), [send](src/app/api/gmail/send/route.ts).
 - **Failure handling:** sync wraps everything in try/catch returning 500 with message + a per-thread `dropped[]` diagnostic array ([sync:319-326, 177](src/app/api/gmail/sync/route.ts#L319-L326)); missing env vars → explicit 500; not-connected → 400.
-- **Security:** scopes `gmail.readonly`/`send`/`modify`; refresh token in `gym_settings` (plaintext); inbound HTML sanitized + iframe-sandboxed; outbound headers CRLF-validated.
+- **Security:** scopes `gmail.readonly`/`send`/`modify`; refresh token in `gym_settings` **AES-256-GCM-encrypted at rest** ([token-crypto.ts](src/lib/token-crypto.ts)); OAuth callback **CSRF-protected via `state` cookie**; inbound HTML sanitized + iframe-sandboxed; outbound headers CRLF-validated.
+
+### D. Stripe (`stripe`)
+- **Purpose:** subscription billing — Checkout sessions + lifecycle webhook.
+- **Data exchanged:** out — customer email, `supabase_uid` metadata, price id; in — Checkout URL, subscription objects, signed webhook events.
+- **Entry points:** [stripe/checkout/route.ts](src/app/api/stripe/checkout/route.ts) (server-side `POST`, returns hosted URL), [stripe/webhook/route.ts](src/app/api/stripe/webhook/route.ts) (Stripe → app).
+- **Failure handling:** checkout returns 401/500 on missing user/price; webhook returns 400 on bad/missing signature, 500 on handler error, and logs (does not fail the request) on individual DB update errors.
+- **Security:** secret key server-side only (`STRIPE_SECRET_KEY`); webhook authenticated by **signature verification** with `STRIPE_WEBHOOK_SECRET`; webhook bypasses middleware auth (no session) and writes via service-role.
 
-### D. Vercel (deployment) — platform, not called from code.
+### E. Cloudflare Turnstile (`@marsidev/react-turnstile`)
+- **Purpose:** captcha / bot protection on login + signup.
+- **Data exchanged:** site key (`NEXT_PUBLIC_TURNSTILE_SITE_KEY`) out; a verification token in, forwarded to Supabase as `captchaToken`.
+- **Verification:** performed by **Supabase Auth** (the project must have Turnstile enabled with the matching secret), not by app code. CSP already allowlists `challenges.cloudflare.com` ([middleware.ts:13,17-18](middleware.ts#L13-L18)).
+
+### F. Vercel (deployment) — platform, not called from code.
 
 > **QStash** appears only as a column name (`scheduled_follow_ups.qstash_message_id`) — there is **no QStash integration in the app code**. **[High]** It's a Phase-2 placeholder.
 
@@ -639,7 +707,7 @@ Enforced by the (single, root) middleware's `protectedRoutes`/`authRoutes` lists
 
 | # | Feature | Entry point(s) | Main files | DB deps | API/Action deps | Related components |
 |---|---|---|---|---|---|---|
-| 1 | **Auth (signup/login/session)** | `/signup`,`/login` | login/signup pages, [auth/callback](src/app/auth/callback/route.ts), [middleware.ts](middleware.ts), [user-context.tsx](src/lib/user-context.tsx) | `auth.users` | Supabase Auth | UserProvider, Navbar |
+| 1 | **Auth (signup/login/session + captcha)** | `/signup`,`/login` | login/signup pages (Turnstile), [auth/callback](src/app/auth/callback/route.ts), [middleware.ts](middleware.ts), [user-context.tsx](src/lib/user-context.tsx) | `auth.users`,`profiles` (trigger) | Supabase Auth, Turnstile | UserProvider, Navbar |
 | 2 | **Gmail connection** | Settings → `/api/gmail/auth` | [gmail/auth](src/app/api/gmail/auth/route.ts), [callback](src/app/api/gmail/callback/route.ts) | `gym_settings` | Google OAuth | settings page |
 | 3 | **Gmail sync** | Inbox "Sync" | [gmail/sync](src/app/api/gmail/sync/route.ts) | `contacts`,`email_threads`,`email_messages`,`gym_settings` | Gmail API | InboxPage |
 | 4 | **Inbox reading** | `/inbox` | [inbox/page.tsx](src/app/inbox/page.tsx), [threads.ts](src/app/actions/threads.ts) | `email_threads`,`email_messages`,`contacts` | `listThreads`,`getThreadDetail` | ThreadView, MessageBubble, EmailHtmlFrame |
@@ -652,6 +720,8 @@ Enforced by the (single, root) middleware's `protectedRoutes`/`authRoutes` lists
 | 11 | **Dashboard** | `/dashboard` | [dashboard/page.tsx](src/app/dashboard/page.tsx) | `email_threads` | `listThreads` | StatCard, QuickAction |
 | 12 | **Usage limits** | inside generate/add-sample | [usage-limits.ts](src/lib/usage-limits.ts) | `usage_counters` | `increment_usage` | — |
 | 13 | **Marketing/legal** | `/`,`/about`,`/contact`,`/privacy`,`/terms` | respective pages | — | — | LandingNavbar, Footer |
+| 14 | **Subscription / billing (paywall)** | `/subscribe`, Stripe Checkout/webhook | [subscribe/page.tsx](src/app/subscribe/page.tsx), [stripe/checkout](src/app/api/stripe/checkout/route.ts), [stripe/webhook](src/app/api/stripe/webhook/route.ts), [middleware.ts](middleware.ts), [subscription.ts](src/lib/subscription.ts) | `profiles` | Stripe | — |
+| 15 | **Gmail token encryption** | inside connect/sync/send | [token-crypto.ts](src/lib/token-crypto.ts) | `gym_settings` | Node `crypto` | — |
 
 **Defined-but-unused (data model only):** templates, scheduled_follow_ups, activity_logs. **[High]**
 
@@ -711,7 +781,9 @@ Ranked by importance for *understanding* the app (criticality × blast-radius).
 49. **[src/app/api/style/__tests__/add-sample.test.ts](src/app/api/style/__tests__/add-sample.test.ts)** — route test.
 50. **[README.md](README.md)** — product + setup overview.
 
-> **Not in this top-50 but worth knowing:** the inbox sub-components in [src/app/inbox/components/](src/app/inbox/components/) (`ThreadView`, `MessageBubble`, `EmailHtmlFrame`, `ReplyPanel`, `StyleFeedback`) and [src/app/api/style/samples/route.ts](src/app/api/style/samples/route.ts) (list/delete examples) — both introduced/extracted in the latest change set. The previously-listed dead `src/middleware.ts` and the unused `ui/ScoreRing|Stepper|ProgressBar|ToggleChip` have since been **deleted**.
+> **Not in this top-50 but worth knowing:** the inbox sub-components in [src/app/inbox/components/](src/app/inbox/components/) (`ThreadView`, `MessageBubble`, `EmailHtmlFrame`, `ReplyPanel`, `StyleFeedback`) and [src/app/api/style/samples/route.ts](src/app/api/style/samples/route.ts) (list/delete examples). The previously-listed dead `src/middleware.ts` and the unused `ui/ScoreRing|Stepper|ProgressBar|ToggleChip` have since been **deleted**.
+>
+> **Billing/security subsystem (added after the original top-50 was numbered; rank them ~alongside the integration routes):** [src/app/api/stripe/webhook/route.ts](src/app/api/stripe/webhook/route.ts) (the only service-role writer; source of truth for subscription state), [src/app/api/stripe/checkout/route.ts](src/app/api/stripe/checkout/route.ts), [src/lib/token-crypto.ts](src/lib/token-crypto.ts) (Gmail token at-rest crypto — breaking it breaks all Gmail access), [src/lib/subscription.ts](src/lib/subscription.ts), and [src/app/subscribe/page.tsx](src/app/subscribe/page.tsx). Also note `middleware.ts` (#5) now additionally enforces the **subscription gate**, and `supabase/schema.sql` (#3) now defines the `profiles` table + `on_auth_user_created` trigger.
 
 ---
 
@@ -789,16 +861,49 @@ Ranked by importance for *understanding* the app (criticality × blast-radius).
 [UI] optimistic local map() update; editingId cleared
 ```
 
+### Flow 5 — Subscribe & activate (two decoupled halves)
+
+```
+[Half A — checkout, synchronous]
+[Input] click "Subscribe" on /subscribe
+   ↓ POST /api/stripe/checkout
+[API] auth.getUser() (401)  → read NEXT_PUBLIC_STRIPE_PRICE_ID (500 if missing)
+   → find/create Stripe Customer; persist profiles.stripe_customer_id
+   → stripe.checkout.sessions.create(mode:subscription,
+       metadata.supabase_uid=user.id, success_url=/dashboard)
+   ↓ { url }
+[UI] window.location = url → Stripe-hosted checkout → on success → /dashboard
+
+[Half B — webhook, asynchronous, server-to-server]
+[Input] Stripe POSTs event → /api/stripe/webhook (middleware bypass)
+[API] verify stripe-signature (400 if bad)  → service-role Supabase client (bypasses RLS)
+   switch event.type:
+     checkout.session.completed → retrieve subscription → period_end
+        → UPDATE profiles SET subscription_status='active',... WHERE id = metadata.supabase_uid
+          (fallback: WHERE stripe_customer_id = customerId, with zero-row count guard)
+     customer.subscription.updated → status active|inactive WHERE subscription_id=…
+     customer.subscription.deleted → status inactive WHERE subscription_id=…
+   ↓ { received:true }
+
+[Gate] next protected-page request: middleware reads profiles.subscription_status
+        active → allowed ; otherwise → redirect /subscribe
+```
+
+> The two halves race: the `/dashboard` redirect (Half A) can land before the webhook (Half B) flips the status, briefly bouncing the user back to `/subscribe`. **[Medium]**
+
 ---
 
 # 16. Security Architecture (current implementation)
 
 ### Authentication
-- Supabase email/password; cookie sessions refreshed in middleware ([middleware.ts:59-61](middleware.ts#L59-L61)).
+- Supabase email/password; cookie sessions refreshed in middleware.
+- **Cloudflare Turnstile** captcha on login/signup, verified by Supabase Auth (bot/abuse mitigation).
+- Signup is **non-enumerable** — `"User already registered"` is swallowed and shows the same success screen ([signup:33-38](src/app/signup/page.tsx#L33-L38)).
 
 ### Authorization
-- **RLS is the boundary** — `auth.uid() = user_id` on all tables (or parent-thread subquery for `email_messages`) ([schema.sql](supabase/schema.sql), [style-memory-schema.sql](supabase/style-memory-schema.sql)). Anon key used everywhere; **service-role key never used** (verified). RPCs are mostly `security invoker` (RLS preserved); `increment_usage` is `security definer` with a fixed `search_path` and writes only its own counter row.
-- App-layer checks: per-endpoint `getUser()`; ownership re-check in feedback route.
+- **RLS is the primary boundary** — `auth.uid() = user_id` on all tables (or parent-thread subquery for `email_messages`; `profiles` is `auth.uid() = id`, **select-only** for owners) ([schema.sql](supabase/schema.sql), [style-memory-schema.sql](supabase/style-memory-schema.sql)). Anon key used everywhere **except the Stripe webhook**, which uses the **service-role key (bypasses RLS)** to write `profiles` — justified because it has no session and is authenticated by Stripe signature instead. RPCs are mostly `security invoker` (RLS preserved); `increment_usage` and the `handle_new_user` trigger are `security definer`.
+- **Subscription/access gate (two layers)** — (1) middleware redirects logged-in, non-`active` users away from the four app *page* routes to `/subscribe`; (2) the billed API routes (`/api/ai/generate`, `/api/gmail/*`, `/api/style/*`) enforce the same check in-handler via the shared `requirePaidUser(supabase)` helper ([subscription.ts](src/lib/subscription.ts)) — auth + `profiles.subscription_status === 'active'`, returning 401/402. The paywall therefore now covers the cost-incurring endpoints, not just the UI (see §11).
+- App-layer checks: per-endpoint `getUser()`; ownership re-check in feedback route; Stripe webhook signature verification.
 
 ### Input validation
 - **At the sink:** Gmail `to`/`subject` rejected if they contain CR/LF (header-injection prevention) ([send:14-16](src/app/api/gmail/send/route.ts#L14-L16)).
@@ -811,12 +916,17 @@ Ranked by importance for *understanding* the app (criticality × blast-radius).
 
 ### API protections
 - All sensitive endpoints require auth; AI endpoints have **daily caps** (fail-open) as a cost guard.
-- Untrusted email HTML: sanitized (script/handler/`javascript:`/`data:` stripped) at sync, then rendered in a **sandboxed iframe without `allow-same-origin`** — the real containment ([inbox/page.tsx:538](src/app/inbox/page.tsx#L538), [sync:108-117](src/app/api/gmail/sync/route.ts#L108-L117)).
+- **Stripe webhook** authenticated by HMAC signature verification (`STRIPE_WEBHOOK_SECRET`); rejects unsigned/forged events with 400 before any DB write.
+- **Gmail OAuth callback** is CSRF-protected by a `state` cookie matched against the returned `state` param.
+- Untrusted email HTML: sanitized (script/handler/`javascript:`/`data:` stripped) at sync, then rendered in a **sandboxed iframe without `allow-same-origin`** — the real containment ([inbox/components/EmailHtmlFrame.tsx](src/app/inbox/components/EmailHtmlFrame.tsx), [sync:108-117](src/app/api/gmail/sync/route.ts#L108-L117)).
 - **CSP with per-request nonce + `strict-dynamic`** ([middleware.ts:7-18](middleware.ts#L7-L18)); plus `X-Frame-Options:DENY`, `X-Content-Type-Options:nosniff`, `Referrer-Policy`, `Permissions-Policy` ([next.config.ts](next.config.ts)).
 
 ### Secret management
-- All secrets via env vars (Supabase keys, `GEMINI_API_KEY`, Google OAuth creds). `.env.local` git-ignored; `.env.local.example` documents shape. **[Medium]** (example file content not read here; structure inferred from usage.)
-- **Plaintext Gmail refresh token at rest** in `gym_settings` ([schema.sql:12](supabase/schema.sql#L12)) — RLS-protected but not encrypted. **[High]**
+- All secrets via env vars: Supabase anon **and service-role** keys, `GEMINI_API_KEY`, Google OAuth creds, `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`/`NEXT_PUBLIC_STRIPE_PRICE_ID`, `GMAIL_TOKEN_ENCRYPTION_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `NEXT_PUBLIC_APP_URL`. `.env.local` git-ignored. **[Medium]**
+- **Two especially sensitive secrets** now exist: `SUPABASE_SERVICE_ROLE_KEY` (full DB access, RLS-bypassing — used only in the webhook) and `GMAIL_TOKEN_ENCRYPTION_KEY` (loss = inability to decrypt stored Gmail tokens; leak = the encryption is moot). Both must be server-only env vars (they are — no `NEXT_PUBLIC_` prefix).
+
+### Data-at-rest encryption
+- **Gmail refresh token is now encrypted at rest** with AES-256-GCM ([token-crypto.ts](src/lib/token-crypto.ts)) before storage in `gym_settings.gmail_refresh_token`, replacing the previous plaintext storage. Authenticated encryption (GCM auth tag) also detects tampering. Legacy plaintext rows are tolerated (returned as-is) and re-encrypted on the next Gmail re-connect. **[High]** Residual exposure: a token is briefly plaintext in process memory whenever a Gmail call runs, and the encryption key sits in the same environment as the DB credentials.
 
 ---
 
@@ -825,6 +935,9 @@ Ranked by importance for *understanding* the app (criticality × blast-radius).
 ### Rendering strategy
 - Pages are client components that render a spinner, then fetch on mount and hydrate. Root layout forces dynamic rendering via `connection()` ([layout.tsx:17](src/app/layout.tsx#L17)). Minimal use of RSC data loading. **[High]**
 
+### Middleware cost
+- Middleware runs `auth.getUser()` on every matched request, **plus an extra `profiles` SELECT** on protected-page requests for the subscription gate ([middleware.ts:96-101](middleware.ts#L96-L101)). So a logged-in user loading `/inbox` incurs: middleware `getUser` + `profiles` query, then the page's own `getUser` (via `UserProvider`) and data fetches. Auth is now effectively resolved twice and subscription once per protected navigation. Acceptable at current scale; no caching of the subscription status between requests. **[Medium]**
+
 ### Caching
 - No client data cache (no React Query/SWR). Server mutations call `revalidatePath()`. Browser Supabase client is a singleton. **[High]**
 
@@ -847,23 +960,28 @@ Ranked by importance for *understanding* the app (criticality × blast-radius).
 
 # 18. Technical Debt Inventory
 
-> Several items from the previous revision have been **resolved** and are no longer debt: the duplicate/misconfigured middleware (now a single correct file), the 722-line `inbox/page.tsx` (split into `inbox/components/*`), the strictly-sequential sync N+1 (now incremental + parallel), `weight` being unused in ranking (now consumed by `match_style_samples`), and the unused deps/components/SSE branch (deleted). They're called out here only so a reader of the old doc isn't confused.
+> Several items from previous revisions have been **resolved** and are no longer debt: the duplicate/misconfigured middleware (now a single correct file), the 722-line `inbox/page.tsx` (split into `inbox/components/*`), the strictly-sequential sync N+1 (now incremental + parallel), `weight` being unused in ranking (now consumed by `match_style_samples`), the unused deps/components/SSE branch (deleted), and — new this revision — **plaintext Gmail refresh tokens** (now AES-256-GCM encrypted via [token-crypto.ts](src/lib/token-crypto.ts)), and — also this revision — the **subscription paywall not covering billed API routes** (every billed route — `/api/ai/generate`, `/api/gmail/*`, `/api/style/*` — now calls `requirePaidUser` from [subscription.ts](src/lib/subscription.ts), which enforces auth + an `active` subscription in-handler). They're called out here so a reader of an older doc isn't confused.
 
 ### High Risk
-1. **Plaintext Gmail refresh tokens** in `gym_settings` ([schema.sql:12](supabase/schema.sql#L12)). *Why high:* long-lived read/send/modify access to a real mailbox; a DB dump or anon-key path bug exposes it. **[High]**
-2. **Style learning from live sends often doesn't fire.** `/api/ai/generate` returns `generation:null` ([generate:112](src/app/api/ai/generate/route.ts#L112)), so `approveGeneration`'s `addStyleSample` path is usually skipped on fresh drafts. *Why high:* the headline feature's send-time feedback loop is partially inert; learning effectively depends on manual add-sample/backfill. **[Medium-High]** (Confidence Medium on real-world frequency since a thread could carry a pre-existing generation.)
+1. **Style learning from live sends often doesn't fire.** `/api/ai/generate` returns `generation:null` ([generate:112](src/app/api/ai/generate/route.ts#L112)), so `approveGeneration`'s `addStyleSample` path is usually skipped on fresh drafts. *Why high:* the headline feature's send-time feedback loop is partially inert; learning effectively depends on manual add-sample/backfill. **[Medium-High]** (Confidence Medium on real-world frequency since a thread could carry a pre-existing generation.)
 
 ### Medium Risk
-3. **Multiple near-duplicate HTML/text cleaners** with subtle differences: `cleanEmailText` ([style-memory.ts:33](src/lib/style-memory.ts#L33)), `toPlainText` ([generate:11](src/app/api/ai/generate/route.ts#L11)), `cleanBody` (now in [inbox/components/MessageBubble.tsx](src/app/inbox/components/MessageBubble.tsx)), `sanitize` ([sync](src/app/api/gmail/sync/route.ts)). *Why:* will drift — the inbox copy now also owns quoted-text stripping, widening the divergence. **[High]**
-4. **200-thread single invocation for sync.** Incremental skip + 4-way parallelism reduced the load, but a first sync (or a busy mailbox where many threads changed) still fetches up to 200 threads in one serverless call. *Why:* timeout/rate-limit risk at the tail. **[Medium]**
-5. **Value-interpolated `in(...)` filters** in sync/backfill ([sync](src/app/api/gmail/sync/route.ts), [backfill:40-46](src/app/api/style/backfill/route.ts#L40-L46)) — brushes the "no interpolation in filters" rule and has a documented URL-budget ceiling. **[Medium]**
-6. **Redundant `.eq("user_id")` filters** contradict [AGENTS.md](AGENTS.md) (e.g. [threads.ts:16](src/app/actions/threads.ts#L16), [contacts.ts:14](src/app/actions/contacts.ts#L14)). Harmless defense-in-depth but the kind of drift the doc warns about. (Note: the new `samples` route deliberately omits them, per the convention.) **[High]**
-7. **Thin test coverage** — only `style-memory.ts` and `style/*` are tested ([jest.config.ts](jest.config.ts)); the riskiest code (sync, send, middleware, generate) is untested. The sync rewrite (parallel `mapPool`, incremental partition) added logic with no tests. **[High]**
+2. **Multiple near-duplicate HTML/text cleaners** with subtle differences: `cleanEmailText` ([style-memory.ts:33](src/lib/style-memory.ts#L33)), `toPlainText` ([generate:11](src/app/api/ai/generate/route.ts#L11)), `cleanBody` (now in [inbox/components/MessageBubble.tsx](src/app/inbox/components/MessageBubble.tsx)), `sanitize` ([sync](src/app/api/gmail/sync/route.ts)). *Why:* will drift — the inbox copy now also owns quoted-text stripping, widening the divergence. **[High]**
+3. **200-thread single invocation for sync.** Incremental skip + 4-way parallelism reduced the load, but a first sync (or a busy mailbox where many threads changed) still fetches up to 200 threads in one serverless call. *Why:* timeout/rate-limit risk at the tail. **[Medium]**
+4. **Value-interpolated `in(...)` filters** in sync/backfill ([sync](src/app/api/gmail/sync/route.ts), [backfill:40-46](src/app/api/style/backfill/route.ts#L40-L46)) — brushes the "no interpolation in filters" rule and has a documented URL-budget ceiling. **[Medium]**
+5. **Redundant `.eq("user_id")` filters** contradict [AGENTS.md](AGENTS.md) (e.g. [threads.ts:16](src/app/actions/threads.ts#L16), [contacts.ts:14](src/app/actions/contacts.ts#L14)). Harmless defense-in-depth but the kind of drift the doc warns about. (Note: the new `samples` route deliberately omits them, per the convention.) **[High]**
+6. **Thin test coverage** — only `style-memory.ts` and `style/*` are tested ([jest.config.ts](jest.config.ts)); the riskiest code (sync, send, middleware, generate) is untested. The sync rewrite (parallel `mapPool`, incremental partition) added logic with no tests. **[High]**
+
+6b. **Verbose debug logging in the Stripe webhook.** [stripe/webhook/route.ts](src/app/api/stripe/webhook/route.ts) emits many `console.log/warn/error` lines (added while debugging activation, per commits `3272c47`/`9a92928`), some including `customerId`/`subscriptionId`/`uid`. *Why:* log noise + low-grade identifier leakage into logs; should be trimmed now that activation works. **[Medium]**
+6c. **Checkout↔webhook activation race.** Checkout redirects to `/dashboard` while activation happens asynchronously in the webhook; if the webhook is slow, the user is bounced to `/subscribe` despite having paid. No "pending"/polling state. **[Medium]**
+6d. **Two sources of truth for subscription status.** Middleware queries `profiles.subscription_status` inline; [subscription.ts](src/lib/subscription.ts) `requirePaidUser` is a separate reader (used by the billed API routes) that the middleware doesn't share. They can drift in interpretation (e.g. handling of `past_due`). The webhook also collapses all Stripe statuses to just `active`/`inactive` ([webhook:105](src/app/api/stripe/webhook/route.ts#L105)), discarding `past_due`/`trialing`/`canceled` nuance. **[Medium]**
 
 ### Low Risk
-8. **Unused data model:** `templates` (seeded but unread), `scheduled_follow_ups`, `activity_logs`. **[High]**
-9. **Repo artifacts** (`ruvector.db`, `tsconfig.tsbuildinfo`, `.venv/`) present in tree. **[Medium]** (verify `.gitignore`).
-10. **Split send responsibility** — the `send` route now sends, persists the outbound message, and marks the thread replied; `approveGeneration` separately marks the generation sent + triggers learning. Two writers touch the same thread/generation lifecycle. Minor coupling. **[Medium]**
+7. **Unused data model:** `templates` (seeded but unread), `scheduled_follow_ups`, `activity_logs`. **[High]**
+8. **Repo artifacts** (`ruvector.db`, `tsconfig.tsbuildinfo`, `.venv/`) present in tree. **[Medium]** (verify `.gitignore`).
+9. **Split send responsibility** — the `send` route now sends, persists the outbound message, and marks the thread replied; `approveGeneration` separately marks the generation sent + triggers learning. Two writers touch the same thread/generation lifecycle. Minor coupling. **[Medium]**
+10. **Non-functional contact form.** [contact/page.tsx](src/app/contact/page.tsx) renders inputs but its `onSubmit` only `preventDefault()`s — it sends nothing. Real contact is via the mailto links. **[Low]**
+11. **Legacy plaintext tokens never proactively migrated.** `decryptToken` tolerates pre-encryption rows and they're only re-encrypted opportunistically on the next Gmail re-connect ([token-crypto.ts:37-43](src/lib/token-crypto.ts#L37-L43)) — an account that never re-connects keeps its token in plaintext indefinitely. **[Low]** (No backfill script exists.)
 
 ---
 
@@ -884,6 +1002,8 @@ Ranked by importance for *understanding* the app (criticality × blast-radius).
 - **Supabase RLS** and why app code does *not* (need to) filter by user.
 - **Retrieval-augmented personalization** (embed → kNN → inject), no fine-tuning.
 - **Two separate OAuth systems** (Supabase identity vs Gmail access).
+- **Three access layers:** RLS (data), middleware auth guard, and the middleware **subscription gate** (`profiles.subscription_status`).
+- **Stripe billing split:** synchronous Checkout creation vs asynchronous webhook activation; the webhook is the *only* code that writes subscription state, and the *only* code using the service-role key.
 - This is **Next.js 16**; per [AGENTS.md](AGENTS.md), read `node_modules/next/dist/docs/` before touching routing/middleware rather than relying on older-version memory.
 
 ### Most critical parts
@@ -894,8 +1014,11 @@ Ranked by importance for *understanding* the app (criticality × blast-radius).
 - The **embedding dimension contract** (768) — tied to SQL `vector(768)` + IVFFlat; changing models needs a coordinated migration.
 - The **CRLF header check** in `gmail/send`.
 - The **HTML cleaners** (several near-duplicate copies — change one, the others drift).
-- **Middleware route lists** (now correct; keep them in sync with the actual pages when you add a route).
+- **Middleware route lists** (now correct; keep them in sync with the actual pages when you add a route — and remember new app pages need adding to `protectedRoutes` to be both auth- and subscription-gated).
 - The **per-thread `gmail_history_id` skip** in sync — if you change how/when it's written, you can silently stop ingesting updates to existing threads.
+- The **`GMAIL_TOKEN_ENCRYPTION_KEY`** — rotating or losing it makes every stored Gmail token undecryptable (users must re-connect). Never expose it client-side.
+- The **Stripe webhook signature check / `STRIPE_WEBHOOK_SECRET`** — without it the service-role webhook would accept forged events and could activate arbitrary accounts.
+- The **`metadata.supabase_uid`** passed through Checkout — it's how the webhook maps a Stripe customer back to a Supabase user; drop it and activation falls back to the fragile customer-id lookup.
 
 ### Suggested first tasks (to learn safely)
 - Read-only: trace one generate→send cycle with logging.
@@ -915,6 +1038,10 @@ Ranked by importance for *understanding* the app (criticality × blast-radius).
 - **Sync** — pulling recent Gmail Primary threads into the DB; **incremental** (skips threads whose `gmail_history_id` is unchanged) and **bounded-parallel** (`mapPool`, 4 at a time).
 - **Auto-archive** — marking threads `archived` when they leave the Primary set within the 14-day window.
 - **`gmail_history_id`** — Gmail's per-thread change marker, stored on `email_threads` so a re-sync can skip unchanged threads.
+- **Subscription gate / paywall** — middleware redirect of logged-in, non-`active` users to `/subscribe`; page-level only.
+- **Checkout session** — a Stripe-hosted payment page created by `/api/stripe/checkout`.
+- **Stripe webhook** — server-to-server callback that records subscription state into `profiles`; signature-verified, service-role.
+- **Turnstile** — Cloudflare captcha on login/signup, verified by Supabase Auth.
 
 ### Components
 - **UserProvider / useUser** — global auth context.
@@ -928,14 +1055,17 @@ Ranked by importance for *understanding* the app (criticality × blast-radius).
 - **Route Handler** — HTTP endpoint under [api/](src/app/api/).
 - **style-memory.ts** — the personalization engine.
 - **usage-limits.ts** — daily cost guard.
+- **subscription.ts** — reads `profiles.subscription_status` (helper; not used by the middleware gate).
+- **token-crypto.ts** — AES-256-GCM encrypt/decrypt of the Gmail refresh token (`enc:v1:` format).
 - **enforceDailyLimit / increment_usage** — soft per-user daily cap (fail-open) + its atomic Postgres function.
 
 ### Database entities
+- **profiles** — per-user subscription state (Stripe ids, status, period end); service-role-written.
 - **gym_settings, contacts, email_threads, email_messages, ai_generations** — core.
 - **style_samples, style_profile, style_feedback** — style learning.
 - **usage_counters** — daily caps.
 - **templates, scheduled_follow_ups, activity_logs** — defined but unused by app code.
-- **match_style_samples / apply_style_feedback / increment_usage** — RPC functions.
+- **match_style_samples / apply_style_feedback / increment_usage** — RPC functions; **handle_new_user** — trigger that auto-creates a `profiles` row.
 
 ### Internal terminology / config
 - **RLS (Row-Level Security)** — Postgres policies enforcing `auth.uid() = user_id`; the app's authorization boundary.
@@ -950,8 +1080,8 @@ Ranked by importance for *understanding* the app (criticality × blast-radius).
 ---
 
 ## Confidence & Limitations Summary
-- **High confidence:** folder/route structure (incl. the inbox component split), data model (incl. `gmail_history_id`), RLS-as-authz, the generate/sync/send flows, the single corrected middleware, feedback-weighted style retrieval, and the style-sample list/delete endpoint — all read directly from the current source.
-- **Medium confidence:** real-world frequency of the "generation:null skips learning" issue (depends on pre-existing generation rows); exact caching behaviour of Next 16 RSC; secret-file contents (`.env.local.example` not read in full); `connection()` intent.
-- **Could not be determined from the codebase:** production env-var values; whether the SQL files have actually been applied to the live DB (they are manual); runtime performance numbers; whether `templates`/`scheduled_follow_ups`/`activity_logs` are used by anything outside this repo.
+- **High confidence:** folder/route structure (incl. the inbox component split and the new `subscribe`/`stripe` routes), data model (incl. `gmail_history_id` and `profiles`), RLS-as-authz + the single service-role exception, the generate/sync/send flows, the Stripe checkout/webhook flow, the subscription gate in middleware (and that it does **not** cover `/api/*`), Gmail token encryption, Turnstile on auth — all read directly from the current source.
+- **Medium confidence:** real-world frequency of the "generation:null skips learning" issue; exact caching behaviour of Next 16 RSC; `connection()` intent; the precise Stripe API version pinned by `stripe@^22`; the practical likelihood of the checkout↔webhook activation race.
+- **Could not be determined from the codebase:** production env-var values (`.env.local`/`.env.local.example` are outside the readable path); whether the SQL files (incl. the `profiles` table + trigger) have actually been applied to the live DB (they are manual); whether the live Supabase project has Turnstile captcha actually enabled (the app only supplies the token); runtime performance numbers; whether `templates`/`scheduled_follow_ups`/`activity_logs` are used by anything outside this repo.
 
 *End of document.*
diff --git a/src/app/api/ai/generate/route.ts b/src/app/api/ai/generate/route.ts
index 5b308da..bd50d99 100644
--- a/src/app/api/ai/generate/route.ts
+++ b/src/app/api/ai/generate/route.ts
@@ -1,6 +1,7 @@
 import { NextResponse } from "next/server";
 import { GoogleGenerativeAI } from "@google/generative-ai";
 import { createClient } from "@/lib/supabase/server";
+import { requirePaidUser } from "@/lib/subscription";
 import { retrieveStyleContext, buildStylePromptSection } from "@/lib/style-memory";
 import { enforceDailyLimit } from "@/lib/usage-limits";
 import type { EmailMessage } from "@/lib/types";
@@ -30,8 +31,9 @@ function stripFences(text: string): string {
 
 export async function POST(request: Request) {
   const supabase = await createClient();
-  const { data: { user } } = await supabase.auth.getUser();
-  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
+  const auth = await requirePaidUser(supabase);
+  if (!auth.ok) return auth.res;
+  const user = auth.user;
 
   const limit = await enforceDailyLimit(supabase, "generate");
   if (!limit.allowed) {
diff --git a/src/app/api/gmail/send/route.ts b/src/app/api/gmail/send/route.ts
index 3589979..28e2967 100644
--- a/src/app/api/gmail/send/route.ts
+++ b/src/app/api/gmail/send/route.ts
@@ -1,12 +1,14 @@
 import { NextResponse } from "next/server";
 import { google } from "googleapis";
 import { createClient } from "@/lib/supabase/server";
+import { requirePaidUser } from "@/lib/subscription";
 import { decryptToken } from "@/lib/token-crypto";
 
 export async function POST(request: Request) {
   const supabase = await createClient();
-  const { data: { user } } = await supabase.auth.getUser();
-  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
+  const auth = await requirePaidUser(supabase);
+  if (!auth.ok) return auth.res;
+  const user = auth.user;
 
   const { threadId, gmailThreadId, to, subject, body } = await request.json();
 
diff --git a/src/app/api/gmail/sync/route.ts b/src/app/api/gmail/sync/route.ts
index 4d6088b..0856eb1 100644
--- a/src/app/api/gmail/sync/route.ts
+++ b/src/app/api/gmail/sync/route.ts
@@ -1,6 +1,7 @@
 import { NextResponse } from "next/server";
 import { google } from "googleapis";
 import { createClient } from "@/lib/supabase/server";
+import { requirePaidUser } from "@/lib/subscription";
 import { decryptToken } from "@/lib/token-crypto";
 import type { gmail_v1 } from "googleapis";
 
@@ -155,10 +156,9 @@ async function mapPool<T, R>(
 export async function POST() {
   try {
     const supabase = await createClient();
-    const {
-      data: { user },
-    } = await supabase.auth.getUser();
-    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
+    const auth = await requirePaidUser(supabase);
+    if (!auth.ok) return auth.res;
+    const user = auth.user;
 
     if (
       !process.env.GOOGLE_CLIENT_ID ||
diff --git a/src/app/api/style/add-sample/route.ts b/src/app/api/style/add-sample/route.ts
index 71e3514..ca00be9 100644
--- a/src/app/api/style/add-sample/route.ts
+++ b/src/app/api/style/add-sample/route.ts
@@ -11,13 +11,15 @@
  */
 import { NextResponse } from "next/server";
 import { createClient } from "@/lib/supabase/server";
+import { requirePaidUser } from "@/lib/subscription";
 import { addStyleSample, updateStyleProfile } from "@/lib/style-memory";
 import { enforceDailyLimit } from "@/lib/usage-limits";
 
 export async function POST(request: Request) {
   const supabase = await createClient();
-  const { data: { user } } = await supabase.auth.getUser();
-  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
+  const auth = await requirePaidUser(supabase);
+  if (!auth.ok) return auth.res;
+  const user = auth.user;
 
   const body = await request.json().catch(() => null);
   const emailBody = body?.body?.trim();
diff --git a/src/app/api/style/backfill/route.ts b/src/app/api/style/backfill/route.ts
index 051ccb6..6467144 100644
--- a/src/app/api/style/backfill/route.ts
+++ b/src/app/api/style/backfill/route.ts
@@ -12,14 +12,22 @@
  */
 import { NextResponse } from "next/server";
 import { createClient } from "@/lib/supabase/server";
+import { requirePaidUser } from "@/lib/subscription";
 import { addStyleSample, updateStyleProfile } from "@/lib/style-memory";
+import { enforceDailyLimit } from "@/lib/usage-limits";
 
 const BATCH_SIZE = 20;
 
 export async function POST() {
   const supabase = await createClient();
-  const { data: { user } } = await supabase.auth.getUser();
-  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
+  const auth = await requirePaidUser(supabase);
+  if (!auth.ok) return auth.res;
+  const user = auth.user;
+
+  const limit = await enforceDailyLimit(supabase, "add_sample");
+  if (!limit.allowed) {
+    return NextResponse.json({ error: limit.message }, { status: 429 });
+  }
 
   // Fetch already-processed message ids in a separate round-trip rather than
   // embedding a raw SQL subquery in the filter (which would bypass PostgREST
diff --git a/src/app/api/style/feedback/route.ts b/src/app/api/style/feedback/route.ts
index dc5a249..b4faf3f 100644
--- a/src/app/api/style/feedback/route.ts
+++ b/src/app/api/style/feedback/route.ts
@@ -11,13 +11,15 @@
  */
 import { NextResponse } from "next/server";
 import { createClient } from "@/lib/supabase/server";
+import { requirePaidUser } from "@/lib/subscription";
 
 const VALID_RATINGS = new Set(["good", "too_formal", "too_casual", "wrong_style"]);
 
 export async function POST(request: Request) {
   const supabase = await createClient();
-  const { data: { user } } = await supabase.auth.getUser();
-  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
+  const auth = await requirePaidUser(supabase);
+  if (!auth.ok) return auth.res;
+  const user = auth.user;
 
   const body = await request.json().catch(() => null);
   const { generationId, rating } = body ?? {};
diff --git a/src/app/api/style/samples/route.ts b/src/app/api/style/samples/route.ts
index b413ef6..a648e7a 100644
--- a/src/app/api/style/samples/route.ts
+++ b/src/app/api/style/samples/route.ts
@@ -7,12 +7,13 @@
  */
 import { NextResponse } from "next/server";
 import { createClient } from "@/lib/supabase/server";
+import { requirePaidUser } from "@/lib/subscription";
 import { updateStyleProfile } from "@/lib/style-memory";
 
 export async function GET() {
   const supabase = await createClient();
-  const { data: { user } } = await supabase.auth.getUser();
-  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
+  const auth = await requirePaidUser(supabase);
+  if (!auth.ok) return auth.res;
 
   const { data, error } = await supabase
     .from("style_samples")
@@ -26,8 +27,9 @@ export async function GET() {
 
 export async function DELETE(request: Request) {
   const supabase = await createClient();
-  const { data: { user } } = await supabase.auth.getUser();
-  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
+  const auth = await requirePaidUser(supabase);
+  if (!auth.ok) return auth.res;
+  const user = auth.user;
 
   const id = new URL(request.url).searchParams.get("id");
   if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
diff --git a/src/app/api/style/status/route.ts b/src/app/api/style/status/route.ts
index fe3dd5d..84c2a52 100644
--- a/src/app/api/style/status/route.ts
+++ b/src/app/api/style/status/route.ts
@@ -5,11 +5,13 @@
  */
 import { NextResponse } from "next/server";
 import { createClient } from "@/lib/supabase/server";
+import { requirePaidUser } from "@/lib/subscription";
 
 export async function GET() {
   const supabase = await createClient();
-  const { data: { user } } = await supabase.auth.getUser();
-  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
+  const auth = await requirePaidUser(supabase);
+  if (!auth.ok) return auth.res;
+  const user = auth.user;
 
   const { data: profile } = await supabase
     .from("style_profile")
diff --git a/src/lib/subscription.ts b/src/lib/subscription.ts
index 347c2ad..e1edd33 100644
--- a/src/lib/subscription.ts
+++ b/src/lib/subscription.ts
@@ -1,24 +1,31 @@
-import { createClient } from "@/lib/supabase/server";
+import { NextResponse } from "next/server";
+import type { SupabaseClient, User } from "@supabase/supabase-js";
 
-export async function getUserSubscriptionStatus(
-  userId: string
-): Promise<{ active: boolean; currentPeriodEnd: Date | null }> {
-  const supabase = await createClient();
+type PaidUserResult =
+  | { ok: true; user: User }
+  | { ok: false; res: NextResponse };
 
-  const { data } = await supabase
+// Auth + active-subscription gate for billed API routes. Returns the user on
+// success, or a NextResponse (401/402) the caller should return as-is.
+export async function requirePaidUser(
+  supabase: SupabaseClient
+): Promise<PaidUserResult> {
+  const {
+    data: { user },
+  } = await supabase.auth.getUser();
+  if (!user) {
+    return { ok: false, res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
+  }
+
+  const { data: profile } = await supabase
     .from("profiles")
-    .select("subscription_status, current_period_end")
-    .eq("id", userId)
+    .select("subscription_status")
+    .eq("id", user.id)
     .single();
 
-  if (!data) {
-    return { active: false, currentPeriodEnd: null };
+  if (profile?.subscription_status !== "active") {
+    return { ok: false, res: NextResponse.json({ error: "Subscription required" }, { status: 402 }) };
   }
 
-  return {
-    active: data.subscription_status === "active",
-    currentPeriodEnd: data.current_period_end
-      ? new Date(data.current_period_end)
-      : null,
-  };
+  return { ok: true, user };
 }

commit af01ed233dc9e61ac32c614a7006b020738c3675
Author: Martin Lam <martinlam16061@gmail.com>
Date:   Thu Jun 4 12:50:32 2026 -0700

    owasp8

diff --git a/KNOWLEDGE_TRANSFER.md b/KNOWLEDGE_TRANSFER.md
index 0a7625a..c66cae2 100644
--- a/KNOWLEDGE_TRANSFER.md
+++ b/KNOWLEDGE_TRANSFER.md
@@ -926,7 +926,7 @@ Ranked by importance for *understanding* the app (criticality × blast-radius).
 - **Two especially sensitive secrets** now exist: `SUPABASE_SERVICE_ROLE_KEY` (full DB access, RLS-bypassing — used only in the webhook) and `GMAIL_TOKEN_ENCRYPTION_KEY` (loss = inability to decrypt stored Gmail tokens; leak = the encryption is moot). Both must be server-only env vars (they are — no `NEXT_PUBLIC_` prefix).
 
 ### Data-at-rest encryption
-- **Gmail refresh token is now encrypted at rest** with AES-256-GCM ([token-crypto.ts](src/lib/token-crypto.ts)) before storage in `gym_settings.gmail_refresh_token`, replacing the previous plaintext storage. Authenticated encryption (GCM auth tag) also detects tampering. Legacy plaintext rows are tolerated (returned as-is) and re-encrypted on the next Gmail re-connect. **[High]** Residual exposure: a token is briefly plaintext in process memory whenever a Gmail call runs, and the encryption key sits in the same environment as the DB credentials.
+- **Gmail refresh token is now encrypted at rest** with AES-256-GCM ([token-crypto.ts](src/lib/token-crypto.ts)) before storage in `gym_settings.gmail_refresh_token`, replacing the previous plaintext storage. Authenticated encryption (GCM auth tag) also detects tampering. `decryptToken` now validates IV length (12 bytes) and GCM auth tag length (16 bytes) after hex-decoding the stored value, throwing on malformed tokens — preventing a truncated auth tag from weakening the forgery cost. Legacy plaintext rows are tolerated (returned as-is) and re-encrypted on the next Gmail re-connect. **[High]** Residual exposure: a token is briefly plaintext in process memory whenever a Gmail call runs, and the encryption key sits in the same environment as the DB credentials.
 
 ---
 
diff --git a/src/app/api/stripe/webhook/route.ts b/src/app/api/stripe/webhook/route.ts
index 73eb7f5..7c5aa94 100644
--- a/src/app/api/stripe/webhook/route.ts
+++ b/src/app/api/stripe/webhook/route.ts
@@ -2,7 +2,9 @@ import { NextRequest, NextResponse } from "next/server";
 import Stripe from "stripe";
 import { createClient } from "@supabase/supabase-js";
 
-const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
+const stripeKey = process.env.STRIPE_SECRET_KEY;
+if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not configured");
+const stripe = new Stripe(stripeKey);
 
 function createServiceClient() {
   const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
@@ -17,6 +19,12 @@ function getPeriodEnd(subscription: Stripe.Subscription): string | null {
 }
 
 export async function POST(request: NextRequest) {
+  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
+  if (!webhookSecret) {
+    console.error("[webhook] STRIPE_WEBHOOK_SECRET is not configured");
+    return NextResponse.json({ error: "Service misconfigured" }, { status: 500 });
+  }
+
   const body = await request.text();
   const sig = request.headers.get("stripe-signature");
 
@@ -29,7 +37,7 @@ export async function POST(request: NextRequest) {
     event = stripe.webhooks.constructEvent(
       body,
       sig,
-      process.env.STRIPE_WEBHOOK_SECRET!
+      webhookSecret
     );
   } catch (err) {
     console.error("[webhook] signature verification failed:", err);
@@ -45,7 +53,11 @@ export async function POST(request: NextRequest) {
         if (session.mode !== "subscription") break;
 
         const customerId = session.customer as string;
-        const subscriptionId = session.subscription as string;
+        const subscriptionId = session.subscription as string | null;
+        if (!subscriptionId) {
+          console.error("[webhook] checkout.session.completed: null subscriptionId, skipping");
+          break;
+        }
 
         const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
           expand: ["items"],
@@ -57,7 +69,7 @@ export async function POST(request: NextRequest) {
 
         if (uid) {
           console.log("[webhook] checkout.session.completed: updating by uid from session metadata", { uid, customerId, subscriptionId });
-          const { error } = await supabase
+          const { error, count } = await supabase
             .from("profiles")
             .update({
               stripe_customer_id: customerId,
@@ -65,10 +77,10 @@ export async function POST(request: NextRequest) {
               subscription_status: "active",
               current_period_end: periodEnd,
               updated_at: new Date().toISOString(),
-            })
+            }, { count: "exact" })
             .eq("id", uid);
-          if (error) {
-            console.error("[webhook] checkout.session.completed update failed:", error);
+          if (error || !count) {
+            console.error("[webhook] checkout.session.completed update failed — user not activated", { uid, error, count });
           } else {
             console.log("[webhook] checkout.session.completed: activated uid", uid);
           }
diff --git a/src/lib/token-crypto.ts b/src/lib/token-crypto.ts
index 54dea1f..01a8186 100644
--- a/src/lib/token-crypto.ts
+++ b/src/lib/token-crypto.ts
@@ -51,6 +51,9 @@ export function decryptToken(stored: string): string {
   const iv = Buffer.from(ivHex, "hex");
   const authTag = Buffer.from(authTagHex, "hex");
   const ciphertext = Buffer.from(ciphertextHex, "hex");
+  if (iv.length !== 12 || authTag.length !== 16) {
+    throw new Error("Malformed encrypted token: wrong IV or auth tag length");
+  }
   const decipher = createDecipheriv(ALGORITHM, key, iv);
   decipher.setAuthTag(authTag);
   return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
diff --git a/supabase/schema.sql b/supabase/schema.sql
index 6e277e8..0af8949 100644
--- a/supabase/schema.sql
+++ b/supabase/schema.sql
@@ -192,6 +192,10 @@ create policy "users read own profile"
   using (auth.uid() = id);
 -- Inserts and updates are done via service role in the webhook handler only.
 
+create unique index if not exists profiles_stripe_customer_id_key
+  on profiles (stripe_customer_id)
+  where stripe_customer_id is not null;
+
 -- Auto-create a profile row when a new user signs up.
 create or replace function handle_new_user()
 returns trigger language plpgsql security definer as $$

commit 7e6a4d608a73612cc2b8dcb5e09b3d4cc8fb5204
Author: Martin Lam <martinlam16061@gmail.com>
Date:   Thu Jun 4 13:08:37 2026 -0700

    owasp 9

diff --git a/KNOWLEDGE_TRANSFER.md b/KNOWLEDGE_TRANSFER.md
index c66cae2..de986b1 100644
--- a/KNOWLEDGE_TRANSFER.md
+++ b/KNOWLEDGE_TRANSFER.md
@@ -723,7 +723,9 @@ Enforced by the (single, root) middleware's `protectedRoutes`/`authRoutes`/`subs
 | 14 | **Subscription / billing (paywall)** | `/subscribe`, Stripe Checkout/webhook | [subscribe/page.tsx](src/app/subscribe/page.tsx), [stripe/checkout](src/app/api/stripe/checkout/route.ts), [stripe/webhook](src/app/api/stripe/webhook/route.ts), [middleware.ts](middleware.ts), [subscription.ts](src/lib/subscription.ts) | `profiles` | Stripe | — |
 | 15 | **Gmail token encryption** | inside connect/sync/send | [token-crypto.ts](src/lib/token-crypto.ts) | `gym_settings` | Node `crypto` | — |
 
-**Defined-but-unused (data model only):** templates, scheduled_follow_ups, activity_logs. **[High]**
+**Defined-but-unused (data model only):** templates, scheduled_follow_ups. **[High]**
+
+**`activity_logs`** — now wired. Records four events: `subscription.activated`, `subscription.cancelled` (webhook — service-role client, explicit `user_id`); `ai.generate.limit_exceeded`, `email.sent` (anon client under RLS). Schema: `user_id`, `entity_type`, `entity_id` (uuid, nullable), `action`, `metadata` (jsonb), `created_at`.
 
 ---
 
@@ -977,7 +979,7 @@ Ranked by importance for *understanding* the app (criticality × blast-radius).
 6d. **Two sources of truth for subscription status.** Middleware queries `profiles.subscription_status` inline; [subscription.ts](src/lib/subscription.ts) `requirePaidUser` is a separate reader (used by the billed API routes) that the middleware doesn't share. They can drift in interpretation (e.g. handling of `past_due`). The webhook also collapses all Stripe statuses to just `active`/`inactive` ([webhook:105](src/app/api/stripe/webhook/route.ts#L105)), discarding `past_due`/`trialing`/`canceled` nuance. **[Medium]**
 
 ### Low Risk
-7. **Unused data model:** `templates` (seeded but unread), `scheduled_follow_ups`, `activity_logs`. **[High]**
+7. **Unused data model:** `templates` (seeded but unread), `scheduled_follow_ups`. **[High]** (`activity_logs` is no longer unused — see §13.)
 8. **Repo artifacts** (`ruvector.db`, `tsconfig.tsbuildinfo`, `.venv/`) present in tree. **[Medium]** (verify `.gitignore`).
 9. **Split send responsibility** — the `send` route now sends, persists the outbound message, and marks the thread replied; `approveGeneration` separately marks the generation sent + triggers learning. Two writers touch the same thread/generation lifecycle. Minor coupling. **[Medium]**
 10. **Non-functional contact form.** [contact/page.tsx](src/app/contact/page.tsx) renders inputs but its `onSubmit` only `preventDefault()`s — it sends nothing. Real contact is via the mailto links. **[Low]**
diff --git a/src/app/api/ai/generate/route.ts b/src/app/api/ai/generate/route.ts
index bd50d99..73703c5 100644
--- a/src/app/api/ai/generate/route.ts
+++ b/src/app/api/ai/generate/route.ts
@@ -37,6 +37,14 @@ export async function POST(request: Request) {
 
   const limit = await enforceDailyLimit(supabase, "generate");
   if (!limit.allowed) {
+    console.warn("[generate] daily limit exceeded", { userId: user.id, count: limit.newCount, limit: limit.limit });
+    await supabase.from("activity_logs").insert({
+      user_id: user.id,
+      entity_type: "usage",
+      action: "limit_exceeded",
+      entity_id: null,
+      metadata: { kind: "generate", count: limit.newCount, limit: limit.limit },
+    });
     return NextResponse.json(
       { generation: null, subject: "", body: "", error: limit.message },
       { status: 429 }
diff --git a/src/app/api/gmail/send/route.ts b/src/app/api/gmail/send/route.ts
index 28e2967..7a7391a 100644
--- a/src/app/api/gmail/send/route.ts
+++ b/src/app/api/gmail/send/route.ts
@@ -20,6 +20,7 @@ export async function POST(request: Request) {
     /[\r\n]/.test(to) ||
     /[\r\n]/.test(subject)
   ) {
+    console.warn("[gmail/send] CRLF injection attempt rejected", { userId: user.id });
     return NextResponse.json({ error: "Invalid header value" }, { status: 400 });
   }
 
@@ -97,6 +98,14 @@ export async function POST(request: Request) {
       .eq("id", threadId)
       .eq("user_id", user.id);
 
+    await supabase.from("activity_logs").insert({
+      user_id: user.id,
+      entity_type: "email",
+      action: "sent",
+      entity_id: null,
+      metadata: null,
+    });
+
     return NextResponse.json({ success: true });
   } catch (err) {
     const msg = err instanceof Error ? err.message : String(err);
diff --git a/src/app/api/stripe/webhook/route.ts b/src/app/api/stripe/webhook/route.ts
index 7c5aa94..8ceb459 100644
--- a/src/app/api/stripe/webhook/route.ts
+++ b/src/app/api/stripe/webhook/route.ts
@@ -68,7 +68,6 @@ export async function POST(request: NextRequest) {
         const uid = session.metadata?.supabase_uid;
 
         if (uid) {
-          console.log("[webhook] checkout.session.completed: updating by uid from session metadata", { uid, customerId, subscriptionId });
           const { error, count } = await supabase
             .from("profiles")
             .update({
@@ -80,16 +79,23 @@ export async function POST(request: NextRequest) {
             }, { count: "exact" })
             .eq("id", uid);
           if (error || !count) {
-            console.error("[webhook] checkout.session.completed update failed — user not activated", { uid, error, count });
+            console.error("[webhook] checkout.session.completed: update failed — user not activated", { error: error?.message });
           } else {
-            console.log("[webhook] checkout.session.completed: activated uid", uid);
+            console.log("[webhook] checkout.session.completed: activated via metadata uid");
+            await supabase.from("activity_logs").insert({
+              user_id: uid,
+              entity_type: "subscription",
+              action: "activated",
+              entity_id: null,
+              metadata: { subscription_id: subscriptionId },
+            });
           }
           break;
         }
 
         // Fallback: try existing stripe_customer_id on profiles.
-        console.warn("[webhook] no supabase_uid in session metadata, falling back to stripe_customer_id lookup", { customerId });
-        const { error, count } = await supabase
+        console.warn("[webhook] checkout.session.completed: no uid in metadata, falling back to customer lookup");
+        const { data: updatedProfiles, error, count } = await supabase
           .from("profiles")
           .update({
             stripe_customer_id: customerId,
@@ -98,12 +104,23 @@ export async function POST(request: NextRequest) {
             current_period_end: periodEnd,
             updated_at: new Date().toISOString(),
           }, { count: "exact" })
-          .eq("stripe_customer_id", customerId);
+          .eq("stripe_customer_id", customerId)
+          .select("id");
 
         if (error || !count) {
-          console.error("[webhook] fallback lookup also failed — user not activated", { customerId, error });
+          console.error("[webhook] checkout.session.completed: fallback lookup failed — user not activated", { error: error?.message });
         } else {
-          console.log("[webhook] checkout.session.completed: activated via fallback", customerId);
+          console.log("[webhook] checkout.session.completed: activated via fallback");
+          const resolvedUid = updatedProfiles?.[0]?.id;
+          if (resolvedUid) {
+            await supabase.from("activity_logs").insert({
+              user_id: resolvedUid,
+              entity_type: "subscription",
+              action: "activated",
+              entity_id: null,
+              metadata: { subscription_id: subscriptionId },
+            });
+          }
         }
         break;
       }
@@ -120,26 +137,37 @@ export async function POST(request: NextRequest) {
           })
           .eq("subscription_id", subscription.id);
         if (error) {
-          console.error("[webhook] customer.subscription.updated failed:", error);
+          console.error("[webhook] customer.subscription.updated: DB update failed", { error: error.message });
         } else {
-          console.log("[webhook] customer.subscription.updated:", subscription.id, subscription.status);
+          console.log("[webhook] customer.subscription.updated: status →", subscription.status);
         }
         break;
       }
 
       case "customer.subscription.deleted": {
         const subscription = event.data.object as Stripe.Subscription;
-        const { error } = await supabase
+        const { data: cancelledProfiles, error } = await supabase
           .from("profiles")
           .update({
             subscription_status: "inactive",
             updated_at: new Date().toISOString(),
           })
-          .eq("subscription_id", subscription.id);
+          .eq("subscription_id", subscription.id)
+          .select("id");
         if (error) {
-          console.error("[webhook] customer.subscription.deleted failed:", error);
+          console.error("[webhook] customer.subscription.deleted: DB update failed", { error: error.message });
         } else {
-          console.log("[webhook] customer.subscription.deleted:", subscription.id);
+          console.log("[webhook] customer.subscription.deleted: deactivated");
+          const resolvedUid = cancelledProfiles?.[0]?.id;
+          if (resolvedUid) {
+            await supabase.from("activity_logs").insert({
+              user_id: resolvedUid,
+              entity_type: "subscription",
+              action: "cancelled",
+              entity_id: null,
+              metadata: { subscription_id: subscription.id },
+            });
+          }
         }
         break;
       }
diff --git a/src/lib/subscription.ts b/src/lib/subscription.ts
index e1edd33..ddc241f 100644
--- a/src/lib/subscription.ts
+++ b/src/lib/subscription.ts
@@ -14,6 +14,7 @@ export async function requirePaidUser(
     data: { user },
   } = await supabase.auth.getUser();
   if (!user) {
+    console.warn("[auth] unauthenticated request rejected");
     return { ok: false, res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
   }
 
@@ -24,6 +25,7 @@ export async function requirePaidUser(
     .single();
 
   if (profile?.subscription_status !== "active") {
+    console.warn("[auth] subscription gate rejected", { userId: user.id });
     return { ok: false, res: NextResponse.json({ error: "Subscription required" }, { status: 402 }) };
   }
 

commit 8439e1ca8de120084dffc5047e61b95c3ad289cd
Author: Martin Lam <martinlam16061@gmail.com>
Date:   Thu Jun 4 16:24:54 2026 -0700

    owasp 10

diff --git a/KNOWLEDGE_TRANSFER.md b/KNOWLEDGE_TRANSFER.md
index de986b1..3da4fa5 100644
--- a/KNOWLEDGE_TRANSFER.md
+++ b/KNOWLEDGE_TRANSFER.md
@@ -4,7 +4,7 @@
 > **Scope:** Documents the system *as it currently exists*. No improvements are suggested.
 > **Method:** Every non-obvious claim cites the file(s) it came from. Confidence is labelled **[High]**, **[Medium]**, or **[Low]**. Where something cannot be determined from the code, it says so explicitly.
 > **Generated from:** a full read of `src/`, `supabase/`, root config, and the build manifest.
-> **Last revised:** 2026-06-04, after the **Stripe subscription / billing** change set. This revision adds the payments subsystem (Stripe Checkout + webhook), **subscription gating in middleware**, the new `profiles` table and its auto-create trigger, **AES-256-GCM encryption of Gmail refresh tokens at rest** (`token-crypto.ts`), **Cloudflare Turnstile** captcha on login/signup, and the **first use of the Supabase service-role key** (in the Stripe webhook). The earlier 2026-06-02 baseline (inbox component split, incremental Gmail sync, feedback-weighted style retrieval, style-example management, single middleware, dep pruning) is retained and still accurate.
+> **Last revised:** 2026-06-04, after the **Stripe subscription / billing** change set. A subsequent security review (OWASP A10 — SSRF) corrected the `sanitize`/`applyCids` pipeline order in the Gmail sync route, added a UUID-format guard on `session.metadata.supabase_uid` in the Stripe webhook, and replaced the `NEXT_PUBLIC_APP_URL` localhost fallback in checkout with a fast-fail 500. This revision adds the payments subsystem (Stripe Checkout + webhook), **subscription gating in middleware**, the new `profiles` table and its auto-create trigger, **AES-256-GCM encryption of Gmail refresh tokens at rest** (`token-crypto.ts`), **Cloudflare Turnstile** captcha on login/signup, and the **first use of the Supabase service-role key** (in the Stripe webhook). The earlier 2026-06-02 baseline (inbox component split, incremental Gmail sync, feedback-weighted style retrieval, style-example management, single middleware, dep pruning) is retained and still accurate.
 
 ---
 
@@ -313,7 +313,7 @@ This traces a fresh page load (e.g. a logged-out user visiting `/inbox`). **[Hig
    - **Stripe:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PRICE_ID`.
    - **Token encryption:** `GMAIL_TOKEN_ENCRYPTION_KEY` (32-byte hex; required by [token-crypto.ts](src/lib/token-crypto.ts#L8-L23) whenever a Gmail token is read/written).
    - **Captcha:** `NEXT_PUBLIC_TURNSTILE_SITE_KEY`.
-   - **App URL:** `NEXT_PUBLIC_APP_URL` (Checkout success/cancel URLs + Gmail auth; falls back to `http://localhost:3000`).
+   - **App URL:** `NEXT_PUBLIC_APP_URL` (Checkout success/cancel URLs + Gmail auth; **required** — checkout returns 500 if absent; no localhost fallback).
    - `NODE_ENV` (dev-only CSP `'unsafe-eval'`, secure-cookie toggle).
 
 4. **Root layout renders.** [src/app/layout.tsx](src/app/layout.tsx) is an async server component. It calls `await connection()` ([layout.tsx:17](src/app/layout.tsx#L17)) — a Next.js API that opts the render into dynamic/request-time rendering. **[Medium]** (purpose: ensure per-request behaviour, likely so the nonce/session are fresh). It injects Google Fonts and renders `<ClientLayout>`.
@@ -358,7 +358,7 @@ Format: **User Action → UI Component → Handler → State → API/Action →
   1. `getUser` guard; verify Google env vars; read `gmail_refresh_token` from `gym_settings`.
   2. Build OAuth client; `gmail.users.threads.list` with `maxResults:200`, `labelIds:["INBOX"]`, `q:"newer_than:14d category:primary"`.
   3. **Incremental partition:** load each known thread's stored `gmail_history_id` in one query; a listed thread whose `historyId` is unchanged since last sync is **skipped** (no `threads.get`). Only new/changed threads go into `toFetch`.
-  4. **Parallel full fetch:** `mapPool(toFetch, 4, …)` fetches up to 4 threads concurrently; each task is wrapped in its own try/catch so a bad thread is recorded in `dropped[]` rather than crashing the run. Per thread: `threads.get(format:"full")` → `walk()` the MIME tree to extract best HTML/plain + inline CID images → `applyCids` → `sanitize` (strip script/handlers/js:/data: URLs).
+  4. **Parallel full fetch:** `mapPool(toFetch, 4, …)` fetches up to 4 threads concurrently; each task is wrapped in its own try/catch so a bad thread is recorded in `dropped[]` rather than crashing the run. Per thread: `threads.get(format:"full")` → `walk()` the MIME tree to extract best HTML/plain + inline CID images → `sanitize` (strip script/handlers/js:/data: URLs from the untrusted HTML first) → `applyCids` (inject trusted CID data-URIs so they survive the sanitizer).
   5. Identify sender, `upsert` contact, `upsert` thread (now storing `gmail_history_id`), then **one batched upsert** of all message rows for the thread (HTML capped 200k chars, plain 10k).
   6. **Auto-archive:** threads within the 14-day window whose `gmail_thread_id` is *not* in the current Primary set get `status:"archived"`.
   7. Update `gmail_last_synced_at`; return `{ synced, skipped, archived, gmailThreadCount, resultSizeEstimate, dropped }`.
@@ -403,7 +403,7 @@ Format: **User Action → UI Component → Handler → State → API/Action →
 ### Journey K — Subscribe (paywall) *(gates all app access)*
 1. A logged-in but un-subscribed user hits any protected page; middleware redirects them to `/subscribe` ([middleware.ts:96-114](middleware.ts#L96-L114)).
 2. [subscribe/page.tsx](src/app/subscribe/page.tsx) shows the plan and a "Subscribe" button → `POST /api/stripe/checkout`.
-3. [stripe/checkout/route.ts](src/app/api/stripe/checkout/route.ts): `getUser` (401 if absent); reads `NEXT_PUBLIC_STRIPE_PRICE_ID` (500 if unset); finds-or-creates a Stripe **Customer** (storing `stripe_customer_id` on `profiles` so repeat checkouts reuse it); creates a `mode:"subscription"` Checkout Session with `success_url=/dashboard`, `cancel_url=/subscribe`, and `metadata.supabase_uid = user.id`; returns `{ url }`.
+3. [stripe/checkout/route.ts](src/app/api/stripe/checkout/route.ts): `getUser` (401 if absent); reads `NEXT_PUBLIC_STRIPE_PRICE_ID` (500 if unset); reads `NEXT_PUBLIC_APP_URL` (**500 if absent** — no localhost fallback); finds-or-creates a Stripe **Customer** (storing `stripe_customer_id` on `profiles` so repeat checkouts reuse it); creates a `mode:"subscription"` Checkout Session with `success_url=/dashboard`, `cancel_url=/subscribe`, and `metadata.supabase_uid = user.id`; returns `{ url }`.
 4. Client does `window.location.href = url` → Stripe-hosted checkout. On success Stripe redirects to `/dashboard`.
 5. **Asynchronously**, Stripe calls [stripe/webhook/route.ts](src/app/api/stripe/webhook/route.ts) (see Journey L). The `/dashboard` redirect and the activation are decoupled — if the webhook hasn't landed yet, middleware may briefly bounce the user back to `/subscribe` until `subscription_status` flips to `active`. **[Medium]**
 
@@ -412,7 +412,7 @@ Format: **User Action → UI Component → Handler → State → API/Action →
 - **Handler:** [stripe/webhook/route.ts](src/app/api/stripe/webhook/route.ts):
   1. Reads the raw body + `stripe-signature`; **verifies the signature** with `STRIPE_WEBHOOK_SECRET` (400 on failure) — this is what authenticates the caller in lieu of a session.
   2. Builds a **service-role** Supabase client (bypasses RLS).
-  3. `checkout.session.completed` → retrieve the subscription, compute `current_period_end`, and set `subscription_status='active'` + ids on `profiles`. **Primary key path is `session.metadata.supabase_uid`**; a fallback matches by `stripe_customer_id` (with a zero-row `count` check) and logs loudly if neither works.
+  3. `checkout.session.completed` → retrieve the subscription, compute `current_period_end`, and set `subscription_status='active'` + ids on `profiles`. **Primary key path is `session.metadata.supabase_uid`** — validated against a UUID regex before use (non-UUID values fall through to the fallback); fallback matches by `stripe_customer_id` (with a zero-row `count` check) and logs loudly if neither works.
   4. `customer.subscription.updated` → set status `active`/`inactive` by `subscription_id`.
   5. `customer.subscription.deleted` → set `inactive`.
   - **Note:** the handler currently emits verbose `console.log`/`warn` debug lines (added while debugging activation) — see §18.
@@ -517,7 +517,7 @@ The backend = **Server Actions** + **Route Handlers** + **domain library** + **P
 | `/api/style/samples` | GET | — | `{samples[]}` | unauth 401 | `style_samples` (RLS-scoped) |
 | `/api/style/samples` | DELETE | `?id` | `{ok,sampleCount}` | unauth 401; missing-id 400 | `style_samples`, `updateStyleProfile` |
 | `/api/style/status` | GET | — | `{sampleCount,toneScore,avgWordCount,updatedAt}` | unauth 401 | `style_profile` |
-| `/api/stripe/checkout` | POST | — | `{url}` (Checkout session) | unauth 401; missing price 500 | Stripe, `profiles` (read+write `stripe_customer_id`) |
+| `/api/stripe/checkout` | POST | — | `{url}` (Checkout session) | unauth 401; missing price 500; missing `NEXT_PUBLIC_APP_URL` 500 | Stripe, `profiles` (read+write `stripe_customer_id`) |
 | `/api/stripe/webhook` | POST | raw Stripe event + `stripe-signature` | `{received:true}` | **signature verify** 400; handler error 500 | Stripe, `profiles` via **service-role** client |
 | `/auth/callback` | GET | `?code`,`?next` | 302 | exchange error → `/login?error` | Supabase Auth |
 
@@ -846,7 +846,7 @@ Ranked by importance for *understanding* the app (criticality × blast-radius).
 [API] auth → env check → read refresh token
    → threads.list(q:"newer_than:14d category:primary", max 200)
    → load known gmail_history_id per thread; skip unchanged threads
-   → mapPool(changed, 4): threads.get(full) → walk() MIME → applyCids → sanitize
+   → mapPool(changed, 4): threads.get(full) → walk() MIME → sanitize → applyCids
         → upsert contact → upsert email_threads(+gmail_history_id) → batched upsert email_messages
    → auto-archive threads not in current Primary set (14d window)
    → update gym_settings.gmail_last_synced_at
@@ -920,7 +920,7 @@ Ranked by importance for *understanding* the app (criticality × blast-radius).
 - All sensitive endpoints require auth; AI endpoints have **daily caps** (fail-open) as a cost guard.
 - **Stripe webhook** authenticated by HMAC signature verification (`STRIPE_WEBHOOK_SECRET`); rejects unsigned/forged events with 400 before any DB write.
 - **Gmail OAuth callback** is CSRF-protected by a `state` cookie matched against the returned `state` param.
-- Untrusted email HTML: sanitized (script/handler/`javascript:`/`data:` stripped) at sync, then rendered in a **sandboxed iframe without `allow-same-origin`** — the real containment ([inbox/components/EmailHtmlFrame.tsx](src/app/inbox/components/EmailHtmlFrame.tsx), [sync:108-117](src/app/api/gmail/sync/route.ts#L108-L117)).
+- Untrusted email HTML: **`sanitize` runs first** (strips script/handlers/`javascript:`/`data:` URIs from attacker-supplied content), then **`applyCids`** injects the legitimate CID-sourced data-URIs for inline images — this order ensures the sanitizer cannot strip CID-resolved images while still blocking attacker-supplied `data:` payloads. Final HTML is rendered in a **sandboxed iframe without `allow-same-origin`** — the real containment ([inbox/components/EmailHtmlFrame.tsx](src/app/inbox/components/EmailHtmlFrame.tsx), [sync:108-117](src/app/api/gmail/sync/route.ts#L108-L117)).
 - **CSP with per-request nonce + `strict-dynamic`** ([middleware.ts:7-18](middleware.ts#L7-L18)); plus `X-Frame-Options:DENY`, `X-Content-Type-Options:nosniff`, `Referrer-Policy`, `Permissions-Policy` ([next.config.ts](next.config.ts)).
 
 ### Secret management
diff --git a/src/app/api/gmail/sync/route.ts b/src/app/api/gmail/sync/route.ts
index 0856eb1..9adc65c 100644
--- a/src/app/api/gmail/sync/route.ts
+++ b/src/app/api/gmail/sync/route.ts
@@ -102,7 +102,8 @@ function applyCids(html: string, cids: Map<string, string>): string {
   let out = html;
   for (const [cid, dataUri] of cids) {
     const escaped = cid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
-    out = out.replace(new RegExp(`cid:${escaped}`, "gi"), dataUri);
+    const safeUri = dataUri.replace(/\$/g, "$$$$");
+    out = out.replace(new RegExp(`cid:${escaped}`, "gi"), safeUri);
   }
   return out;
 }
@@ -320,7 +321,7 @@ export async function POST() {
 
           let bodyText: string;
           if (acc.html) {
-            bodyText = sanitize(applyCids(acc.html, acc.cids)).slice(0, 200_000);
+            bodyText = applyCids(sanitize(acc.html), acc.cids).slice(0, 200_000);
           } else {
             bodyText = (acc.plain ?? "").slice(0, 10_000);
           }
diff --git a/src/app/api/stripe/checkout/route.ts b/src/app/api/stripe/checkout/route.ts
index 19bda18..309a6e9 100644
--- a/src/app/api/stripe/checkout/route.ts
+++ b/src/app/api/stripe/checkout/route.ts
@@ -44,7 +44,10 @@ export async function POST() {
       .eq("id", user.id);
   }
 
-  const origin = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
+  const origin = process.env.NEXT_PUBLIC_APP_URL;
+  if (!origin) {
+    return NextResponse.json({ error: "Service misconfigured" }, { status: 500 });
+  }
 
   const session = await stripe.checkout.sessions.create({
     customer: customerId,
diff --git a/src/app/api/stripe/webhook/route.ts b/src/app/api/stripe/webhook/route.ts
index 8ceb459..37b0e5d 100644
--- a/src/app/api/stripe/webhook/route.ts
+++ b/src/app/api/stripe/webhook/route.ts
@@ -66,8 +66,9 @@ export async function POST(request: NextRequest) {
 
         // Primary path: read uid from session metadata (set in checkout route).
         const uid = session.metadata?.supabase_uid;
+        const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 
-        if (uid) {
+        if (uid && UUID_RE.test(uid)) {
           const { error, count } = await supabase
             .from("profiles")
             .update({

commit d18f0301ca4f48c2d4f82d2f509d1748b904439e
Author: Martin Lam <martinlam16061@gmail.com>
Date:   Wed Jun 3 11:03:21 2026 -0700

    fix: exclude Stripe webhook from middleware auth checks
    
    Stripe POSTs to /api/stripe/webhook with no session cookie, so allowing
    the middleware to call supabase.auth.getUser() for that path was
    unnecessary and a latent risk. Early-return before the auth call so the
    route handler receives a clean request.
    
    Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>

diff --git a/middleware.ts b/middleware.ts
index 9278ca0..4d5caee 100644
--- a/middleware.ts
+++ b/middleware.ts
@@ -62,6 +62,13 @@ export async function middleware(request: NextRequest) {
     },
   });
 
+  // Stripe webhook requests arrive with no session cookie — bypass all auth logic.
+  if (request.nextUrl.pathname === "/api/stripe/webhook") {
+    supabaseResponse.headers.set("x-nonce", nonce);
+    supabaseResponse.headers.set("Content-Security-Policy", csp);
+    return supabaseResponse;
+  }
+
   const {
     data: { user },
   } = await supabase.auth.getUser();

commit 3272c4776b576cabb1db3e0664f968e09b52f18a
Author: Martin Lam <martinlam16061@gmail.com>
Date:   Wed Jun 3 13:53:31 2026 -0700

    debug: add detailed logging to checkout.session.completed webhook handler
    
    Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>

diff --git a/src/app/api/stripe/webhook/route.ts b/src/app/api/stripe/webhook/route.ts
index b0dcdfc..a09e201 100644
--- a/src/app/api/stripe/webhook/route.ts
+++ b/src/app/api/stripe/webhook/route.ts
@@ -54,6 +54,7 @@ export async function POST(request: NextRequest) {
         });
         const periodEnd = getPeriodEnd(subscription);
 
+        console.log("[webhook] checkout.session.completed: attempting update by stripe_customer_id", { customerId, subscriptionId });
         const { error } = await supabase
           .from("profiles")
           .update({
@@ -64,6 +65,7 @@ export async function POST(request: NextRequest) {
             updated_at: new Date().toISOString(),
           })
           .eq("stripe_customer_id", customerId);
+        console.log("[webhook] checkout.session.completed: update-by-customerId result", { customerId, subscriptionId, error: error ?? null });
 
         if (error) {
           // stripe_customer_id may not be set yet on first checkout —
@@ -78,6 +80,7 @@ export async function POST(request: NextRequest) {
             console.error("[webhook] no supabase_uid on customer:", customerId);
             break;
           }
+          console.log("[webhook] checkout.session.completed: attempting fallback update by uid", { customerId, subscriptionId, uid });
           const { error: err2 } = await supabase
             .from("profiles")
             .update({
@@ -88,6 +91,7 @@ export async function POST(request: NextRequest) {
               updated_at: new Date().toISOString(),
             })
             .eq("id", uid);
+          console.log("[webhook] checkout.session.completed: fallback update-by-uid result", { customerId, subscriptionId, uid, error: err2 ?? null });
           if (err2) {
             console.error("[webhook] checkout.session.completed update failed:", err2);
           } else {

commit 9a9292857191d72964c67f73697cafb11f7a925c
Author: Martin Lam <martinlam16061@gmail.com>
Date:   Wed Jun 3 14:13:04 2026 -0700

    fix: use count option on update to detect zero-row matches in webhook
    
    Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>

diff --git a/src/app/api/stripe/webhook/route.ts b/src/app/api/stripe/webhook/route.ts
index a09e201..70463a2 100644
--- a/src/app/api/stripe/webhook/route.ts
+++ b/src/app/api/stripe/webhook/route.ts
@@ -55,7 +55,7 @@ export async function POST(request: NextRequest) {
         const periodEnd = getPeriodEnd(subscription);
 
         console.log("[webhook] checkout.session.completed: attempting update by stripe_customer_id", { customerId, subscriptionId });
-        const { error } = await supabase
+        const { error, count } = await supabase
           .from("profiles")
           .update({
             stripe_customer_id: customerId,
@@ -63,11 +63,11 @@ export async function POST(request: NextRequest) {
             subscription_status: "active",
             current_period_end: periodEnd,
             updated_at: new Date().toISOString(),
-          })
+          }, { count: "exact" })
           .eq("stripe_customer_id", customerId);
-        console.log("[webhook] checkout.session.completed: update-by-customerId result", { customerId, subscriptionId, error: error ?? null });
+        console.log("[webhook] checkout.session.completed: update-by-customerId result", { customerId, subscriptionId, error: error ?? null, count });
 
-        if (error) {
+        if (error || !count) {
           // stripe_customer_id may not be set yet on first checkout —
           // fall back to supabase uid stored in customer metadata.
           const customer = await stripe.customers.retrieve(customerId);

commit 982cb6890d19240504d3fc3e3f6455376f2041b2
Author: Martin Lam <martinlam16061@gmail.com>
Date:   Thu Jun 4 01:25:36 2026 -0700

    update stripe_customer_id and subscription_id in supabase

diff --git a/src/app/api/stripe/checkout/route.ts b/src/app/api/stripe/checkout/route.ts
index 93a5399..19bda18 100644
--- a/src/app/api/stripe/checkout/route.ts
+++ b/src/app/api/stripe/checkout/route.ts
@@ -22,7 +22,6 @@ export async function POST() {
     );
   }
 
-  // Retrieve existing stripe_customer_id if present.
   const { data: profile } = await supabase
     .from("profiles")
     .select("stripe_customer_id")
@@ -37,6 +36,12 @@ export async function POST() {
       metadata: { supabase_uid: user.id },
     });
     customerId = customer.id;
+
+    // Persist immediately so repeat checkouts reuse the same customer.
+    await supabase
+      .from("profiles")
+      .update({ stripe_customer_id: customerId })
+      .eq("id", user.id);
   }
 
   const origin = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
@@ -47,6 +52,8 @@ export async function POST() {
     line_items: [{ price: priceId, quantity: 1 }],
     success_url: `${origin}/dashboard`,
     cancel_url: `${origin}/subscribe`,
+    // Pass uid on the session so the webhook has it without a customer lookup.
+    metadata: { supabase_uid: user.id },
   });
 
   return NextResponse.json({ url: session.url });
diff --git a/src/app/api/stripe/webhook/route.ts b/src/app/api/stripe/webhook/route.ts
index 70463a2..73eb7f5 100644
--- a/src/app/api/stripe/webhook/route.ts
+++ b/src/app/api/stripe/webhook/route.ts
@@ -4,14 +4,12 @@ import { createClient } from "@supabase/supabase-js";
 
 const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
 
-// Service role client — only for writing subscription status from webhook.
 function createServiceClient() {
   const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
   const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
   return createClient(url, key, { auth: { persistSession: false } });
 }
 
-// In Stripe SDK v22+ current_period_end moved from Subscription to SubscriptionItem.
 function getPeriodEnd(subscription: Stripe.Subscription): string | null {
   const item = subscription.items?.data?.[0];
   if (!item?.current_period_end) return null;
@@ -54,34 +52,12 @@ export async function POST(request: NextRequest) {
         });
         const periodEnd = getPeriodEnd(subscription);
 
-        console.log("[webhook] checkout.session.completed: attempting update by stripe_customer_id", { customerId, subscriptionId });
-        const { error, count } = await supabase
-          .from("profiles")
-          .update({
-            stripe_customer_id: customerId,
-            subscription_id: subscriptionId,
-            subscription_status: "active",
-            current_period_end: periodEnd,
-            updated_at: new Date().toISOString(),
-          }, { count: "exact" })
-          .eq("stripe_customer_id", customerId);
-        console.log("[webhook] checkout.session.completed: update-by-customerId result", { customerId, subscriptionId, error: error ?? null, count });
+        // Primary path: read uid from session metadata (set in checkout route).
+        const uid = session.metadata?.supabase_uid;
 
-        if (error || !count) {
-          // stripe_customer_id may not be set yet on first checkout —
-          // fall back to supabase uid stored in customer metadata.
-          const customer = await stripe.customers.retrieve(customerId);
-          if (customer.deleted) {
-            console.error("[webhook] customer deleted:", customerId);
-            break;
-          }
-          const uid = (customer as Stripe.Customer).metadata?.supabase_uid;
-          if (!uid) {
-            console.error("[webhook] no supabase_uid on customer:", customerId);
-            break;
-          }
-          console.log("[webhook] checkout.session.completed: attempting fallback update by uid", { customerId, subscriptionId, uid });
-          const { error: err2 } = await supabase
+        if (uid) {
+          console.log("[webhook] checkout.session.completed: updating by uid from session metadata", { uid, customerId, subscriptionId });
+          const { error } = await supabase
             .from("profiles")
             .update({
               stripe_customer_id: customerId,
@@ -91,14 +67,31 @@ export async function POST(request: NextRequest) {
               updated_at: new Date().toISOString(),
             })
             .eq("id", uid);
-          console.log("[webhook] checkout.session.completed: fallback update-by-uid result", { customerId, subscriptionId, uid, error: err2 ?? null });
-          if (err2) {
-            console.error("[webhook] checkout.session.completed update failed:", err2);
+          if (error) {
+            console.error("[webhook] checkout.session.completed update failed:", error);
           } else {
             console.log("[webhook] checkout.session.completed: activated uid", uid);
           }
+          break;
+        }
+
+        // Fallback: try existing stripe_customer_id on profiles.
+        console.warn("[webhook] no supabase_uid in session metadata, falling back to stripe_customer_id lookup", { customerId });
+        const { error, count } = await supabase
+          .from("profiles")
+          .update({
+            stripe_customer_id: customerId,
+            subscription_id: subscriptionId,
+            subscription_status: "active",
+            current_period_end: periodEnd,
+            updated_at: new Date().toISOString(),
+          }, { count: "exact" })
+          .eq("stripe_customer_id", customerId);
+
+        if (error || !count) {
+          console.error("[webhook] fallback lookup also failed — user not activated", { customerId, error });
         } else {
-          console.log("[webhook] checkout.session.completed: activated customer", customerId);
+          console.log("[webhook] checkout.session.completed: activated via fallback", customerId);
         }
         break;
       }
@@ -148,4 +141,4 @@ export async function POST(request: NextRequest) {
   }
 
   return NextResponse.json({ received: true });
-}
+}
\ No newline at end of file
diff --git a/src/app/terms/page.tsx b/src/app/terms/page.tsx
index d46cc46..746a681 100644
--- a/src/app/terms/page.tsx
+++ b/src/app/terms/page.tsx
@@ -17,7 +17,7 @@ export default function TermsOfServicePage() {
           Terms of Service
         </h1>
         <p className="text-sm text-surface-400 mb-10">
-          Last updated: April 1, 2026
+          Last updated: June 3, 2026
         </p>
 
         <div className="space-y-8 text-surface-700 leading-relaxed">
@@ -37,11 +37,12 @@ export default function TermsOfServicePage() {
               2. Description of Service
             </h2>
             <p>
-              ReplyPilot provides an AI readiness assessment tool for small
-              businesses. The service generates tailored reports with
-              recommendations based on information you provide. Our
-              recommendations are informational and should not be considered
-              professional consulting advice.
+              ReplyPilot is an AI-powered email assistant. The service connects
+              to your Gmail inbox, generates AI-drafted replies based on your
+              custom rules and writing style, and provides a contacts CRM to
+              manage your leads and contacts. AI-generated drafts are suggestions
+              only — you are responsible for reviewing and approving any reply
+              before it is sent.
             </p>
           </section>
 
@@ -73,9 +74,6 @@ export default function TermsOfServicePage() {
                 Reproduce, duplicate, or resell any part of the service without
                 express permission
               </li>
-              <li>
-                Submit false or misleading information in the assessment
-              </li>
             </ul>
           </section>
 
@@ -86,38 +84,97 @@ export default function TermsOfServicePage() {
             <p>
               All content, branding, and software associated with ReplyPilot are
               the property of ReplyPilot and are protected by applicable
-              intellectual property laws. Reports generated for your business are
+              intellectual property laws. Email drafts generated for your account are
               yours to use and share.
             </p>
           </section>
 
           <section>
             <h2 className="text-lg font-semibold text-surface-900 mb-3">
-              6. Limitation of Liability
+              6. Billing and Cancellation
+            </h2>
+            <p>
+              ReplyPilot is a subscription service billed at $5/month. You may
+              cancel at any time by contacting us at{" "}
+              <a
+                href="mailto:martinlam16061@gmail.com"
+                className="text-brand-600 hover:text-brand-700 underline underline-offset-2"
+              >
+                martinlam16061@gmail.com
+              </a>
+              . Cancellations
+              take effect at the end of the current billing period. We do not
+              offer refunds for partial billing periods.
+            </p>
+          </section>
+
+          <section>
+            <h2 className="text-lg font-semibold text-surface-900 mb-3">
+              7. Gmail Data
+            </h2>
+            <p>
+              ReplyPilot connects to your Gmail account via Google OAuth and
+              requests the following scopes:
+            </p>
+            <ul className="list-disc pl-6 mt-2 space-y-1.5">
+              <li>
+                <strong>gmail.readonly</strong> — to read your emails so
+                ReplyPilot can display them and generate AI-drafted replies.
+              </li>
+              <li>
+                <strong>gmail.modify</strong> — to create and save draft replies
+                to your Gmail Drafts folder on your behalf.
+              </li>
+            </ul>
+            <p className="mt-3">
+              Email content is processed temporarily to generate AI replies and
+              is not stored long-term. We do not sell, share, or use your email
+              data for advertising purposes. You may revoke Gmail access at any
+              time through your Google account settings, which will immediately
+              disable ReplyPilot&apos;s access to your inbox.
+            </p>
+            <p className="mt-3">
+              ReplyPilot&apos;s use of information received from Google APIs
+              complies with the{" "}
+              <a
+                href="https://developers.google.com/terms/api-services-user-data-policy"
+                target="_blank"
+                rel="noopener noreferrer"
+                className="text-brand-600 hover:text-brand-700 underline underline-offset-2"
+              >
+                Google API Services User Data Policy
+              </a>
+              , including the Limited Use requirements.
+            </p>
+          </section>
+
+          <section>
+            <h2 className="text-lg font-semibold text-surface-900 mb-3">
+              8. Limitation of Liability
             </h2>
             <p>
               ReplyPilot is provided &quot;as is&quot; without warranties of any
               kind. We are not liable for any direct, indirect, incidental, or
-              consequential damages arising from your use of the service. Our
-              recommendations are for informational purposes and do not
-              guarantee specific business outcomes.
+              consequential damages arising from your use of the service.
             </p>
           </section>
 
           <section>
             <h2 className="text-lg font-semibold text-surface-900 mb-3">
-              7. Termination
+              9. Termination
             </h2>
             <p>
               We reserve the right to suspend or terminate your access to
               ReplyPilot at our discretion if you violate these terms. You may
-              delete your account at any time through the Settings page.
+              delete your account at any time through the Settings page. Upon
+              account termination, your personal data will be deleted within 30
+              days.
             </p>
           </section>
 
           <section>
             <h2 className="text-lg font-semibold text-surface-900 mb-3">
-              8. Changes to Terms
+              10. Changes to Terms
             </h2>
             <p>
               We may modify these Terms of Service at any time. We will provide
@@ -128,19 +185,31 @@ export default function TermsOfServicePage() {
 
           <section>
             <h2 className="text-lg font-semibold text-surface-900 mb-3">
-              9. Contact
+              11. Contact
             </h2>
             <p>
               Questions about these terms? Contact us at{" "}
               <a
-                href="mailto:legal@replypilot.ai"
+                href="mailto:martinlam16061@gmail.com"
                 className="text-brand-600 hover:text-brand-700 underline underline-offset-2"
               >
-                legal@replypilot.ai
+                martinlam16061@gmail.com
               </a>
               .
             </p>
           </section>
+
+          <section>
+            <h2 className="text-lg font-semibold text-surface-900 mb-3">
+              12. Governing Law
+            </h2>
+            <p>
+              These Terms of Service and any disputes arising from your use of
+              ReplyPilot shall be governed by and construed in accordance with
+              the laws of the State of Washington, USA, without regard to its
+              conflict of law provisions.
+            </p>
+          </section>
         </div>
       </div>
     </main>

commit 1e1a750755a30e97fb3a67dcc831924cff97217f
Author: Martin Lam <martinlam16061@gmail.com>
Date:   Thu Jun 4 01:41:32 2026 -0700

    updated private policy

diff --git a/src/app/privacy/page.tsx b/src/app/privacy/page.tsx
index 659bfe4..ccbbdad 100644
--- a/src/app/privacy/page.tsx
+++ b/src/app/privacy/page.tsx
@@ -17,94 +17,239 @@ export default function PrivacyPolicyPage() {
           Privacy Policy
         </h1>
         <p className="text-sm text-surface-400 mb-10">
-          Last updated: April 1, 2026
+          Last updated: June 4, 2026
         </p>
 
         <div className="space-y-8 text-surface-700 leading-relaxed">
           <section>
             <h2 className="text-lg font-semibold text-surface-900 mb-3">
-              1. Information We Collect
+              1. Overview
             </h2>
             <p>
-              When you use ReplyPilot, we collect the information you provide
-              during account creation (name, email, business name) and the
-              responses you submit through the AI readiness assessment. We also
-              collect basic usage data such as pages visited and time spent on
-              each section.
+              ReplyPilot is an AI-powered email reply tool built for gym owners.
+              It connects to your Gmail account, uses Google Gemini to generate
+              AI-drafted replies, and includes a contacts CRM to help you manage
+              leads and members. This Privacy Policy explains what data we
+              collect, how we use it, and how we protect it.
             </p>
           </section>
 
           <section>
             <h2 className="text-lg font-semibold text-surface-900 mb-3">
-              2. How We Use Your Information
+              2. Information We Collect
             </h2>
-            <p>We use your information to:</p>
             <ul className="list-disc pl-6 mt-2 space-y-1.5">
-              <li>Generate your personalized AI readiness report</li>
-              <li>Improve our assessment and recommendation engine</li>
-              <li>Communicate with you about your account and our service</li>
-              <li>Analyze aggregate trends to improve ReplyPilot</li>
+              <li>
+                <strong>Account information</strong> — your email address and
+                password (stored securely via Supabase Auth).
+              </li>
+              <li>
+                <strong>Billing information</strong> — your Stripe customer ID
+                and subscription status. We never store raw card details; all
+                payment data is handled directly by Stripe.
+              </li>
+              <li>
+                <strong>Gmail data</strong> — email content and metadata
+                fetched through the Gmail API to display your inbox and generate
+                AI-drafted replies. See Section 4 for full details.
+              </li>
+              <li>
+                <strong>Usage and logs</strong> — basic activity logs (e.g.
+                when replies are generated or sent) used to operate and improve
+                the service.
+              </li>
             </ul>
           </section>
 
           <section>
             <h2 className="text-lg font-semibold text-surface-900 mb-3">
-              3. Data Storage &amp; Security
+              3. How We Use Your Information
+            </h2>
+            <p>We use the information we collect to:</p>
+            <ul className="list-disc pl-6 mt-2 space-y-1.5">
+              <li>Operate and deliver the ReplyPilot service.</li>
+              <li>
+                Generate AI-drafted replies by passing email content to Google
+                Gemini.
+              </li>
+              <li>
+                Process payments and manage your subscription through Stripe.
+              </li>
+              <li>
+                Send transactional emails (e.g. account confirmations, billing
+                receipts).
+              </li>
+              <li>Diagnose issues and improve the service over time.</li>
+            </ul>
+            <p className="mt-3">
+              We do not sell your data to third parties or use it for
+              advertising purposes.
+            </p>
+          </section>
+
+          <section>
+            <h2 className="text-lg font-semibold text-surface-900 mb-3">
+              4. Gmail Data and Google API Services
             </h2>
             <p>
-              Your assessment data is currently stored locally in your browser.
-              We do not transmit your assessment responses to external servers.
-              Account information is protected using industry-standard security
-              measures.
+              ReplyPilot connects to your Gmail account via Google OAuth and
+              requests the following scopes:
+            </p>
+            <ul className="list-disc pl-6 mt-2 space-y-1.5">
+              <li>
+                <strong>gmail.readonly</strong> — to read your emails so
+                ReplyPilot can display them and generate AI-drafted replies.
+              </li>
+              <li>
+                <strong>gmail.modify</strong> — to create and save draft replies
+                to your Gmail Drafts folder on your behalf.
+              </li>
+            </ul>
+            <p className="mt-3">
+              Email content is processed temporarily to generate AI replies and
+              is not stored long-term. We do not sell, share, or use your email
+              data for advertising purposes.
+            </p>
+            <p className="mt-3">
+              ReplyPilot&apos;s use of information received from Google APIs
+              complies with the{" "}
+              <a
+                href="https://developers.google.com/terms/api-services-user-data-policy"
+                target="_blank"
+                rel="noopener noreferrer"
+                className="text-brand-600 hover:text-brand-700 underline underline-offset-2"
+              >
+                Google API Services User Data Policy
+              </a>
+              , including the Limited Use requirements.
+            </p>
+            <p className="mt-3">
+              You may revoke Gmail access at any time through{" "}
+              <a
+                href="https://myaccount.google.com/permissions"
+                target="_blank"
+                rel="noopener noreferrer"
+                className="text-brand-600 hover:text-brand-700 underline underline-offset-2"
+              >
+                your Google account permissions
+              </a>
+              . Revoking access immediately disables ReplyPilot&apos;s
+              connection to your inbox.
             </p>
           </section>
 
           <section>
             <h2 className="text-lg font-semibold text-surface-900 mb-3">
-              4. Sharing Your Information
+              5. Data Retention
             </h2>
             <p>
-              We do not sell, rent, or share your personal information with third
-              parties for marketing purposes. We may share anonymized, aggregate
-              data for research or product improvement.
+              We retain your account and billing data for as long as your
+              account is active. If you delete your account, your personal data
+              is removed within 30 days. Email content fetched from Gmail is not
+              stored beyond the duration of the request that requires it.
             </p>
           </section>
 
           <section>
             <h2 className="text-lg font-semibold text-surface-900 mb-3">
-              5. Your Rights
+              6. Data Sharing
             </h2>
             <p>
-              You can delete your account and all associated data at any time
-              from the Settings page. You may also contact us to request a copy
-              of your data or ask any privacy-related questions.
+              We do not sell your personal data. We share data only with the
+              following third-party services that are necessary to operate
+              ReplyPilot:
+            </p>
+            <ul className="list-disc pl-6 mt-2 space-y-1.5">
+              <li>
+                <strong>Supabase</strong> — database and authentication.
+              </li>
+              <li>
+                <strong>Stripe</strong> — payment processing and subscription
+                management.
+              </li>
+              <li>
+                <strong>Google Gemini</strong> — AI reply generation. Email
+                content is passed to Gemini solely to produce draft replies.
+              </li>
+              <li>
+                <strong>Vercel</strong> — application hosting and
+                infrastructure.
+              </li>
+            </ul>
+          </section>
+
+          <section>
+            <h2 className="text-lg font-semibold text-surface-900 mb-3">
+              7. Security
+            </h2>
+            <p>
+              All data is transmitted over HTTPS. Your database is protected by
+              row-level security policies so that each user can only access their
+              own data. Credentials and API keys are stored as restricted
+              environment variables and are never exposed to the client. While we
+              take reasonable precautions, no system is completely secure and we
+              cannot guarantee absolute security.
+            </p>
+          </section>
+
+          <section>
+            <h2 className="text-lg font-semibold text-surface-900 mb-3">
+              8. Your Rights
+            </h2>
+            <p>You have the right to:</p>
+            <ul className="list-disc pl-6 mt-2 space-y-1.5">
+              <li>Access the personal data we hold about you.</li>
+              <li>Request correction of inaccurate data.</li>
+              <li>Request deletion of your account and associated data.</li>
+              <li>
+                Revoke Gmail access at any time via{" "}
+                <a
+                  href="https://myaccount.google.com/permissions"
+                  target="_blank"
+                  rel="noopener noreferrer"
+                  className="text-brand-600 hover:text-brand-700 underline underline-offset-2"
+                >
+                  your Google account permissions
+                </a>
+                .
+              </li>
+            </ul>
+            <p className="mt-3">
+              To exercise any of these rights, contact us at{" "}
+              <a
+                href="mailto:martinlam16061@gmail.com"
+                className="text-brand-600 hover:text-brand-700 underline underline-offset-2"
+              >
+                martinlam16061@gmail.com
+              </a>
+              .
             </p>
           </section>
 
           <section>
             <h2 className="text-lg font-semibold text-surface-900 mb-3">
-              6. Changes to This Policy
+              9. Changes to This Policy
             </h2>
             <p>
-              We may update this Privacy Policy from time to time. We will
-              notify you of significant changes by posting a notice on our
-              website. Continued use of ReplyPilot after changes constitutes
-              acceptance of the updated policy.
+              We may update this Privacy Policy from time to time. When we make
+              material changes, we will update the &quot;Last updated&quot; date
+              at the top of this page. Your continued use of ReplyPilot after
+              changes are posted constitutes your acceptance of the revised
+              policy.
             </p>
           </section>
 
           <section>
             <h2 className="text-lg font-semibold text-surface-900 mb-3">
-              7. Contact
+              10. Contact
             </h2>
             <p>
-              If you have questions about this Privacy Policy, please contact us
-              at{" "}
+              Questions about this Privacy Policy? Contact us at{" "}
               <a
-                href="mailto:privacy@replypilot.ai"
+                href="mailto:martinlam16061@gmail.com"
                 className="text-brand-600 hover:text-brand-700 underline underline-offset-2"
               >
-                privacy@replypilot.ai
+                martinlam16061@gmail.com
               </a>
               .
             </p>

commit 05bedbc612c29b8573f68c90580733f412f5d738
Author: Martin Lam <martinlam16061@gmail.com>
Date:   Wed Jun 3 01:15:12 2026 -0700

    Force redeploy

commit a98bd363310b5ee8534da9a9e401622a83aa3fda
Author: Martin Lam <martinlam16061@gmail.com>
Date:   Tue Jun 2 16:15:29 2026 -0700

    fix reply thread and text settings

diff --git a/src/app/api/gmail/send/route.ts b/src/app/api/gmail/send/route.ts
index 3a36b54..d2d69bc 100644
--- a/src/app/api/gmail/send/route.ts
+++ b/src/app/api/gmail/send/route.ts
@@ -43,7 +43,7 @@ export async function POST(request: Request) {
     body,
   ].join("\r\n");
 
-  await gmail.users.messages.send({
+  const sendRes = await gmail.users.messages.send({
     userId: "me",
     requestBody: {
       raw: Buffer.from(raw).toString("base64url"),
@@ -51,10 +51,34 @@ export async function POST(request: Request) {
     },
   });
 
-  // Mark thread as replied
+  const sentAt = new Date().toISOString();
+
+  // Persist the sent reply immediately so it shows in the conversation view
+  // without waiting for the next Gmail sync. The real Gmail message id is used
+  // as the conflict key, so the next sync's upsert dedupes against this row
+  // (and may refine body_text from the canonical MIME).
+  const sentMessageId = sendRes.data.id;
+  if (sentMessageId) {
+    await supabase.from("email_messages").upsert(
+      {
+        thread_id: threadId,
+        gmail_message_id: sentMessageId,
+        direction: "outbound",
+        from_email: settings.gmail_email,
+        to_email: to,
+        subject,
+        body_text: body,
+        sent_at: sentAt,
+      },
+      { onConflict: "gmail_message_id" }
+    );
+  }
+
+  // Mark replied and move the thread to the top — the reply is now the latest
+  // message, mirroring Gmail's "active conversation rises" behaviour.
   await supabase
     .from("email_threads")
-    .update({ status: "replied" })
+    .update({ status: "replied", last_message_at: sentAt })
     .eq("id", threadId);
 
   return NextResponse.json({ success: true });
diff --git a/src/app/api/gmail/sync/route.ts b/src/app/api/gmail/sync/route.ts
index 9425571..07c7fe5 100644
--- a/src/app/api/gmail/sync/route.ts
+++ b/src/app/api/gmail/sync/route.ts
@@ -126,6 +126,29 @@ function parseEmailAddress(raw: string): { email: string; name: string | null }
   return { email, name };
 }
 
+// Run an async mapper over items with a bounded number of workers, so we fetch
+// several Gmail threads at once instead of strictly one-at-a-time.
+async function mapPool<T, R>(
+  items: T[],
+  concurrency: number,
+  fn: (item: T) => Promise<R>
+): Promise<R[]> {
+  const results: R[] = new Array(items.length);
+  let next = 0;
+  const workers = Array.from(
+    { length: Math.min(concurrency, items.length) },
+    async () => {
+      while (true) {
+        const idx = next++;
+        if (idx >= items.length) break;
+        results[idx] = await fn(items[idx]);
+      }
+    }
+  );
+  await Promise.all(workers);
+  return results;
+}
+
 // ─── Route ───────────────────────────────────────────────────────────────────
 
 export async function POST() {
@@ -173,25 +196,56 @@ export async function POST() {
     });
 
     const threads = threadsResponse.data.threads ?? [];
-    let synced = 0;
+    const ownEmail = settings.gmail_email?.toLowerCase() ?? "";
     const dropped: { gmailThreadId: string; reason: string }[] = [];
 
-    for (const thread of threads) {
-      if (!thread.id) {
+    // ── Incremental partition ──────────────────────────────────────────────
+    // Pull the historyId we last stored for each known thread in one query.
+    // Threads whose historyId is unchanged since then are skipped (no costly
+    // threads.get); only new or modified threads are fetched in full.
+    const { data: existingRows } = await supabase
+      .from("email_threads")
+      .select("gmail_thread_id, gmail_history_id")
+      .eq("user_id", user.id);
+    const knownHistory = new Map<string, string | null>(
+      (existingRows ?? []).map((r) => [r.gmail_thread_id, r.gmail_history_id])
+    );
+
+    const toFetch: typeof threads = [];
+    let skipped = 0;
+
+    for (const t of threads) {
+      if (!t.id) {
         dropped.push({ gmailThreadId: "(no id)", reason: "thread has no id" });
         continue;
       }
+      const prevHist = knownHistory.get(t.id);
+      const unchanged =
+        knownHistory.has(t.id) && !!prevHist && !!t.historyId && prevHist === t.historyId;
+      if (unchanged) {
+        // Already stored and nothing changed since last sync — nothing to do.
+        skipped++;
+      } else {
+        toFetch.push(t);
+      }
+    }
 
+    // ── Full fetch for new/changed threads, in parallel ────────────────────
+    // Each task catches its own errors so one bad/transient thread can never
+    // reject a sibling-laden Promise.all and crash the whole route.
+    const fetchResults = await mapPool(toFetch, 4, async (t): Promise<boolean> => {
+     try {
+      const threadId = t.id!;
       const threadDetail = await gmail.users.threads.get({
         userId: "me",
-        id: thread.id,
+        id: threadId,
         format: "full",
       });
 
       const messages = threadDetail.data.messages ?? [];
       if (!messages.length) {
-        dropped.push({ gmailThreadId: thread.id, reason: "no messages in thread" });
-        continue;
+        dropped.push({ gmailThreadId: threadId, reason: "no messages in thread" });
+        return false;
       }
 
       const firstMessage = messages[0];
@@ -201,8 +255,8 @@ export async function POST() {
       const lastDate = new Date(
         parseInt(lastMessage.internalDate ?? "0")
       ).toISOString();
+      const historyId = t.historyId ?? threadDetail.data.historyId ?? null;
 
-      const ownEmail = settings.gmail_email?.toLowerCase() ?? "";
       const inboundMsg = messages.find((m) => {
         const from = headerVal(m.payload?.headers, "from").toLowerCase();
         return !from.includes(ownEmail);
@@ -231,10 +285,11 @@ export async function POST() {
         .upsert(
           {
             user_id: user.id,
-            gmail_thread_id: thread.id,
+            gmail_thread_id: threadId,
             contact_id: contactId,
             subject,
             last_message_at: lastDate,
+            gmail_history_id: historyId,
           },
           { onConflict: "user_id,gmail_thread_id" }
         )
@@ -243,49 +298,59 @@ export async function POST() {
 
       if (!upsertedThread) {
         dropped.push({
-          gmailThreadId: thread.id,
+          gmailThreadId: threadId,
           reason: `thread upsert failed: ${threadErr?.message ?? "unknown"}`,
         });
-        continue;
+        return false;
       }
 
-      for (const msg of messages) {
-        if (!msg.id) continue;
-
-        const fromRaw = headerVal(msg.payload?.headers, "from");
-        const toRaw = headerVal(msg.payload?.headers, "to");
-        const msgSubject = headerVal(msg.payload?.headers, "subject");
-        const sentAt = new Date(parseInt(msg.internalDate ?? "0")).toISOString();
-        const isOutbound = fromRaw.toLowerCase().includes(ownEmail);
-
-        const acc: WalkResult = { html: null, plain: null, cids: new Map() };
-        walk(msg.payload ?? undefined, acc);
-
-        let bodyText: string;
-        if (acc.html) {
-          const html = sanitize(applyCids(acc.html, acc.cids));
-          bodyText = html.slice(0, 200_000);
-        } else {
-          bodyText = (acc.plain ?? "").slice(0, 10_000);
-        }
-
-        await supabase.from("email_messages").upsert(
-          {
+      // Build all message rows, then write them in a single batched upsert.
+      const messageRows = messages
+        .filter((msg) => !!msg.id)
+        .map((msg) => {
+          const fromRaw = headerVal(msg.payload?.headers, "from");
+          const toRaw = headerVal(msg.payload?.headers, "to");
+          const msgSubject = headerVal(msg.payload?.headers, "subject");
+          const sentAt = new Date(parseInt(msg.internalDate ?? "0")).toISOString();
+          const isOutbound = fromRaw.toLowerCase().includes(ownEmail);
+
+          const acc: WalkResult = { html: null, plain: null, cids: new Map() };
+          walk(msg.payload ?? undefined, acc);
+
+          let bodyText: string;
+          if (acc.html) {
+            bodyText = sanitize(applyCids(acc.html, acc.cids)).slice(0, 200_000);
+          } else {
+            bodyText = (acc.plain ?? "").slice(0, 10_000);
+          }
+
+          return {
             thread_id: upsertedThread.id,
-            gmail_message_id: msg.id,
+            gmail_message_id: msg.id!,
             direction: isOutbound ? "outbound" : "inbound",
             from_email: fromRaw,
             to_email: toRaw,
             subject: msgSubject,
             body_text: bodyText,
             sent_at: sentAt,
-          },
-          { onConflict: "gmail_message_id" }
-        );
+          };
+        });
+
+      if (messageRows.length) {
+        await supabase
+          .from("email_messages")
+          .upsert(messageRows, { onConflict: "gmail_message_id" });
       }
 
-      synced++;
-    }
+      return true;
+     } catch (threadErr) {
+      const reason = threadErr instanceof Error ? threadErr.message : String(threadErr);
+      dropped.push({ gmailThreadId: t.id ?? "(no id)", reason });
+      return false;
+     }
+    });
+
+    const synced = fetchResults.filter(Boolean).length;
 
     // Auto-archive threads that fall outside the current Primary set within the
     // 14-day sync window. Anything older than 14 days is left alone — the sync
@@ -311,6 +376,7 @@ export async function POST() {
 
     return NextResponse.json({
       synced,
+      skipped,
       archived,
       gmailThreadCount: threads.length,
       resultSizeEstimate: threadsResponse.data.resultSizeEstimate ?? null,
diff --git a/src/app/api/style/samples/route.ts b/src/app/api/style/samples/route.ts
new file mode 100644
index 0000000..b413ef6
--- /dev/null
+++ b/src/app/api/style/samples/route.ts
@@ -0,0 +1,49 @@
+/**
+ * GET    /api/style/samples        — list the user's writing-style examples
+ * DELETE /api/style/samples?id=…   — remove one example
+ *
+ * Both rely on RLS (auth.uid() = user_id) to scope rows to the caller, so no
+ * explicit user_id filter is needed at the call site.
+ */
+import { NextResponse } from "next/server";
+import { createClient } from "@/lib/supabase/server";
+import { updateStyleProfile } from "@/lib/style-memory";
+
+export async function GET() {
+  const supabase = await createClient();
+  const { data: { user } } = await supabase.auth.getUser();
+  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
+
+  const { data, error } = await supabase
+    .from("style_samples")
+    .select("id, clean_body, word_count, context_cluster, created_at")
+    .order("created_at", { ascending: false });
+
+  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
+
+  return NextResponse.json({ samples: data ?? [] });
+}
+
+export async function DELETE(request: Request) {
+  const supabase = await createClient();
+  const { data: { user } } = await supabase.auth.getUser();
+  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
+
+  const id = new URL(request.url).searchParams.get("id");
+  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
+
+  // RLS ensures this only ever deletes a row the caller owns.
+  const { error } = await supabase.from("style_samples").delete().eq("id", id);
+  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
+
+  // Recompute the style profile so future drafts reflect the removal.
+  await updateStyleProfile(supabase, user.id);
+
+  const { data: profile } = await supabase
+    .from("style_profile")
+    .select("sample_count")
+    .eq("user_id", user.id)
+    .single();
+
+  return NextResponse.json({ ok: true, sampleCount: profile?.sample_count ?? 0 });
+}
diff --git a/src/app/inbox/components/EmailHtmlFrame.tsx b/src/app/inbox/components/EmailHtmlFrame.tsx
index d441935..1313c5d 100644
--- a/src/app/inbox/components/EmailHtmlFrame.tsx
+++ b/src/app/inbox/components/EmailHtmlFrame.tsx
@@ -66,9 +66,9 @@ ${inject}
 </head><body>${upgraded}</body></html>`;
 }
 
-export function EmailHtmlFrame({ html }: { html: string }) {
+export function EmailHtmlFrame({ html, minHeight = 530 }: { html: string; minHeight?: number }) {
   const iframeRef = useRef<HTMLIFrameElement>(null);
-  const MIN_EMAIL_FRAME_HEIGHT = 530;
+  const MIN_EMAIL_FRAME_HEIGHT = minHeight;
   const [height, setHeight] = useState(MIN_EMAIL_FRAME_HEIGHT);
 
   useEffect(() => {
diff --git a/src/app/inbox/components/MessageBubble.tsx b/src/app/inbox/components/MessageBubble.tsx
index 648978d..7d4d615 100644
--- a/src/app/inbox/components/MessageBubble.tsx
+++ b/src/app/inbox/components/MessageBubble.tsx
@@ -1,7 +1,9 @@
 "use client";
 
+import { useState } from "react";
 import type { EmailMessage } from "@/lib/types";
 import { EmailHtmlFrame } from "./EmailHtmlFrame";
+import { MoreHorizontal } from "lucide-react";
 
 // ─── Helpers ────────────────────────────────────────────────────────────────
 
@@ -43,30 +45,129 @@ function cleanBody(text: string | null): string {
   return clean;
 }
 
+// Remove the quoted reply chain so each message shows only its new content,
+// matching how Gmail collapses prior messages behind the "•••" toggle.
+// Returns everything up to (but not including) the first quote marker.
+function stripQuotedText(text: string): string {
+  const lines = text.split("\n");
+  const kept: string[] = [];
+
+  for (let i = 0; i < lines.length; i++) {
+    const t = lines[i].trim();
+
+    // Gmail / Apple Mail attribution: "On <date>, <name> wrote:" — sometimes
+    // wraps across up to three lines but always ends in "wrote:".
+    if (/^On\b/.test(t)) {
+      const joined = [t, lines[i + 1]?.trim() ?? "", lines[i + 2]?.trim() ?? ""].join(" ");
+      if (/\bwrote:\s*$/.test(t) || /\bwrote:\s*$/.test(joined)) break;
+    }
+
+    // Forwarded / original-message separators
+    if (/^-{2,}\s*(original|forwarded)\s+message\s*-{2,}/i.test(t)) break;
+
+    // Outlook reply divider (a run of underscores) followed by a header block
+    if (/^_{5,}$/.test(t)) break;
+
+    // Outlook header block: "From: …" immediately above Sent/To/Subject lines
+    if (/^From:\s.+/.test(t)) {
+      const ahead = lines.slice(i, i + 5).map((l) => l.trim()).join("\n");
+      if (/(^|\n)(Sent|To|Subject):/.test(ahead)) break;
+    }
+
+    // Plain-text quoted lines
+    if (t.startsWith(">")) break;
+
+    kept.push(lines[i]);
+  }
+
+  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
+}
+
+// HTML equivalent of stripQuotedText: cut the markup at the first quoted-reply
+// container so an HTML message shows only its new content. Mail clients wrap
+// quotes in recognisable elements — Gmail uses `gmail_quote`/`gmail_attr`,
+// others use <blockquote>. Truncating leaves dangling tags, which the iframe's
+// browser parser auto-closes; this never weakens the sandbox.
+function stripQuotedHtml(html: string): string {
+  const markers = [
+    /<div[^>]*class="[^"]*gmail_quote/i, // Gmail quote container
+    /<div[^>]*class="[^"]*gmail_attr/i,  // Gmail "On … wrote:" attribution
+    /<blockquote[^>]*>/i,                // Apple Mail / generic cite blocks
+  ];
+  let cut = -1;
+  for (const re of markers) {
+    const m = re.exec(html);
+    if (m && (cut === -1 || m.index < cut)) cut = m.index;
+  }
+  return cut === -1 ? html : html.slice(0, cut);
+}
+
 // ─── Message bubble ───────────────────────────────────────────────────────────
 
 export function MessageBubble({ message }: { message: EmailMessage }) {
+  const [showQuoted, setShowQuoted] = useState(false);
+
   const isOutbound = message.direction === "outbound";
   const body = message.body_text || "";
   const isHtml = body.trimStart().startsWith("<");
 
-  if (isOutbound) {
+  // Inbound HTML renders in the sandboxed iframe with the email's own layout.
+  if (!isOutbound && isHtml) {
+    const strippedHtml = stripQuotedHtml(body);
+    const htmlHasQuoted = strippedHtml.length < body.length;
+    const htmlToShow = showQuoted ? body : strippedHtml;
     return (
-      <div className="flex justify-end">
-        <div className="max-w-[80%] rounded-2xl px-4 py-3 text-sm bg-brand-600 text-white rounded-br-sm">
-          <p className="text-xs mb-1 font-medium text-brand-200">You</p>
-          <p className="whitespace-pre-wrap leading-relaxed break-words">{cleanBody(body)}</p>
+      <div>
+        <p className="text-xs font-medium text-surface-400 px-1 mb-1">{message.from_email}</p>
+        <div className="bg-white border border-surface-200 rounded-xl overflow-hidden">
+          <EmailHtmlFrame
+            key={showQuoted ? "full" : "collapsed"}
+            html={htmlToShow}
+            minHeight={htmlHasQuoted && !showQuoted ? 96 : undefined}
+          />
         </div>
+        {htmlHasQuoted && (
+          <button
+            onClick={() => setShowQuoted((v) => !v)}
+            aria-label={showQuoted ? "Hide quoted text" : "Show quoted text"}
+            title={showQuoted ? "Hide quoted text" : "Show quoted text"}
+            className="mt-1.5 inline-flex items-center justify-center h-5 px-1.5 rounded bg-surface-200 text-surface-500 hover:bg-surface-300"
+          >
+            <MoreHorizontal className="w-4 h-4" />
+          </button>
+        )}
       </div>
     );
   }
 
-  if (isHtml) {
+  const cleaned = cleanBody(body);
+  const visible = stripQuotedText(cleaned);
+  const hasQuoted = visible.length < cleaned.length;
+  const display = showQuoted ? cleaned : visible;
+
+  const toggle = hasQuoted && (
+    <button
+      onClick={() => setShowQuoted((v) => !v)}
+      aria-label={showQuoted ? "Hide quoted text" : "Show quoted text"}
+      title={showQuoted ? "Hide quoted text" : "Show quoted text"}
+      className={
+        "mt-1.5 inline-flex items-center justify-center h-5 px-1.5 rounded " +
+        (isOutbound
+          ? "bg-white/20 text-brand-100 hover:bg-white/30"
+          : "bg-surface-200 text-surface-500 hover:bg-surface-300")
+      }
+    >
+      <MoreHorizontal className="w-4 h-4" />
+    </button>
+  );
+
+  if (isOutbound) {
     return (
-      <div>
-        <p className="text-xs font-medium text-surface-400 px-1 mb-1">{message.from_email}</p>
-        <div className="bg-white border border-surface-200 rounded-xl overflow-hidden">
-          <EmailHtmlFrame html={body} />
+      <div className="flex justify-end">
+        <div className="max-w-[80%] rounded-2xl px-4 py-3 text-sm bg-brand-600 text-white rounded-br-sm">
+          <p className="text-xs mb-1 font-medium text-brand-200">You</p>
+          <p className="whitespace-pre-wrap leading-relaxed break-words">{display}</p>
+          {toggle}
         </div>
       </div>
     );
@@ -76,7 +177,8 @@ export function MessageBubble({ message }: { message: EmailMessage }) {
     <div className="flex justify-start">
       <div className="max-w-[80%] rounded-2xl px-4 py-3 text-sm bg-white border border-surface-200 text-surface-800 rounded-bl-sm">
         <p className="text-xs mb-1 font-medium text-surface-400">{message.from_email}</p>
-        <p className="whitespace-pre-wrap leading-relaxed break-words">{cleanBody(body)}</p>
+        <p className="whitespace-pre-wrap leading-relaxed break-words">{display}</p>
+        {toggle}
       </div>
     </div>
   );
diff --git a/src/app/inbox/page.tsx b/src/app/inbox/page.tsx
index d851708..26102bd 100644
--- a/src/app/inbox/page.tsx
+++ b/src/app/inbox/page.tsx
@@ -1,7 +1,7 @@
 "use client";
 
-import { useState, useEffect, useCallback } from "react";
-import { Button, Badge } from "@/components/ui";
+import { useState, useEffect, useCallback, useRef } from "react";
+import { Button } from "@/components/ui";
 import { listThreads, getThreadDetail, archiveThread } from "@/app/actions/threads";
 import { cn } from "@/lib/utils";
 import type { EmailThread } from "@/lib/types";
@@ -11,20 +11,23 @@ import { ThreadView } from "./components/ThreadView";
 
 // ─── Helpers ────────────────────────────────────────────────────────────────
 
-function timeAgo(dateStr: string | null): string {
+// Gmail-style received timestamp: clock time for today, "Mon D" for the current
+// year, and "M/D/YY" for older messages.
+function formatReceived(dateStr: string | null): string {
   if (!dateStr) return "";
-  const diff = Date.now() - new Date(dateStr).getTime();
-  const mins = Math.floor(diff / 60000);
-  if (mins < 60) return `${mins}m ago`;
-  const hrs = Math.floor(mins / 60);
-  if (hrs < 24) return `${hrs}h ago`;
-  return `${Math.floor(hrs / 24)}d ago`;
-}
-
-function statusBadge(status: EmailThread["status"]) {
-  if (status === "replied") return <Badge variant="success">Replied</Badge>;
-  if (status === "unread") return <Badge variant="brand">New</Badge>;
-  return null;
+  const date = new Date(dateStr);
+  const now = new Date();
+  const sameDay =
+    date.getFullYear() === now.getFullYear() &&
+    date.getMonth() === now.getMonth() &&
+    date.getDate() === now.getDate();
+  if (sameDay) {
+    return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
+  }
+  if (date.getFullYear() === now.getFullYear()) {
+    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
+  }
+  return date.toLocaleDateString(undefined, { month: "numeric", day: "numeric", year: "2-digit" });
 }
 
 // ─── Main page ───────────────────────────────────────────────────────────────
@@ -37,32 +40,51 @@ export default function InboxPage() {
   const [detail, setDetail] = useState<EmailThread | null>(null);
   const [loadingThreads, setLoadingThreads] = useState(true);
   const [loadingMore, setLoadingMore] = useState(false);
-  const [pageSize, setPageSize] = useState(PAGE_SIZE);
+  const [limit, setLimit] = useState(PAGE_SIZE);
+  const [hasMore, setHasMore] = useState(true);
   const [syncing, setSyncing] = useState(false);
   const [syncError, setSyncError] = useState<string | null>(null);
   const [mobileView, setMobileView] = useState<"list" | "thread">("list");
 
-  const loadThreads = useCallback(async (limit: number) => {
-    const data = await listThreads(limit);
+  const scrollRef = useRef<HTMLDivElement | null>(null);
+  const sentinelRef = useRef<HTMLDivElement | null>(null);
+
+  const loadThreads = useCallback(async (lim: number) => {
+    const data = await listThreads(lim);
     setThreads(data);
+    setHasMore(data.length === lim);
     return data.length;
   }, []);
 
+  // Load the current window whenever the limit grows (initial load + infinite
+  // scroll). The first page shows the full-pane spinner; later pages show the
+  // inline "loading more" row so the feed stays continuous.
   useEffect(() => {
-    setLoadingThreads(true);
-    loadThreads(PAGE_SIZE).finally(() => setLoadingThreads(false));
-  }, [loadThreads]);
-
-  const handleShowMore = async () => {
-    const next = pageSize + PAGE_SIZE;
-    setLoadingMore(true);
-    try {
-      const returned = await loadThreads(next);
-      setPageSize(returned < next ? returned : next);
-    } finally {
+    const initial = limit === PAGE_SIZE;
+    if (initial) setLoadingThreads(true);
+    else setLoadingMore(true);
+    loadThreads(limit).finally(() => {
+      setLoadingThreads(false);
       setLoadingMore(false);
-    }
-  };
+    });
+  }, [limit, loadThreads]);
+
+  // Infinite scroll: when the bottom sentinel scrolls into view and more rows
+  // may exist, grow the window. No buttons, no page breaks.
+  useEffect(() => {
+    const sentinel = sentinelRef.current;
+    if (!sentinel) return;
+    const observer = new IntersectionObserver(
+      (entries) => {
+        if (entries[0].isIntersecting && hasMore && !loadingMore && !loadingThreads) {
+          setLimit((l) => l + PAGE_SIZE);
+        }
+      },
+      { root: scrollRef.current, rootMargin: "300px" }
+    );
+    observer.observe(sentinel);
+    return () => observer.disconnect();
+  }, [hasMore, loadingMore, loadingThreads, threads.length]);
 
   const handleSync = async () => {
     setSyncing(true);
@@ -77,7 +99,7 @@ export default function InboxPage() {
       } else {
         console.log("[gmail/sync] ok", body);
       }
-      await loadThreads(pageSize);
+      await loadThreads(limit);
     } catch (err) {
       console.error("[gmail/sync] network error", err);
       setSyncError(err instanceof Error ? err.message : "Network error");
@@ -109,7 +131,7 @@ export default function InboxPage() {
       const data = await getThreadDetail(selectedId);
       setDetail(data);
     }
-    await loadThreads(pageSize);
+    await loadThreads(limit);
   };
 
   return (
@@ -151,41 +173,52 @@ export default function InboxPage() {
         ) : threads.length === 0 ? (
           <EmptyInbox onSync={handleSync} syncing={syncing} />
         ) : (
-          <div className="flex-1 min-h-0 overflow-y-auto">
-            {threads.map((thread) => (
-              <button
-                key={thread.id}
-                onClick={() => handleSelectThread(thread)}
-                className={cn(
-                  "w-full text-left px-4 py-4 border-b border-surface-50 hover:bg-surface-50 transition-colors",
-                  selectedId === thread.id && "bg-brand-50 border-l-2 border-l-brand-500"
-                )}
-              >
-                <div className="flex items-start justify-between gap-2 mb-1">
-                  <span className="font-medium text-surface-900 text-sm truncate">
-                    {senderName(thread)}
-                  </span>
-                  <span className="text-xs text-surface-400 shrink-0">
-                    {timeAgo(thread.last_message_at)}
-                  </span>
-                </div>
-                <div className="flex items-center justify-between gap-2">
-                  <p className="text-sm text-surface-600 truncate">{thread.subject}</p>
-                  {statusBadge(thread.status)}
-                </div>
-              </button>
-            ))}
-            {threads.length >= pageSize && (
-              <div className="p-3 border-b border-surface-50">
-                <Button
-                  variant="ghost"
-                  size="sm"
-                  loading={loadingMore}
-                  onClick={handleShowMore}
-                  className="w-full"
+          <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto">
+            {threads.map((thread) => {
+              const unread = thread.status === "unread";
+              return (
+                <button
+                  key={thread.id}
+                  onClick={() => handleSelectThread(thread)}
+                  className={cn(
+                    "w-full text-left px-4 py-3 border-b border-surface-50 hover:bg-surface-50 transition-colors",
+                    selectedId === thread.id && "bg-brand-50 border-l-2 border-l-brand-500"
+                  )}
                 >
-                  Show more
-                </Button>
+                  <div className="flex items-baseline justify-between gap-2 mb-0.5">
+                    <span
+                      className={cn(
+                        "text-sm truncate",
+                        unread ? "font-semibold text-surface-900" : "font-normal text-surface-700"
+                      )}
+                    >
+                      {senderName(thread)}
+                    </span>
+                    <span
+                      className={cn(
+                        "text-xs shrink-0",
+                        unread ? "text-surface-600 font-medium" : "text-surface-400"
+                      )}
+                    >
+                      {formatReceived(thread.last_message_at)}
+                    </span>
+                  </div>
+                  <p
+                    className={cn(
+                      "text-sm truncate",
+                      unread ? "font-medium text-surface-800" : "text-surface-600"
+                    )}
+                  >
+                    {thread.subject || "(no subject)"}
+                  </p>
+                </button>
+              );
+            })}
+            {/* Infinite-scroll trigger + loading row; keeps the feed continuous */}
+            <div ref={sentinelRef} aria-hidden className="h-px" />
+            {loadingMore && (
+              <div className="flex justify-center py-4">
+                <div className="w-4 h-4 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
               </div>
             )}
           </div>
diff --git a/src/app/settings/page.tsx b/src/app/settings/page.tsx
index 7e34da5..b4d8b88 100644
--- a/src/app/settings/page.tsx
+++ b/src/app/settings/page.tsx
@@ -3,9 +3,17 @@
 import { useState, useEffect } from "react";
 import { Card, CardTitle, CardDescription, Button, Input, Textarea } from "@/components/ui";
 import { getGymSettings, saveGymSettings, disconnectGmail } from "@/app/actions/gym-settings";
-import { Save, Building2, Mail, CheckCircle2, AlertCircle, Sparkles, Plus } from "lucide-react";
+import { Save, Building2, Mail, CheckCircle2, AlertCircle, Sparkles, Plus, Trash2 } from "lucide-react";
 import type { GymSettings } from "@/lib/types";
 
+interface StyleSample {
+  id: string;
+  clean_body: string;
+  word_count: number;
+  context_cluster: string | null;
+  created_at: string;
+}
+
 export default function SettingsPage() {
   const [settings, setSettings] = useState<GymSettings | null>(null);
   const [gymName, setGymName] = useState("");
@@ -16,10 +24,19 @@ export default function SettingsPage() {
 
   // Style examples
   const [sampleCount, setSampleCount] = useState<number | null>(null);
+  const [examples, setExamples] = useState<StyleSample[]>([]);
   const [exampleText, setExampleText] = useState("");
   const [addingExample, setAddingExample] = useState(false);
   const [exampleAdded, setExampleAdded] = useState(false);
   const [exampleError, setExampleError] = useState<string | null>(null);
+  const [removingId, setRemovingId] = useState<string | null>(null);
+
+  const loadExamples = () => {
+    fetch("/api/style/samples")
+      .then((r) => r.json())
+      .then((d) => setExamples(d.samples ?? []))
+      .catch(() => setExamples([]));
+  };
 
   useEffect(() => {
     getGymSettings().then((s) => {
@@ -35,6 +52,8 @@ export default function SettingsPage() {
       .then((d) => setSampleCount(d.sampleCount ?? 0))
       .catch(() => setSampleCount(0));
 
+    loadExamples();
+
     // Handle OAuth result query params
     const params = new URLSearchParams(window.location.search);
     if (params.get("connected") === "true") {
@@ -72,9 +91,29 @@ export default function SettingsPage() {
     setExampleText("");
     setSampleCount(data.sampleCount);
     setExampleAdded(true);
+    loadExamples();
     setTimeout(() => setExampleAdded(false), 3000);
   };
 
+  const handleRemoveExample = async (id: string) => {
+    setRemovingId(id);
+    setExampleError(null);
+    try {
+      const res = await fetch(`/api/style/samples?id=${id}`, { method: "DELETE" });
+      const data = await res.json().catch(() => null);
+      if (!res.ok || !data?.ok) {
+        setExampleError(data?.error || `Remove failed (HTTP ${res.status})`);
+        return;
+      }
+      setExamples((prev) => prev.filter((e) => e.id !== id));
+      setSampleCount(data.sampleCount);
+    } catch (err) {
+      setExampleError(`Network error: ${err instanceof Error ? err.message : String(err)}`);
+    } finally {
+      setRemovingId(null);
+    }
+  };
+
   const handleSave = async () => {
     setSaving(true);
     await saveGymSettings(gymName, gymContext);
@@ -209,6 +248,42 @@ Coach Martin`}
           >
             Save Example
           </Button>
+
+          {examples.length > 0 && (
+            <div className="space-y-2 pt-4 border-t border-surface-100">
+              <p className="text-xs font-medium text-surface-500">
+                Your examples — the AI draws on these when drafting replies
+              </p>
+              {examples.map((ex) => (
+                <div
+                  key={ex.id}
+                  className="flex items-start gap-3 p-3 rounded-xl border border-surface-200 bg-surface-50"
+                >
+                  <div className="min-w-0 flex-1">
+                    <p className="text-sm text-surface-700 whitespace-pre-wrap line-clamp-3">
+                      {ex.clean_body}
+                    </p>
+                    <p className="text-xs text-surface-400 mt-1">
+                      {ex.word_count} words
+                      {ex.context_cluster ? ` · ${ex.context_cluster.replace("_", " ")}` : ""}
+                    </p>
+                  </div>
+                  <button
+                    onClick={() => handleRemoveExample(ex.id)}
+                    disabled={removingId === ex.id}
+                    aria-label="Remove example"
+                    className="shrink-0 text-surface-400 hover:text-red-600 disabled:opacity-40 transition-colors p-1"
+                  >
+                    {removingId === ex.id ? (
+                      <div className="w-4 h-4 border-2 border-surface-300 border-t-transparent rounded-full animate-spin" />
+                    ) : (
+                      <Trash2 className="w-4 h-4" />
+                    )}
+                  </button>
+                </div>
+              ))}
+            </div>
+          )}
         </div>
       </Card>
 
diff --git a/src/lib/style-memory.ts b/src/lib/style-memory.ts
index 7a92c8a..9d9538b 100644
--- a/src/lib/style-memory.ts
+++ b/src/lib/style-memory.ts
@@ -259,7 +259,24 @@ export async function updateStyleProfile(
       .order("created_at", { ascending: false })
       .limit(100);
 
-    if (!samples?.length) return;
+    // No samples left (e.g. the user removed them all) — reset the profile to
+    // zero so retrieveStyleContext stops injecting a stale voice into drafts.
+    if (!samples?.length) {
+      await supabase.from("style_profile").upsert(
+        {
+          user_id:          userId,
+          sample_count:     0,
+          avg_word_count:   0,
+          tone_score:       0.5,
+          uses_bullets:     false,
+          common_greetings: [],
+          common_signoffs:  [],
+          updated_at:       new Date().toISOString(),
+        },
+        { onConflict: "user_id" }
+      );
+      return;
+    }
 
     const tones       = samples.map((s) => computeToneScore(s.clean_body));
     const avgTone     = tones.reduce((a, b) => a + b, 0) / tones.length;
diff --git a/src/lib/types.ts b/src/lib/types.ts
index 494d71c..55b67f7 100644
--- a/src/lib/types.ts
+++ b/src/lib/types.ts
@@ -35,6 +35,7 @@ export interface EmailThread {
   subject: string | null;
   status: "unread" | "pending_reply" | "replied" | "archived";
   last_message_at: string | null;
+  gmail_history_id: string | null;
   created_at: string;
   contact?: Contact | null;
   messages?: EmailMessage[];
diff --git a/supabase/schema.sql b/supabase/schema.sql
index 0062242..b855262 100644
--- a/supabase/schema.sql
+++ b/supabase/schema.sql
@@ -49,10 +49,15 @@ create table if not exists email_threads (
   subject           text,
   status            text check (status in ('unread','pending_reply','replied','archived')) default 'unread',
   last_message_at   timestamptz,
+  gmail_history_id  text,
   created_at        timestamptz default now(),
   unique (user_id, gmail_thread_id)
 );
 
+-- Per-thread Gmail historyId. Lets sync skip threads that have not changed
+-- since the last run instead of re-fetching the whole mailbox every time.
+alter table email_threads add column if not exists gmail_history_id text;
+
 alter table email_threads enable row level security;
 create policy "users own their email_threads"
   on email_threads for all

commit ad928cf3fae0767499edee54fb3d8d417c712e90
Author: Martin Lam <martinlam16061@gmail.com>
Date:   Thu Jun 4 19:06:07 2026 -0700

    fix: wire ai_generations insert and fix generate button
    
    - Add maxDuration = 60 to gmail/sync route
    - Add < 200 guard to auto-archive block
    - Insert ai_generations row on generate with correct column names
    - Fix Button.tsx defaulting to type="submit" causing silent form submission
    - Add try/catch to ThreadView handleGenerate to prevent stuck spinner

diff --git a/src/app/api/ai/generate/route.ts b/src/app/api/ai/generate/route.ts
index 73703c5..1441815 100644
--- a/src/app/api/ai/generate/route.ts
+++ b/src/app/api/ai/generate/route.ts
@@ -51,7 +51,7 @@ export async function POST(request: Request) {
     );
   }
 
-  const { subject, messages } = await request.json() as {
+  const { threadId, subject, messages } = await request.json() as {
     threadId: string;
     subject: string;
     messages: EmailMessage[];
@@ -124,7 +124,15 @@ Return only the reply body text. Do not reproduce XML tags in your response.`;
     });
 
     const replyBody = stripFences(result.response.text() || "").trim();
-    return NextResponse.json({ generation: null, subject: `Re: ${cleanSubject}`, body: replyBody });
+    const { data: gen, error: insertError } = await supabase
+      .from("ai_generations")
+      .insert({ user_id: user.id, thread_id: threadId, type: "reply", generated_body: replyBody, status: "pending" })
+      .select("*")
+      .single();
+    if (insertError) {
+      console.error("[generate] insert failed", insertError.message);
+    }
+    return NextResponse.json({ generation: gen ?? null, subject: `Re: ${cleanSubject}`, body: replyBody });
   } catch (err) {
     console.error("[generate] LLM error:", err);
     return NextResponse.json(
diff --git a/src/app/api/gmail/sync/route.ts b/src/app/api/gmail/sync/route.ts
index 9adc65c..e1c483d 100644
--- a/src/app/api/gmail/sync/route.ts
+++ b/src/app/api/gmail/sync/route.ts
@@ -5,6 +5,8 @@ import { requirePaidUser } from "@/lib/subscription";
 import { decryptToken } from "@/lib/token-crypto";
 import type { gmail_v1 } from "googleapis";
 
+export const maxDuration = 60;
+
 // ─── MIME helpers ─────────────────────────────────────────────────────────────
 
 function decode(data: string): string {
@@ -359,7 +361,7 @@ export async function POST() {
     // query never looked at it, so we can't conclude it has left Primary.
     const syncedThreadIds = threads.map((t) => t.id).filter((id): id is string => !!id);
     let archived = 0;
-    if (syncedThreadIds.length) {
+    if (threads.length < 200 && syncedThreadIds.length) {
       // Reject any ID that is not a plain hex string (Gmail's documented format)
       // before interpolating into the PostgREST filter string.
       const safeIds = syncedThreadIds.filter((id) => /^[0-9a-f]+$/i.test(id));
diff --git a/src/app/inbox/components/ThreadView.tsx b/src/app/inbox/components/ThreadView.tsx
index f6b56ba..9ac87b8 100644
--- a/src/app/inbox/components/ThreadView.tsx
+++ b/src/app/inbox/components/ThreadView.tsx
@@ -40,22 +40,28 @@ export function ThreadView({
     setDraftBody("");
     setGenerateError(null);
 
-    const res = await fetch("/api/ai/generate", {
-      method: "POST",
-      headers: { "Content-Type": "application/json" },
-      body: JSON.stringify({ threadId: thread.id, subject: thread.subject, messages }),
-    });
-
-    const data = await res.json().catch(() => null);
-    setGeneration(data?.generation ?? null);
-    setDraftBody(data?.body || "");
-    if (!res.ok || data?.error || !data?.body) {
-      setGenerateError(
-        (typeof data?.error === "string" && data.error) ||
-          `Failed to generate a draft (HTTP ${res.status}). Try again.`
-      );
+    try {
+      const res = await fetch("/api/ai/generate", {
+        method: "POST",
+        headers: { "Content-Type": "application/json" },
+        body: JSON.stringify({ threadId: thread.id, subject: thread.subject, messages }),
+      });
+
+      const data = await res.json().catch(() => null);
+      // generation is a full AIGeneration object (or null when insert failed)
+      setGeneration(data?.generation ?? null);
+      setDraftBody(data?.body || "");
+      if (!res.ok || data?.error || !data?.body) {
+        setGenerateError(
+          (typeof data?.error === "string" && data.error) ||
+            `Failed to generate a draft (HTTP ${res.status}). Try again.`
+        );
+      }
+    } catch {
+      setGenerateError("Failed to reach the server. Check your connection.");
+    } finally {
+      setGenerating(false);
     }
-    setGenerating(false);
   };
 
   const handleSend = async () => {
diff --git a/src/components/ui/Button.tsx b/src/components/ui/Button.tsx
index 36f88f7..bb8c902 100644
--- a/src/components/ui/Button.tsx
+++ b/src/components/ui/Button.tsx
@@ -39,11 +39,13 @@ export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function
   children,
   className,
   disabled,
+  type = "button",
   ...props
 }: ButtonProps, ref) {
   return (
     <button
       ref={ref}
+      type={type}
       className={cn(
         "inline-flex items-center justify-center font-medium transition-all duration-200 cursor-pointer",
         "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2",

commit bffa773018be9176a65f35a0f1b793b7dc55e6bc
Author: Martin Lam <martinlam16061@gmail.com>
Date:   Thu Jun 4 22:30:24 2026 -0700

    fix: gate approveGeneration with requirePaidUser and enforceDailyLimit

diff --git a/src/app/actions/ai-generations.ts b/src/app/actions/ai-generations.ts
index a1fb344..12039b7 100644
--- a/src/app/actions/ai-generations.ts
+++ b/src/app/actions/ai-generations.ts
@@ -1,6 +1,8 @@
 "use server";
 
 import { createClient } from "@/lib/supabase/server";
+import { requirePaidUser } from "@/lib/subscription";
+import { enforceDailyLimit } from "@/lib/usage-limits";
 import { addStyleSample, updateStyleProfile } from "@/lib/style-memory";
 import { revalidatePath } from "next/cache";
 
@@ -10,8 +12,12 @@ export async function approveGeneration(
   generationId?: string | null
 ): Promise<void> {
   const supabase = await createClient();
-  const { data: { user } } = await supabase.auth.getUser();
-  if (!user) return;
+  const auth = await requirePaidUser(supabase);
+  if (!auth.ok) return;
+  const user = auth.user;
+
+  const limit = await enforceDailyLimit(supabase, "add_sample");
+  if (!limit.allowed) return;
 
   // Only update a generation row if one actually exists. Fresh drafts from
   // /api/ai/generate don't persist a row, so generationId is often null —
