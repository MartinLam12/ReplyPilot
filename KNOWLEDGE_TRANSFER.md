# ReplyPilot — Complete Knowledge-Transfer Document

> **Audience:** An engineer who has never seen this project.
> **Scope:** Documents the system *as it currently exists*. No improvements are suggested.
> **Method:** Every non-obvious claim cites the file(s) it came from. Confidence is labelled **[High]**, **[Medium]**, or **[Low]**. Where something cannot be determined from the code, it says so explicitly.
> **Generated from:** a full read of `src/`, `supabase/`, root config, and the build manifest.
> **Last revised:** 2026-06-04, after the **Stripe subscription / billing** change set. This revision adds the payments subsystem (Stripe Checkout + webhook), **subscription gating in middleware**, the new `profiles` table and its auto-create trigger, **AES-256-GCM encryption of Gmail refresh tokens at rest** (`token-crypto.ts`), **Cloudflare Turnstile** captcha on login/signup, and the **first use of the Supabase service-role key** (in the Stripe webhook). The earlier 2026-06-02 baseline (inbox component split, incremental Gmail sync, feedback-weighted style retrieval, style-example management, single middleware, dep pruning) is retained and still accurate.

---

## Table of Contents

1. Executive Summary
2. Technology Stack
3. Complete Folder Structure Analysis
4. System Architecture
5. Application Startup Flow
6. User Journey Analysis
7. Frontend Deep Dive
8. Backend Deep Dive
9. Database Deep Dive
10. State Management Deep Dive
11. Authentication & Authorization
12. External Integrations
13. Feature Inventory
14. File Dependency Map (Top 50)
15. Data Flow Analysis
16. Security Architecture
17. Performance Architecture
18. Technical Debt Inventory
19. New Engineer Onboarding Guide
20. Glossary

---

# 1. Executive Summary

**What it does.** ReplyPilot is an AI-assisted email tool for boxing / martial-arts gym owners. It connects to the gym's Gmail, pulls in recent inbox conversations, and lets the owner generate an AI-drafted reply for each thread with one click. The AI follows gym-specific "reply rules" (pricing, hours, policies) the owner writes once, and it learns the owner's personal writing voice over time so drafts increasingly "sound like you." It also keeps a lightweight CRM of everyone who has emailed the gym. Source: [README.md](README.md#L1-L18), [AGENTS.md](AGENTS.md).

**The core problem it solves.** A gym owner spends a lot of time answering repetitive lead and member emails. ReplyPilot reduces each reply to: read the thread → click "Suggest a Reply" → lightly edit → send. The reply already obeys the gym's rules and matches the owner's tone, so it needs minimal editing.

**Who the users are.** Gym owners/coaches. The README states it was "Built for a gym with 2 locations" ([README.md:7](README.md#L7)), and the usage-limit defaults are explicitly "sized for a single trusted client" ([src/lib/usage-limits.ts:12-18](src/lib/usage-limits.ts#L12-L18)). **[High]** The data model and auth are per-user, and the product now has the scaffolding of a **paid multi-tenant SaaS**: open self-serve signup (with a Cloudflare Turnstile captcha), a **Stripe subscription paywall** that gates every app page, and a per-user `profiles` table tracking subscription state. So while the *operational* footprint may still be small, the code is no longer single-tenant-by-construction — anyone can sign up, but **no one reaches the app without an active subscription** ([middleware.ts:96-114](middleware.ts#L96-L114)). **[High]**

**Major features.**
1. **Gmail sync** — pull last-14-day Primary-category inbox threads ([src/app/api/gmail/sync/route.ts](src/app/api/gmail/sync/route.ts)).
2. **AI reply generation** — Gemini draft, style-aware and rule-aware ([src/app/api/ai/generate/route.ts](src/app/api/ai/generate/route.ts)).
3. **Style learning** — retrieval-based personalization from past replies ([src/lib/style-memory.ts](src/lib/style-memory.ts)).
4. **Send replies** — via Gmail API in the original thread ([src/app/api/gmail/send/route.ts](src/app/api/gmail/send/route.ts)).
5. **Contacts CRM** — auto-created from senders; lead/trial/member/inactive ([src/app/contacts/page.tsx](src/app/contacts/page.tsx)).
6. **Settings** — gym rules, Gmail connection, manual style examples ([src/app/settings/page.tsx](src/app/settings/page.tsx)).
7. **Auth** — email/password via Supabase, protected by a Cloudflare Turnstile captcha ([src/app/login/page.tsx](src/app/login/page.tsx), [src/app/signup/page.tsx](src/app/signup/page.tsx)).
8. **Daily usage caps** — soft per-user limits on billed AI endpoints ([src/lib/usage-limits.ts](src/lib/usage-limits.ts)).
9. **Subscription billing / paywall** — Stripe Checkout subscription, a webhook that records status into `profiles`, and a middleware gate that redirects un-subscribed users to `/subscribe` ([src/app/api/stripe/](src/app/api/stripe/), [middleware.ts](middleware.ts), [src/app/subscribe/page.tsx](src/app/subscribe/page.tsx)).

**Overall architecture style.** A **single Next.js 16 App Router application** that is its own frontend *and* backend. The "backend" is split between **Server Actions** (first-party CRUD) and **Route Handlers** (external integrations + HTTP endpoints). **Supabase Postgres** is the database, with **Row-Level Security (RLS) as the authorization boundary** — with one deliberate exception: the Stripe webhook uses the **service-role key** (which bypasses RLS) to write subscription state, because it runs with no user session. **Google Gemini** (generation + embeddings), the **Gmail API**, **Stripe** (billing), and **Cloudflare Turnstile** (captcha) are the external services. Deployed on **Vercel**. It is a feature-based, layered monolith — there is no separate API server or microservices. **[High]**

**Day-one mental model for a new engineer:** "A Next.js app where pages are thin clients that call Server Actions for CRUD and `fetch()` API routes for AI/Gmail. Security is enforced in the database (RLS), not in app code. The clever part is `style-memory.ts`."

---

# 2. Technology Stack

Source for all versions: [package.json](package.json).

### Frontend
| Tech | Why it exists | Where used | Responsibility |
|---|---|---|---|
| **Next.js 16.2.2 (App Router)** | Full-stack React framework | Entire app under [src/app/](src/app/) | Routing, SSR/RSC, Server Actions, Route Handlers, middleware |
| **React 19.2.4** | UI rendering | All `*.tsx` | Component model, hooks, context |
| **TypeScript 5** | Type safety | Whole codebase | Compile-time correctness; domain types in [src/lib/types.ts](src/lib/types.ts) |
| **Tailwind CSS 4** | Utility-first styling | All components; tokens in [tailwind.config.ts](tailwind.config.ts), [src/app/globals.css](src/app/globals.css) | Styling via class names; custom `brand`/`surface`/`success` color scales |
| **lucide-react** | Icon set | Navbar, pages, buttons | SVG icons |
| **clsx** (via `cn()`) | Conditional class merging | [src/lib/utils.ts](src/lib/utils.ts#L3) | Compose Tailwind class strings |
| **@marsidev/react-turnstile** | Cloudflare Turnstile widget | [login](src/app/login/page.tsx#L8), [signup](src/app/signup/page.tsx#L8) | Renders the captcha; token passed to Supabase `signUp`/`signInWithPassword` as `captchaToken` |

> The runtime dependency list is 11 packages (see [package.json](package.json)): `@google/generative-ai`, `@marsidev/react-turnstile`, `@supabase/ssr`, `@supabase/supabase-js`, `clsx`, `googleapis`, `lucide-react`, `next`, `react`, `react-dom`, `stripe`. The earlier leftovers `framer-motion`/`recharts` were removed (commit `99a72c7`); `stripe` and `@marsidev/react-turnstile` were **added** in the billing/captcha work. Token encryption uses Node's built-in `crypto` (no dependency). **[High]**

### Backend (within Next.js)
| Tech | Why | Where | Responsibility |
|---|---|---|---|
| **Next.js Server Actions** (`"use server"`) | Typed RPC-like server calls from client | [src/app/actions/](src/app/actions/) | First-party CRUD (threads, contacts, gym settings, generations) |
| **Next.js Route Handlers** | HTTP endpoints | [src/app/api/](src/app/api/) | Gmail OAuth/sync/send, AI generate, style endpoints, auth callback |
| **Next.js Middleware** (Edge) | Per-request interception | [middleware.ts](middleware.ts) (root) | Session refresh, route guards, CSP nonce |

### Database
| Tech | Why | Where | Responsibility |
|---|---|---|---|
| **Supabase Postgres** | Managed Postgres + auth + RLS | [supabase/*.sql](supabase/) | All persistent data |
| **pgvector** | Vector similarity search | [supabase/style-memory-schema.sql:6](supabase/style-memory-schema.sql#L6) | Store 768-dim embeddings; cosine kNN for style retrieval |
| **Postgres functions (RPC)** | Server-side logic under RLS | `match_style_samples`, `apply_style_feedback`, `increment_usage` | Vector search, feedback weighting, atomic usage counting |

### Authentication
| Tech | Why | Where | Responsibility |
|---|---|---|---|
| **Supabase Auth** | Email/password identity | [src/lib/supabase/](src/lib/supabase/), middleware, login/signup pages | User identity, cookie sessions, `auth.uid()` for RLS |
| **Cloudflare Turnstile** | Bot/abuse protection on auth | [login](src/app/login/page.tsx), [signup](src/app/signup/page.tsx) | Client widget yields a token; **verification happens inside Supabase Auth** (configured server-side in the Supabase project), not in app code |
| **Google OAuth 2.0** (separate) | Gmail access | [src/app/api/gmail/auth/route.ts](src/app/api/gmail/auth/route.ts), [callback](src/app/api/gmail/callback/route.ts) | Obtain Gmail refresh token (read/send/modify scopes); token **encrypted at rest** via [token-crypto.ts](src/lib/token-crypto.ts) |

### State management
| Tech | Why | Where | Responsibility |
|---|---|---|---|
| **React Context** | Global auth state | [src/lib/user-context.tsx](src/lib/user-context.tsx) | Expose current user/profile/`signOut` to the UI tree |
| **React `useState`/`useEffect`** | Local component state | Every page | Per-page data, loading flags, form fields |

> There is **no Redux/Zustand/React Query/SWR**. **[High]**

### UI libraries
- In-house design system in [src/components/ui/](src/components/ui/): `Button`, `Card`(+`CardTitle`/`CardDescription`), `Input`/`Textarea`/`Select`, `Badge` — all actively used. Barrel: [index.ts](src/components/ui/index.ts).
- The previously-unused primitives `ProgressBar`, `ScoreRing`, `Stepper`, `ToggleChip` were **removed** (commit `1439110`). The `ui/` folder now contains only what's imported. **[High]**

### Third-party services
- **Google Gemini** — `gemini-2.5-flash-lite` (generation) and `gemini-embedding-001` (embeddings). [src/app/api/ai/generate/route.ts:103](src/app/api/ai/generate/route.ts#L103), [src/lib/style-memory.ts:171](src/lib/style-memory.ts#L171).
- **Gmail API** (`googleapis`) — read threads, send messages.
- **Stripe** (`stripe`) — subscription Checkout sessions ([api/stripe/checkout](src/app/api/stripe/checkout/route.ts)) and event webhook ([api/stripe/webhook](src/app/api/stripe/webhook/route.ts)). Uses the default API version pinned by the installed `stripe@^22` SDK (no explicit `apiVersion` passed).
- **Cloudflare Turnstile** — captcha on login/signup, verified by Supabase Auth.

### Build tools
- **Next.js build** (`next build`/`next dev`) — uses **Turbopack** in dev (visible in build chunk names in [.next/dev/server/middleware-manifest.json](.next/dev/server/middleware-manifest.json)). **[High]**
- **ESLint 9** + `eslint-config-next` ([eslint.config.mjs](eslint.config.mjs)).
- **Jest 30 + ts-jest** ([jest.config.ts](jest.config.ts)), `testEnvironment: node`.
- **PostCSS** + `@tailwindcss/postcss` ([postcss.config.mjs](postcss.config.mjs)).

### Deployment
- **Vercel** ([README.md:32](README.md#L32); `.vercel/` present). Function-timeout awareness is baked into the code (e.g. backfill batches of 20, [src/app/api/style/backfill/route.ts:17](src/app/api/style/backfill/route.ts#L17)).

> **Not part of the app:** `ruvector.db`, `.swarm/`, `.claude-flow/`, `.mcp.json`, `.venv/`, `test-gemini.mjs` are local AI-tooling artifacts, not application code. **[Medium]** (`test-gemini.mjs` appears to be a one-off Gemini connectivity script.)

---

# 3. Complete Folder Structure Analysis

```
ReplyPilot/
├── src/
│   ├── app/                  ← App Router: pages + API + actions
│   │   ├── actions/          ← Server Actions (first-party CRUD)
│   │   ├── api/              ← Route Handlers (external + HTTP): gmail/, ai/, style/, stripe/
│   │   ├── subscribe/        ← Paywall page (Stripe Checkout launch)
│   │   ├── auth/callback/    ← Supabase code-exchange handler
│   │   ├── inbox/            ← page.tsx (orchestrator) + components/ + utils.ts
│   │   │   └── components/   ← ThreadView, MessageBubble, EmailHtmlFrame, ReplyPanel, StyleFeedback
│   │   ├── (pages)/          ← dashboard, contacts, settings, login, signup, marketing/legal
│   │   ├── layout.tsx        ← Root layout (server)
│   │   ├── client-layout.tsx ← Client shell (providers + chrome)
│   │   └── globals.css
│   ├── components/
│   │   ├── ui/               ← Design-system primitives (Button, Card, Input, Badge)
│   │   └── layout/           ← Navbar, Footer
│   └── lib/                  ← Domain logic + infra helpers
│       ├── supabase/         ← Supabase client factories
│       ├── style-memory.ts   ← Style-learning engine (the core IP)
│       ├── usage-limits.ts   ← Daily caps
│       ├── subscription.ts   ← Read a user's subscription status from profiles
│       ├── token-crypto.ts   ← AES-256-GCM encrypt/decrypt of Gmail refresh tokens
│       ├── user-context.tsx  ← Auth context
│       ├── types.ts          ← Shared types
│       └── utils.ts          ← cn(), formatDate()
├── supabase/                 ← SQL schema, RLS, RPCs
├── public/                   ← Static assets
├── middleware.ts             ← Middleware (root; the only one — see §4)
├── next.config.ts            ← Security headers
├── tailwind.config.ts, postcss.config.mjs, globals.css
├── jest.config.ts, eslint.config.mjs, tsconfig.json
└── README.md, AGENTS.md, CLAUDE.md
```

### `src/app/` — routes, pages, server endpoints
- **Purpose:** Every URL and every server endpoint. Next.js App Router maps folders → routes.
- **Responsibilities:** UI rendering (pages), server CRUD (`actions/`), HTTP/integration endpoints (`api/`).
- **Important files:** [layout.tsx](src/app/layout.tsx), [client-layout.tsx](src/app/client-layout.tsx), [page.tsx](src/app/page.tsx) (landing), [inbox/page.tsx](src/app/inbox/page.tsx) (the core flow, now ~274 lines after the sub-components were extracted into [inbox/components/](src/app/inbox/components/)).
- **Dependencies:** `components/`, `lib/`, Supabase, Gemini, Gmail.
- **Interactions:** Pages call `actions/` and `fetch()` `api/`. Both call into `lib/` and Supabase.

### `src/app/actions/` — Server Actions
- **Purpose:** Typed server functions callable directly from client components.
- **Files:** [threads.ts](src/app/actions/threads.ts) (list/detail/archive), [contacts.ts](src/app/actions/contacts.ts) (list/upsert/update type), [gym-settings.ts](src/app/actions/gym-settings.ts) (get/save/disconnect Gmail), [ai-generations.ts](src/app/actions/ai-generations.ts) (approve/reject; triggers style learning).
- **Pattern:** each begins `createClient()` → `auth.getUser()` → guard → Supabase query → `revalidatePath()`.
- **Interactions:** Called by `dashboard`, `inbox`, `contacts`, `settings` pages.

### `src/app/api/` — Route Handlers
- **Purpose:** Endpoints needing HTTP semantics or external SDKs.
- **Subfolders:** `gmail/` (auth, callback, sync, send), `ai/generate`, `style/` (add-sample, backfill, feedback, status, **samples** — list/delete examples) + `style/__tests__/`, and **`stripe/`** (`checkout` — creates a Checkout session; `webhook` — applies Stripe events to `profiles` using the service-role client).
- **Interactions:** Called via `fetch()` from pages (or by Stripe, for the webhook); call Gemini/Gmail/Stripe/Supabase and `lib/`.

### `src/app/auth/callback/`
- **Purpose:** Supabase OAuth/email-confirm code exchange ([route.ts](src/app/auth/callback/route.ts)). Distinct from Gmail callback.

### `src/app/inbox/` — the core feature, now componentized
- **Purpose:** The inbox is the only page large enough to warrant its own folder. [page.tsx](src/app/inbox/page.tsx) is the orchestrator (list, selection, sync, pagination, mobile toggle); the rendering/reply UI lives in [components/](src/app/inbox/components/): [ThreadView.tsx](src/app/inbox/components/ThreadView.tsx), [MessageBubble.tsx](src/app/inbox/components/MessageBubble.tsx), [EmailHtmlFrame.tsx](src/app/inbox/components/EmailHtmlFrame.tsx), [ReplyPanel.tsx](src/app/inbox/components/ReplyPanel.tsx), [StyleFeedback.tsx](src/app/inbox/components/StyleFeedback.tsx). Shared helpers (e.g. `senderName`) are in [utils.ts](src/app/inbox/utils.ts).

### `src/components/ui/` — design system
- **Purpose:** Reusable presentational primitives. **Files:** Button, Card, Input/Textarea/Select, Badge — all used. Barrel: [index.ts](src/components/ui/index.ts). (The formerly-unused ProgressBar/ScoreRing/Stepper/ToggleChip were removed.)
- **Dependencies:** `lib/utils.ts` (`cn`), `lib/types.ts` (variant types).

### `src/components/layout/`
- **Purpose:** App chrome. [Navbar.tsx](src/components/layout/Navbar.tsx) renders landing vs app vs (hidden on auth) variants; [Footer.tsx](src/components/layout/Footer.tsx) shown only on landing.
- **Dependencies:** `user-context` (for `useUser`/`signOut`), `ui/Button`.

### `src/lib/` — domain + infra
- **Purpose:** Non-UI logic. **Files:** [style-memory.ts](src/lib/style-memory.ts) (core), [usage-limits.ts](src/lib/usage-limits.ts), [subscription.ts](src/lib/subscription.ts) (reads `profiles.subscription_status`), [token-crypto.ts](src/lib/token-crypto.ts) (AES-256-GCM for Gmail tokens), [user-context.tsx](src/lib/user-context.tsx), [types.ts](src/lib/types.ts), [utils.ts](src/lib/utils.ts), and [supabase/](src/lib/supabase/).
- **`lib/supabase/`:** [client.ts](src/lib/supabase/client.ts) (browser singleton), [server.ts](src/lib/supabase/server.ts) (per-request, cookie-bound). Note: the Stripe webhook constructs its **own** service-role client directly (not via these factories) so it can bypass RLS without a session ([api/stripe/webhook/route.ts:7-11](src/app/api/stripe/webhook/route.ts#L7-L11)).

### `supabase/` — database definition
- **Purpose:** Source of truth for schema, RLS policies, and RPCs (not auto-applied; run manually per [README.md:73-79](README.md#L73-L79)). **Files:** [schema.sql](supabase/schema.sql) (core tables + seed templates), [style-memory-schema.sql](supabase/style-memory-schema.sql) (pgvector tables + RPCs), [usage-limits-schema.sql](supabase/usage-limits-schema.sql) (counters + `increment_usage`).

### Root config
- [middleware.ts](middleware.ts) — the (single, root) middleware (CSP + auth). [next.config.ts](next.config.ts) — static security headers. [tailwind.config.ts](tailwind.config.ts) — design tokens. [jest.config.ts](jest.config.ts) — test config. [tsconfig.json](tsconfig.json) — `@/*` → `src/*` path alias.
- [AGENTS.md](AGENTS.md) — **critical**: documents the security conventions that override normal intuition.

### `public/`
- Static assets (favicons, images). No logic.

---

# 4. System Architecture

### Architectural pattern
Feature-based, layered **Next.js monolith**. Layers:
1. **UI** — client page components ([src/app/*/page.tsx](src/app/)) + design system.
2. **State** — local `useState` per page + one global auth `Context`.
3. **Service/Action** — Server Actions ([src/app/actions/](src/app/actions/)) and the domain library ([src/lib/](src/lib/)).
4. **API** — Route Handlers ([src/app/api/](src/app/api/)).
5. **Data** — Supabase Postgres (RLS) + RPCs.
6. **External** — Gemini, Gmail, Stripe, Cloudflare Turnstile.
7. **Cross-cutting** — Middleware (auth + **subscription gate** + CSP), `next.config.ts` headers.

### Separation of concerns
- **Authorization lives in the database** (RLS), not in app code. [AGENTS.md](AGENTS.md) explicitly forbids redundant `.eq("user_id", …)` filters because RLS already scopes the anon-key client. **[High]** (In practice many call sites still add them — see §18.)
- **One sanctioned RLS bypass: the Stripe webhook.** It has no user session (Stripe calls it server-to-server), so it uses the **service-role key** to write `profiles`. This is the single place RLS is bypassed, and per [AGENTS.md](AGENTS.md) it is exactly the kind of code that "needs review." Its safety rests on Stripe **signature verification** ([webhook:29-37](src/app/api/stripe/webhook/route.ts#L29-L37)) and on only ever writing the `profiles` row matched by `supabase_uid`/`stripe_customer_id`/`subscription_id`.
- **Access control has two layers now:** RLS (data ownership) *and* a **subscription gate** in middleware (un-subscribed authenticated users are bounced from app pages to `/subscribe`).
- **Output validation lives at the sink**, not in middleware — e.g. CRLF header-injection checks happen inside the Gmail send route ([src/app/api/gmail/send/route.ts:14-16](src/app/api/gmail/send/route.ts#L14-L16)), per [AGENTS.md](AGENTS.md).
- **Untrusted email HTML containment lives in an iframe sandbox** ([src/app/inbox/components/EmailHtmlFrame.tsx](src/app/inbox/components/EmailHtmlFrame.tsx)); the regex sanitizer is defence-in-depth only.

### Request flow (high level)

```
Browser
  │  (1) HTTP request
  ▼
Middleware (root middleware.ts, Edge)
  │  refresh Supabase session cookie
  │  build CSP nonce, set headers
  │  guard protected/auth routes → maybe redirect
  ▼
Next.js route resolution
  ├── Page (RSC shell → client component) ──► useEffect ──► Server Action / fetch(API)
  └── Route Handler (api/*) ──────────────────────────────► external SDK + Supabase
                                                  │
                                                  ▼
                                         Supabase Postgres (RLS)
                                         + RPCs (pgvector etc.)
                                                  │
                                                  ▼
                                       External: Gemini / Gmail
```

### Data flow (two backend styles)

```
            ┌──────────────── CLIENT PAGE (useState) ────────────────┐
            │                                                         │
   Server Action call                                        fetch("/api/...")
            │                                                         │
            ▼                                                         ▼
   src/app/actions/*.ts                                      src/app/api/**/route.ts
   (createClient → getUser → query → revalidatePath)         (getUser → limits → SDK + query)
            │                                                         │
            └───────────────┬───────────────────────┬────────────────┘
                            ▼                         ▼
                   Supabase (RLS, RPCs)        Gemini / Gmail
```

### Component relationships (frontend tree)

```
RootLayout (server)               src/app/layout.tsx
└── ClientLayout (client)         src/app/client-layout.tsx
    └── UserProvider              src/lib/user-context.tsx   ← global auth context
        ├── Navbar                src/components/layout/Navbar.tsx
        ├── <main>{page}</main>
        │     └── e.g. InboxPage  src/app/inbox/page.tsx
        │           ├── ThreadView
        │           │   ├── MessageBubble → EmailHtmlFrame (iframe)
        │           │   ├── ReplyPanel
        │           │   └── StyleFeedback
        │           └── EmptyInbox
        └── Footer (landing only) src/components/layout/Footer.tsx
```

---

# 5. Application Startup Flow

This traces a fresh page load (e.g. a logged-out user visiting `/inbox`). **[High]** unless noted.

1. **Entry point — Middleware runs first.** There is a single middleware, the **root** [middleware.ts](middleware.ts) (an earlier duplicate `src/middleware.ts` was removed in commit `6c27e79`). **[High]**
   - Reads `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY` ([middleware.ts:21-22](middleware.ts#L21-L22)).
   - Generates a base64 CSP **nonce** and builds the CSP string ([middleware.ts:24-25, 7-18](middleware.ts#L7-L18)). In dev it allows `'unsafe-eval'`.
   - Sets `x-nonce` + `Content-Security-Policy` on the request headers so Next can apply the nonce to its own scripts ([middleware.ts:29-31](middleware.ts#L29-L31)).
   - Creates a server Supabase client bound to request cookies and calls `auth.getUser()` ([middleware.ts:42-61](middleware.ts#L42-L61)).

2. **Route guard (now three checks).** `protectedRoutes = ["/dashboard", "/inbox", "/contacts", "/settings"]`, `authRoutes = ["/login", "/signup"]`, and `subscriptionExemptRoutes = ["/subscribe"]` ([middleware.ts:4-7](middleware.ts#L4-L7)). Order of decisions:
   - **Webhook bypass first:** `POST /api/stripe/webhook` returns immediately with no auth logic, because Stripe sends no session cookie ([middleware.ts:65-70](middleware.ts#L65-L70)).
   - **Not logged in** + on a protected *or* `/subscribe` route → redirect to `/login?redirect=…` ([middleware.ts:83-94](middleware.ts#L83-L94)).
   - **Logged in + protected route → subscription gate:** middleware reads `profiles.subscription_status` for the user; if it is not `"active"`, redirect to `/subscribe` ([middleware.ts:96-114](middleware.ts#L96-L114)). This is an **extra DB round-trip on every protected request**.
   - **Logged in + on an auth route** → redirect to `/dashboard`.
   - The protected list matches the actual app pages (the previous stale `/assessment`/`/reports` entries and the missing `/inbox`/`/contacts` were corrected in commit `6c27e79`).

3. **Configuration loading.** Env vars are read at request time inside middleware, the Supabase factories ([src/lib/supabase/server.ts:5-12](src/lib/supabase/server.ts#L5-L12), [client.ts:7-15](src/lib/supabase/client.ts#L7-L15)), and the integration routes. There is no central config module. **[High]** The full set of env vars referenced in code (`grep process.env`):
   - **Supabase:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (webhook only).
   - **Gemini:** `GEMINI_API_KEY`.
   - **Google/Gmail OAuth:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`.
   - **Stripe:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PRICE_ID`.
   - **Token encryption:** `GMAIL_TOKEN_ENCRYPTION_KEY` (32-byte hex; required by [token-crypto.ts](src/lib/token-crypto.ts#L8-L23) whenever a Gmail token is read/written).
   - **Captcha:** `NEXT_PUBLIC_TURNSTILE_SITE_KEY`.
   - **App URL:** `NEXT_PUBLIC_APP_URL` (Checkout success/cancel URLs + Gmail auth; falls back to `http://localhost:3000`).
   - `NODE_ENV` (dev-only CSP `'unsafe-eval'`, secure-cookie toggle).

4. **Root layout renders.** [src/app/layout.tsx](src/app/layout.tsx) is an async server component. It calls `await connection()` ([layout.tsx:17](src/app/layout.tsx#L17)) — a Next.js API that opts the render into dynamic/request-time rendering. **[Medium]** (purpose: ensure per-request behaviour, likely so the nonce/session are fresh). It injects Google Fonts and renders `<ClientLayout>`.

5. **Client shell + state initialization.** [client-layout.tsx](src/app/client-layout.tsx) is `"use client"`; it computes layout mode from `usePathname()` and wraps children in `UserProvider`, `Navbar`, and (landing-only) `Footer`.
   - [UserProvider](src/lib/user-context.tsx#L23-L73) creates/【reuses】a browser Supabase client (singleton, [client.ts:3-6](src/lib/supabase/client.ts#L3-L6)), calls `auth.getUser()`, subscribes to `onAuthStateChange`, and renders a **full-screen spinner while `loading`** ([user-context.tsx:60-66](src/lib/user-context.tsx#L60-L66)). So the very first paint of any page is a spinner until auth resolves. **[High]**

6. **First API calls (page-level).** Each page fetches on mount via `useEffect`:
   - Inbox: `listThreads(50)` then on demand `POST /api/gmail/sync` ([inbox/page.tsx:102-105, 118-138](src/app/inbox/page.tsx#L102-L138)).
   - Dashboard: `listThreads()` ([dashboard/page.tsx:14-19](src/app/dashboard/page.tsx#L14-L19)).
   - Settings: `getGymSettings()` + `GET /api/style/status` ([settings/page.tsx:24-37](src/app/settings/page.tsx#L24-L37)).
   - Contacts: `listContacts(filter)` ([contacts/page.tsx:45-47](src/app/contacts/page.tsx#L45-L47)).

7. **Initial screen rendering.** After auth + data resolve, the page renders its content (or an empty-state, e.g. `EmptyInbox`). There is no server-side data prefetch into pages; pages render their own loading spinners then hydrate. **[High]**

---

# 6. User Journey Analysis

Format: **User Action → UI Component → Handler → State → API/Action → Backend → DB → Response → UI**.

### Journey A — Sign up
- **Action:** fill form, complete the **Turnstile captcha**, submit. **Component:** [signup/page.tsx](src/app/signup/page.tsx). The `<Turnstile>` widget's `onSuccess` stores a token in state ([signup:113-116](src/app/signup/page.tsx#L113-L116)).
- **Handler:** `handleSubmit` → `auth.signUp({ email, password, options:{ data:{ name }, captchaToken } })` ([signup:25-32](src/app/signup/page.tsx#L25-L32)). Supabase verifies the captcha token server-side (Turnstile must be enabled in the Supabase project).
- **Backend/DB:** Supabase Auth creates the user (`name` → `user_metadata`); the `on_auth_user_created` trigger auto-inserts a `profiles` row with `subscription_status='inactive'` ([schema.sql:195-209](supabase/schema.sql#L195-L209)).
- **Anti-enumeration:** a `"User already registered"` error is swallowed and the same "Check your email" screen is shown, so an attacker cannot probe which emails have accounts ([signup:33-38](src/app/signup/page.tsx#L33-L38)). **[High]**
- **Response/UI:** `done=true` → "Check your email" screen. Email confirmation link → [auth/callback/route.ts](src/app/auth/callback/route.ts) `exchangeCodeForSession` → `/dashboard` → (middleware) → bounced to `/subscribe` until they pay.

### Journey B — Log in
- **Action/Component:** [login/page.tsx](src/app/login/page.tsx), also gated by a Turnstile captcha (token passed as `captchaToken`). **Handler:** `signInWithPassword` → on success `window.location.href="/dashboard"`. Full navigation (not client router) so middleware re-runs, the session cookie is present, and the subscription gate evaluates.

### Journey C — Connect Gmail
1. Settings → "Connect Gmail" is an `<a href="/api/gmail/auth">` ([settings/page.tsx:259-263](src/app/settings/page.tsx#L259-L263)).
2. [gmail/auth/route.ts](src/app/api/gmail/auth/route.ts) builds Google consent URL with scopes `gmail.readonly`, `gmail.send`, `gmail.modify`, `access_type:"offline"`, `prompt:"consent"`, and sets an `oauth_gmail_state` cookie carrying a random `state` value → redirects to Google.
3. Google redirects back to [gmail/callback/route.ts](src/app/api/gmail/callback/route.ts): **verifies the `state` param matches the `oauth_gmail_state` cookie** (CSRF protection — stops an attacker linking *their* Gmail to the victim's account; mismatch → `/settings?error=gmail_invalid_state`) ([callback:17-24](src/app/api/gmail/callback/route.ts#L17-L24)), exchanges `code` for tokens, fetches the Gmail address via `users.getProfile`, and **upserts `gmail_email` + an AES-256-GCM-`encryptToken`-ed `gmail_refresh_token` into `gym_settings`** ([callback:47-55](src/app/api/gmail/callback/route.ts#L47-L55)). It then clears the state cookie.
4. Redirects to `/settings?connected=true`; the page re-reads settings and cleans the URL.
5. On every later read (sync/send), the stored token is `decryptToken`-ed before use; values written before encryption existed (no `enc:v1:` prefix) are returned as-is and re-encrypted on the next OAuth callback ([token-crypto.ts:40-43](src/lib/token-crypto.ts#L40-L43)).

### Journey D — Sync inbox  *(core)*
- **Action:** click "Sync". **Component/Handler:** `handleSync` in [inbox/page.tsx:118-138](src/app/inbox/page.tsx#L118-L138) → `POST /api/gmail/sync`.
- **Backend:** [gmail/sync/route.ts](src/app/api/gmail/sync/route.ts):
  1. `getUser` guard; verify Google env vars; read `gmail_refresh_token` from `gym_settings`.
  2. Build OAuth client; `gmail.users.threads.list` with `maxResults:200`, `labelIds:["INBOX"]`, `q:"newer_than:14d category:primary"`.
  3. **Incremental partition:** load each known thread's stored `gmail_history_id` in one query; a listed thread whose `historyId` is unchanged since last sync is **skipped** (no `threads.get`). Only new/changed threads go into `toFetch`.
  4. **Parallel full fetch:** `mapPool(toFetch, 4, …)` fetches up to 4 threads concurrently; each task is wrapped in its own try/catch so a bad thread is recorded in `dropped[]` rather than crashing the run. Per thread: `threads.get(format:"full")` → `walk()` the MIME tree to extract best HTML/plain + inline CID images → `applyCids` → `sanitize` (strip script/handlers/js:/data: URLs).
  5. Identify sender, `upsert` contact, `upsert` thread (now storing `gmail_history_id`), then **one batched upsert** of all message rows for the thread (HTML capped 200k chars, plain 10k).
  6. **Auto-archive:** threads within the 14-day window whose `gmail_thread_id` is *not* in the current Primary set get `status:"archived"`.
  7. Update `gmail_last_synced_at`; return `{ synced, skipped, archived, gmailThreadCount, resultSizeEstimate, dropped }`.
- **DB:** writes to `contacts`, `email_threads`, `email_messages`, `gym_settings`.
- **UI:** on success `loadThreads(pageSize)` refreshes the list; on error shows a dismissible banner.

### Journey E — Generate a reply  *(core)*
- **Action:** open thread (`getThreadDetail` loads messages + latest generation), click "Suggest a Reply".
- **Handler:** `handleGenerate` ([inbox/page.tsx:301-365](src/app/inbox/page.tsx#L301-L365)) → `POST /api/ai/generate` with `{ threadId, subject, messages }`.
- **Backend:** [ai/generate/route.ts](src/app/api/ai/generate/route.ts):
  1. `getUser`; `enforceDailyLimit("generate")` (429 if over) ([generate:31-42](src/app/api/ai/generate/route.ts#L31-L42)).
  2. Load `gym_name`/`gym_context` rules.
  3. Build `conversationContext` from the last 2 messages (each truncated to 180 chars) ([generate:59-64](src/app/api/ai/generate/route.ts#L59-L64)).
  4. `retrieveStyleContext(supabase, userId, inboundText)` — embeds inbound text, runs `match_style_samples` RPC (top-3 cosine), and reads `style_profile`; falls back to recent samples ([style-memory.ts:316-388](src/lib/style-memory.ts#L316-L388)).
  5. Build prompt: if style examples exist, tone rule = "match the examples"; else "friendly and warm, like a coach" ([generate:86-101](src/app/api/ai/generate/route.ts#L86-L101)). Constraints: under 100 words, one next step, no markdown/JSON.
  6. `gemini-2.5-flash-lite`, `maxOutputTokens:160`, `temperature:0.4`; strip code fences; return `{ subject:"Re: …", body }` ([generate:103-119](src/app/api/ai/generate/route.ts#L103-L119)).
- **UI:** `handleGenerate` reads the JSON response and fills the editable textarea. (The earlier dormant SSE-streaming branch was removed when the inbox was split into components; the route returns plain JSON, [generate:112](src/app/api/ai/generate/route.ts#L112).) **[High]**

### Journey F — Edit & send  *(core)*
- **Action:** edit textarea, click "Send Reply". **Handler:** `handleSend` ([inbox/page.tsx:367-390](src/app/inbox/page.tsx#L367-L390)).
  1. `POST /api/gmail/send` with `{ threadId, gmailThreadId, to, subject, body }`.
  2. [gmail/send/route.ts](src/app/api/gmail/send/route.ts): `getUser`; **reject CR/LF in `to`/`subject`** to prevent header injection ([send:14-16](src/app/api/gmail/send/route.ts#L14-L16)); read refresh token; build raw RFC822 MIME; `gmail.users.messages.send({ raw, threadId })`. Then it **immediately persists the sent reply** as an `outbound` row in `email_messages` (keyed on the real Gmail message id, so the next sync dedupes against it), and marks the thread `replied` **and bumps `last_message_at`** to the send time so the conversation rises to the top — both mirroring Gmail without waiting for a sync.
  3. Then `approveGeneration(generation.id, draftBody, thread.id)` ([ai-generations.ts:7-35](src/app/actions/ai-generations.ts#L7-L35)): sets generation `sent` + thread `replied`, and **fire-and-forget** `addStyleSample` + `updateStyleProfile` (only if body > 20 chars).
- **UI:** the sent reply appears in the thread immediately; shows "Reply sent" + the `StyleFeedback` widget.
- **Note [Medium]:** `generation` is usually `null` because `/api/ai/generate` returns `generation:null`; so `approveGeneration` and the post-send style sample often **don't run** on a fresh draft. The reliable style-learning paths are manual add-sample and backfill. (The generation row is created elsewhere only if pre-existing on the thread via `getThreadDetail`.) See §18.

### Journey G — Rate the reply ("Sound like you?")
- **Component:** `StyleFeedback` ([inbox/page.tsx:670-703](src/app/inbox/page.tsx#L670-L703)). Optimistically sets done, fires `POST /api/style/feedback` with `rating: "good" | "wrong_style"`.
- **Backend:** [style/feedback/route.ts](src/app/api/style/feedback/route.ts): validates rating, verifies the generation belongs to the user, upserts `style_feedback` (one per generation), calls `apply_style_feedback` RPC to nudge that sample's `weight` (clamped 0.1–2.0).

### Journey H — Manage contacts
- **Component:** [contacts/page.tsx](src/app/contacts/page.tsx). Filter tabs set `filter` → `listContacts(type)`. Click a type badge → inline `<select>` → `updateContactType` → optimistic local update.

### Journey I — Add / view / remove style examples manually
- **Add:** Settings "Writing Style Examples" textarea → `handleAddExample` → `POST /api/style/add-sample` ([settings/page.tsx](src/app/settings/page.tsx)). Backend [style/add-sample/route.ts](src/app/api/style/add-sample/route.ts): min length 20; `enforceDailyLimit("add_sample")`; `addStyleSample`; `updateStyleProfile`; return new `sampleCount`.
- **View:** on load, Settings `GET /api/style/samples` and renders the saved examples (truncated, with word count + cluster). [samples/route.ts](src/app/api/style/samples/route.ts) `GET` lists `id, clean_body, word_count, context_cluster, created_at` (RLS-scoped).
- **Remove:** the trash icon on an example → `DELETE /api/style/samples?id=…`. The route deletes the row (RLS-scoped), then `updateStyleProfile` recomputes the aggregate — and if the user removed their **last** sample, the profile is reset to neutral defaults so stale voice stops leaking into drafts ([style-memory.ts updateStyleProfile](src/lib/style-memory.ts)). Returns the new `sampleCount`.

### Journey J — Backfill historical sent mail
- **Trigger:** manual `POST /api/style/backfill` (e.g. curl per [README.md:80-87](README.md#L80-L87)). Processes 20 outbound messages per call, excluding already-processed `message_id`s; returns `{ processed, skipped, remaining }`. ([style/backfill/route.ts](src/app/api/style/backfill/route.ts)).

### Journey K — Subscribe (paywall) *(gates all app access)*
1. A logged-in but un-subscribed user hits any protected page; middleware redirects them to `/subscribe` ([middleware.ts:96-114](middleware.ts#L96-L114)).
2. [subscribe/page.tsx](src/app/subscribe/page.tsx) shows the plan and a "Subscribe" button → `POST /api/stripe/checkout`.
3. [stripe/checkout/route.ts](src/app/api/stripe/checkout/route.ts): `getUser` (401 if absent); reads `NEXT_PUBLIC_STRIPE_PRICE_ID` (500 if unset); finds-or-creates a Stripe **Customer** (storing `stripe_customer_id` on `profiles` so repeat checkouts reuse it); creates a `mode:"subscription"` Checkout Session with `success_url=/dashboard`, `cancel_url=/subscribe`, and `metadata.supabase_uid = user.id`; returns `{ url }`.
4. Client does `window.location.href = url` → Stripe-hosted checkout. On success Stripe redirects to `/dashboard`.
5. **Asynchronously**, Stripe calls [stripe/webhook/route.ts](src/app/api/stripe/webhook/route.ts) (see Journey L). The `/dashboard` redirect and the activation are decoupled — if the webhook hasn't landed yet, middleware may briefly bounce the user back to `/subscribe` until `subscription_status` flips to `active`. **[Medium]**

### Journey L — Stripe webhook (subscription state sync) *(server-to-server)*
- **Trigger:** Stripe POSTs events to `/api/stripe/webhook`. Middleware lets it through untouched (no session) ([middleware.ts:65-70](middleware.ts#L65-L70)).
- **Handler:** [stripe/webhook/route.ts](src/app/api/stripe/webhook/route.ts):
  1. Reads the raw body + `stripe-signature`; **verifies the signature** with `STRIPE_WEBHOOK_SECRET` (400 on failure) — this is what authenticates the caller in lieu of a session.
  2. Builds a **service-role** Supabase client (bypasses RLS).
  3. `checkout.session.completed` → retrieve the subscription, compute `current_period_end`, and set `subscription_status='active'` + ids on `profiles`. **Primary key path is `session.metadata.supabase_uid`**; a fallback matches by `stripe_customer_id` (with a zero-row `count` check) and logs loudly if neither works.
  4. `customer.subscription.updated` → set status `active`/`inactive` by `subscription_id`.
  5. `customer.subscription.deleted` → set `inactive`.
  - **Note:** the handler currently emits verbose `console.log`/`warn` debug lines (added while debugging activation) — see §18.

---

# 7. Frontend Deep Dive

### Routes / pages (file-system routing under `src/app/`)
| Route | File | Type | Purpose |
|---|---|---|---|
| `/` | [page.tsx](src/app/page.tsx) | client | Marketing landing (193 lines) |
| `/dashboard` | [dashboard/page.tsx](src/app/dashboard/page.tsx) | client | Stats + "needs reply" + quick actions |
| `/inbox` | [inbox/page.tsx](src/app/inbox/page.tsx) | client | Thread list + reader + AI reply (core; orchestrator ~274 lines + [components/](src/app/inbox/components/)) |
| `/contacts` | [contacts/page.tsx](src/app/contacts/page.tsx) | client | CRM table with filters + inline type edit |
| `/settings` | [settings/page.tsx](src/app/settings/page.tsx) | client | Gym rules, style examples, Gmail connection |
| `/login`, `/signup` | [login](src/app/login/page.tsx), [signup](src/app/signup/page.tsx) | client | Supabase auth + Turnstile captcha |
| `/subscribe` | [subscribe/page.tsx](src/app/subscribe/page.tsx) | client | Paywall; launches Stripe Checkout. Auth-required but subscription-exempt |
| `/about`, `/contact`, `/privacy`, `/terms` | respective `page.tsx` | client | Marketing/legal static. `/privacy` (261 lines) + `/terms` (217 lines) are substantive legal copy; `/contact` (113) has a **decorative, non-functional** form (`onSubmit` just `preventDefault()`s) and mailto links |
| `/auth/callback` | [auth/callback/route.ts](src/app/auth/callback/route.ts) | handler | Session exchange |

### Layouts & providers
- **RootLayout** ([layout.tsx](src/app/layout.tsx)) — server; metadata, fonts, `connection()`, mounts `ClientLayout`.
- **ClientLayout** ([client-layout.tsx](src/app/client-layout.tsx)) — client; chooses chrome by pathname (`isLanding`/`isAuth`/`isApp`), applies layout padding (`lg:pl-64` for the app sidebar), mounts providers.
- **UserProvider** ([user-context.tsx](src/lib/user-context.tsx)) — the only context. Exposes `{ user, authUser, isLoggedIn, initials, loading, signOut }` via the `useUser()` hook.

### Hooks
- No custom hooks beyond `useUser()`. Everything else is React built-ins (`useState`, `useEffect`, `useCallback`, `useRef`). **[High]**

### Major components

> Since the split, each lives in its own file under [src/app/inbox/components/](src/app/inbox/components/) (except `InboxPage`, which is the route component in [page.tsx](src/app/inbox/page.tsx)).

**InboxPage** ([inbox/page.tsx](src/app/inbox/page.tsx))
- **Purpose:** orchestrates the whole inbox: thread list, selection, detail load, sync, pagination, mobile list/thread toggle.
- **State:** `threads, selectedId, detail, loadingThreads, loadingMore, pageSize, syncing, syncError, mobileView`.
- **Children:** `ThreadView`, `EmptyInbox`.
- **No props** (route component).

**ThreadView** ([components/ThreadView.tsx](src/app/inbox/components/ThreadView.tsx))
- **Props:** `{ thread, onArchive, onUpdate, onBack }`.
- **State:** `generating, generateError, draftBody, sending, sent, generation`.
- **Children:** `MessageBubble` (per message), `ReplyPanel`, `StyleFeedback`.
- **Responsibility:** generation + send + reject state machine.

**EmailHtmlFrame** ([components/EmailHtmlFrame.tsx](src/app/inbox/components/EmailHtmlFrame.tsx))
- **Props:** `{ html }`. Renders untrusted email HTML in a **sandboxed iframe** (`allow-scripts allow-popups allow-popups-to-escape-sandbox`, deliberately *no* `allow-same-origin`). Injects `<base target="_blank">`, responsive CSS, and a height-reporting script that `postMessage`s the content height back to the parent. Upgrades `http:` → `https:` for images.

**MessageBubble** ([components/MessageBubble.tsx](src/app/inbox/components/MessageBubble.tsx))
- **Props:** `{ message }`. Outbound → right-aligned cleaned text; inbound HTML → `EmailHtmlFrame`; inbound plain → left-aligned cleaned text. Strips the quoted reply chain (`stripQuotedText`) so each bubble shows only its new content, with a "•••" toggle to reveal the quoted history — mirroring Gmail's collapse behaviour.

**ReplyPanel** ([components/ReplyPanel.tsx](src/app/inbox/components/ReplyPanel.tsx))
- **Props:** the generate/send/reject handlers + draft state. Three states: "Suggest a Reply" CTA; "Drafting…" spinner; editable textarea with Send/Clear.

**StyleFeedback** ([components/StyleFeedback.tsx](src/app/inbox/components/StyleFeedback.tsx))
- **Props:** `{ generationId }`. Two-tap Yes/No → `/api/style/feedback`.

**Navbar** ([Navbar.tsx](src/components/layout/Navbar.tsx))
- Three variants: hidden on auth pages, `LandingNavbar` on `/`, `AppNavbar` otherwise. App nav links: Dashboard, Inbox, Contacts, Settings.

### Design-system components (props summary)
| Component | Key props | Notes |
|---|---|---|
| `Button` ([Button.tsx](src/components/ui/Button.tsx)) | `variant`(5), `size`(3), `loading`, `icon` | `forwardRef`; disables while loading; spinner SVG |
| `Card` (+sub) ([Card.tsx](src/components/ui/Card.tsx)) | `padding`, `hover` | `CardTitle`/`CardDescription` used in Settings |
| `Input`/`Textarea`/`Select` ([Input.tsx](src/components/ui/Input.tsx)) | `label`, `error`, `hint`, `options` | Auto-derives `id` from label |
| `Badge` ([Badge.tsx](src/components/ui/Badge.tsx)) | `variant`(5), `size` | Status chips |

### Parent-child summary
`InboxPage → ThreadView → { MessageBubble → EmailHtmlFrame, ReplyPanel, StyleFeedback }`. Dashboard defines local `StatCard`/`QuickAction`. Pages consume the shared `ui/` + `layout/` components and `actions/`.

---

# 8. Backend Deep Dive

The backend = **Server Actions** + **Route Handlers** + **domain library** + **Postgres RPCs**. Both action and route layers create a request-scoped Supabase client ([server.ts](src/lib/supabase/server.ts)) and re-derive the user.

### Server Actions ([src/app/actions/](src/app/actions/))

| Action | Inputs | Output | Validation | Notes |
|---|---|---|---|---|
| `listThreads(limit=50)` | limit | `EmailThread[]` (with contact join), excludes `archived`, ordered by `last_message_at` | returns `[]` if no user | [threads.ts:7-21](src/app/actions/threads.ts#L7-L21) |
| `getThreadDetail(threadId)` | id | thread + messages + latest generation | user guard | second query fetches latest `ai_generations` ([threads.ts:23-47](src/app/actions/threads.ts#L23-L47)) |
| `archiveThread(threadId)` | id | void | user guard | `revalidatePath("/inbox")` |
| `approveGeneration(genId, finalBody, threadId)` | ids, body | void | user guard; body>20 for style | sets `sent`/`replied`; fire-and-forget style learning ([ai-generations.ts:7-35](src/app/actions/ai-generations.ts#L7-L35)) |
| `rejectGeneration(genId)` | id | void | user guard | sets `rejected` |
| `getGymSettings()` / `saveGymSettings(name, context)` / `disconnectGmail()` | — | settings / void | user guard; throws if unauth on writes | [gym-settings.ts](src/app/actions/gym-settings.ts) |
| `listContacts(type?)` / `updateContactType(id,type)` / `upsertContact(email,name?,type?)` | — | `Contact[]` / void / `Contact` | user guard | [contacts.ts](src/app/actions/contacts.ts) |

### Route Handlers ([src/app/api/](src/app/api/))

| Endpoint | Method | Inputs | Output | Validation | Dependencies |
|---|---|---|---|---|---|
| `/api/gmail/auth` | GET | — | 302 → Google consent | redirect to `/login` if unauth | Google OAuth |
| `/api/gmail/callback` | GET | `?code`/`?error` | 302 → `/settings?...` | error/code check | Google, `gym_settings` |
| `/api/gmail/sync` | POST | — | `{synced,skipped,archived,gmailThreadCount,resultSizeEstimate,dropped}` | unauth 401; env-var check 500; "Gmail not connected" 400 | Gmail, `contacts`/`email_threads`/`email_messages`/`gym_settings` |
| `/api/gmail/send` | POST | `{threadId,gmailThreadId,to,subject,body}` | `{success:true}` | **CRLF check on to/subject**; unauth 401; not-connected 400 | Gmail, `email_threads` |
| `/api/ai/generate` | POST | `{threadId,subject,messages}` | `{generation,subject,body}` | unauth 401; daily limit 429; LLM error 500 | Gemini, `gym_settings`, `style_*`, `usage_counters` |
| `/api/style/add-sample` | POST | `{body}` | `{ok,sampleCount}` | min 20 chars 400; limit 429; save fail 500 | Gemini embed, `style_samples`/`style_profile` |
| `/api/style/backfill` | POST | — | `{processed,skipped,remaining}` | unauth 401; query fail 500 | `email_messages`→`style_samples` |
| `/api/style/feedback` | POST | `{generationId,rating}` | `{ok:true}` | rating allowlist; ownership 404 | `style_feedback`, `apply_style_feedback` |
| `/api/style/samples` | GET | — | `{samples[]}` | unauth 401 | `style_samples` (RLS-scoped) |
| `/api/style/samples` | DELETE | `?id` | `{ok,sampleCount}` | unauth 401; missing-id 400 | `style_samples`, `updateStyleProfile` |
| `/api/style/status` | GET | — | `{sampleCount,toneScore,avgWordCount,updatedAt}` | unauth 401 | `style_profile` |
| `/api/stripe/checkout` | POST | — | `{url}` (Checkout session) | unauth 401; missing price 500 | Stripe, `profiles` (read+write `stripe_customer_id`) |
| `/api/stripe/webhook` | POST | raw Stripe event + `stripe-signature` | `{received:true}` | **signature verify** 400; handler error 500 | Stripe, `profiles` via **service-role** client |
| `/auth/callback` | GET | `?code`,`?next` | 302 | exchange error → `/login?error` | Supabase Auth |

### Domain/business logic

**`src/lib/style-memory.ts`** — the engine. Pure helpers + Supabase/Gemini I/O:
- `cleanEmailText(raw)` — strips HTML, quoted chains, forwarded blocks, sign-offs, tracking URLs ([style-memory.ts:33-101](src/lib/style-memory.ts#L33-L101)).
- `detectCluster`, `computeToneScore`, `extractGreeting`, `extractSignoff` — heuristics.
- `embedText` — Gemini `gemini-embedding-001`, native 3072-dim **truncated to 768 + renormalized** to fit the pgvector schema & IVFFlat index ([style-memory.ts:146-181](src/lib/style-memory.ts#L146-L181)). Returns `null` on failure (never throws).
- `addStyleSample` — clean → word-count gate (10–500) → embed → insert; idempotent on duplicate; returns `{saved,reason}`.
- `updateStyleProfile` — recompute aggregate profile from latest 100 samples; upsert. If **no samples remain** (e.g. the user deleted them all), it resets the profile to neutral defaults (`sample_count:0, tone_score:0.5, …`) so a stale voice is not injected into future drafts.
- `retrieveStyleContext` — embed inbound + read profile (parallel); `match_style_samples` RPC top-3 (now ranked by cosine distance **scaled by feedback `weight`**); fallback to recent; returns `null` if no samples.
- `buildStylePromptSection` — formats profile + examples into prompt text.

**`src/lib/usage-limits.ts`** — `enforceDailyLimit(supabase, kind)` calls `increment_usage` RPC; **fails open** on RPC error ([usage-limits.ts:37-67](src/lib/usage-limits.ts#L37-L67)). Defaults: `generate:200/day`, `add_sample:50/day`.

**`src/lib/subscription.ts`** — `getUserSubscriptionStatus(userId)` reads `profiles.subscription_status`/`current_period_end` and returns `{ active, currentPeriodEnd }`. A convenience reader; note the *actual* gate in middleware queries `profiles` directly rather than calling this helper, so the two could drift. **[Medium]**

**`src/lib/token-crypto.ts`** — `encryptToken`/`decryptToken` for the Gmail refresh token. AES-256-GCM (authenticated encryption: confidentiality + integrity), 96-bit random IV per call, output format `enc:v1:<ivHex>.<authTagHex>.<ciphertextHex>`. Key from `GMAIL_TOKEN_ENCRYPTION_KEY` (must be 32 bytes / 64 hex chars, else throws). `decryptToken` is **backward-compatible**: a stored value without the `enc:v1:` prefix is treated as legacy plaintext and returned unchanged (so existing connections keep working until the next OAuth re-connect re-encrypts them).

### Middleware (cross-cutting)
[middleware.ts](middleware.ts): CSP nonce + session refresh + route guards (detailed in §5/§11). Also static security headers in [next.config.ts](next.config.ts).

### Database access
Almost all access is via the Supabase query builder with the **anon key**, scoped by RLS. RPCs used: `match_style_samples` (security invoker), `apply_style_feedback` (security invoker), `increment_usage` (security definer). **One exception:** the Stripe webhook ([api/stripe/webhook/route.ts](src/app/api/stripe/webhook/route.ts)) builds a client with the **service-role key** (`SUPABASE_SERVICE_ROLE_KEY`), which **bypasses RLS**, to write subscription state into `profiles`. This is required because the webhook has no user session; its trust comes from Stripe signature verification, not from `auth.uid()`. It is the only service-role usage in the codebase. **[High]**

---

# 9. Database Deep Dive

Source: [supabase/schema.sql](supabase/schema.sql), [style-memory-schema.sql](supabase/style-memory-schema.sql), [usage-limits-schema.sql](supabase/usage-limits-schema.sql). Schemas are applied **manually** via the Supabase SQL editor, not by migrations in the app. **[High]**

### Entity-relationship diagram

```
auth.users (Supabase-managed)
   │ 1
   ├──1── profiles            (subscription state; PK=auth.users.id; auto-created by trigger)
   ├──1── gym_settings        (gym rules + Gmail token; one row/user)
   ├──*── contacts            (unique: user_id+email)
   ├──*── email_threads ──────────────┐ (unique: user_id+gmail_thread_id)
   │          │ 1                      │ contact_id → contacts (nullable)
   │          *                        │
   │      email_messages       (unique: gmail_message_id; FK thread, cascade delete)
   ├──*── ai_generations ──────► thread_id → email_threads (cascade)
   ├──*── templates           (system + user; seeded)
   ├──*── scheduled_follow_ups (Phase 2 — unused by app code)
   ├──*── activity_logs        (defined; no writes found in app code)
   ├──*── style_samples ──────► message_id → email_messages, generation_id → ai_generations
   │          (vector(768), weight; unique message_id; unique generation_id)
   ├──1── style_profile        (PK = user_id; aggregate)
   ├──*── style_feedback ─────► generation_id → ai_generations (unique)
   └──*── usage_counters       (PK = user_id+day+kind)
```

### Tables

| Table | Why it exists | Used by | Key constraints |
|---|---|---|---|
| `profiles` | Per-user **subscription state**: `stripe_customer_id`, `subscription_id`, `subscription_status` (default `'inactive'`), `current_period_end` | middleware gate, checkout, webhook, [subscription.ts](src/lib/subscription.ts) | PK = `auth.users.id` (cascade delete); RLS **select-only** for owners (`auth.uid()=id`); **no insert/update policy** — writes happen only via the service-role webhook. Rows auto-created by the `on_auth_user_created` trigger |
| `gym_settings` | Per-user gym name, reply rules, **Gmail email + encrypted refresh token**, last-sync time | settings, gmail/*, ai/generate | `unique(user_id)`; RLS all |
| `contacts` | CRM of senders | contacts page, sync | `unique(user_id,email)`; type check; RLS all |
| `email_threads` | Grouped Gmail conversations | inbox, dashboard, sync | `unique(user_id,gmail_thread_id)`; status check; **`gmail_history_id`** (lets sync skip unchanged threads); indexes on `(user_id,status)` and `(user_id,last_message_at desc)` |
| `email_messages` | Individual messages (raw HTML/plain body) | thread detail, sync, backfill | `unique(gmail_message_id)`; FK thread cascade; **RLS via parent thread's user_id** (subquery policy) |
| `ai_generations` | AI draft + outcome lifecycle | generations action, feedback | status/risk/type checks; FK thread cascade; RLS all |
| `templates` | Reusable email templates (5 system rows seeded) | — *(no app reads found)* | RLS: own + `is_system` readable |
| `scheduled_follow_ups` | Planned follow-ups w/ QStash id | — *(Phase 2; unused)* | references templates/threads/contacts |
| `activity_logs` | Audit log | — *(no writes found)* | RLS all |
| `style_samples` | One cleaned outbound email = one voice sample, with embedding + weight | style-memory, generate, backfill, feedback | `vector(768)`; `unique(message_id)`, `unique(generation_id)`; IVFFlat cosine index (lists=50) |
| `style_profile` | Aggregate writing-style summary | generate, status, add-sample | PK `user_id` |
| `style_feedback` | Rating per generation | feedback route | `unique(generation_id)` |
| `usage_counters` | Daily per-kind call counts | usage-limits | PK `(user_id,day,kind)`; **no insert/update policy** — writes only via `increment_usage` (security definer) |

### RPC functions
- `match_style_samples(query_emb vector(768), match_count int=3)` — kNN over `style_samples`, security **invoker** (RLS applies), `where embedding is not null and word_count>=10`. **Ranking now blends in feedback `weight`** (`effective_rank = cosine_distance * (1.0 / weight)`), so a "👍"-boosted sample surfaces first and a "wrong style"-demoted one sinks; it returns `weight` in the result row. Trade-off: the `ORDER BY` can no longer be served by the IVFFlat distance index, so it does a per-user scan+sort (fine at per-user sample volumes). ([style-memory-schema.sql](supabase/style-memory-schema.sql)).
- `apply_style_feedback(p_generation_id, p_rating)` — adjusts sample `weight` by rating delta, clamped 0.1–2.0, security invoker ([style-memory-schema.sql:129-153](supabase/style-memory-schema.sql#L129-L153)).
- `increment_usage(p_kind, p_limit)` — atomic upsert+increment, returns `(new_count, exceeded)`, security **definer** with `search_path=public` ([usage-limits-schema.sql:27-46](supabase/usage-limits-schema.sql#L27-L46)).
- `handle_new_user()` + trigger `on_auth_user_created` — `security definer` trigger that inserts a `profiles` row (`on conflict do nothing`) **after every new `auth.users` insert**, so every account starts with an `inactive` subscription profile ([schema.sql:195-209](supabase/schema.sql#L195-L209)).

### Data lifecycle
- A sync creates/updates `contacts`, `email_threads`, `email_messages`; stale threads auto-archived.
- Sending sets `email_threads.status='replied'` and (when a generation exists) `ai_generations.status='sent'`.
- Style: outbound text → `style_samples` (+embedding) → recompute `style_profile`; feedback adjusts `weight`.
- Usage: each billed call increments `usage_counters` for `(user, today, kind)`.
- Subscription: signup → trigger creates `profiles(inactive)`; checkout creates/stores `stripe_customer_id`; webhook flips `subscription_status` (`active`/`inactive`) + `current_period_end`; middleware reads it on every protected request.

> **Note [High]:** `weight` in `style_samples` is written by feedback **and now consumed by retrieval** — `match_style_samples` divides cosine distance by `weight`, so the "Sound like you? Yes/No" feedback actually reorders which examples get injected into future drafts (changed in commit `13b9e29`). (This resolves the earlier "weight written but unused" gap.)

> **Note [Medium]:** `style_samples.embedding` is `vector(768)` and the code truncates Gemini's 3072-dim output to 768 + renormalizes; comments explain the IVFFlat index can't exceed ~2000 dims ([style-memory.ts:146-164](src/lib/style-memory.ts#L146-L164)).

---

# 10. State Management Deep Dive

### Where state lives
1. **Server state (source of truth):** Supabase Postgres, read per request through user-scoped clients. After mutations, Server Actions call `revalidatePath()` ([threads.ts:60](src/app/actions/threads.ts#L60), [contacts.ts:37](src/app/actions/contacts.ts#L37), [gym-settings.ts:36](src/app/actions/gym-settings.ts#L36)).
2. **Global client state:** exactly one React Context — `UserProvider`/`useUser` ([user-context.tsx](src/lib/user-context.tsx)) holding the auth user + derived profile/initials.
3. **Local component state:** each page owns its data via `useState` and fetches on mount via `useEffect`. No shared client cache. **[High]**
4. **Cached state:** none at the app layer (no React Query/SWR). Browser Supabase client is a module singleton ([client.ts:3-6](src/lib/supabase/client.ts#L3-L6)). Server rendering caching is whatever Next.js default + `revalidatePath`/`connection()` produce. **[Medium]**

### How data moves
- **Read:** page `useEffect` → Server Action → user-scoped Supabase → Postgres (RLS) → returned typed data → `setState`.
- **Mutate (action path):** handler → Server Action → DB write → `revalidatePath` + often a manual local `setState` (e.g. optimistic archive removal [inbox/page.tsx:150](src/app/inbox/page.tsx#L150), optimistic contact type [contacts/page.tsx:50-54](src/app/contacts/page.tsx#L50-L54)).
- **Mutate (API path):** handler → `fetch()` route → external SDK + DB → JSON → `setState`.

### Cross-page behaviour
No global store, so navigating between Dashboard and Inbox **refetches** threads independently. Auth is resolved twice per load (middleware + `UserProvider`). **[High]** Acceptable at current scale.

---

# 11. Authentication & Authorization

### Two independent auth systems
1. **App identity — Supabase Auth** (email/password). Establishes the user and cookie session; `auth.uid()` drives RLS.
2. **Gmail access — Google OAuth 2.0** (separate). Yields a long-lived refresh token stored per user in `gym_settings`.

### Signup ([signup/page.tsx](src/app/signup/page.tsx))
`auth.signUp({ email, password, options:{ data:{ name } } })` → email confirmation → link hits [auth/callback/route.ts](src/app/auth/callback/route.ts) → `exchangeCodeForSession` → `/dashboard`.

### Login ([login/page.tsx](src/app/login/page.tsx))
`signInWithPassword` → on success hard-navigates to `/dashboard` so middleware re-runs with the new cookie.

### Session handling
- Cookies are the session store. **Middleware refreshes them on every matched request** via `createServerClient` + `getUser()` ([middleware.ts:42-61](middleware.ts#L42-L61)).
- Server-side reads use [supabase/server.ts](src/lib/supabase/server.ts) (cookie-bound, per request). It deliberately swallows cookie-set errors inside Server Components ([server.ts:29-33](src/lib/supabase/server.ts#L29-L33)).
- Client uses the singleton browser client; `UserProvider` subscribes to `onAuthStateChange`.

### Token handling
- Supabase tokens: managed in cookies by `@supabase/ssr`.
- Gmail refresh token: stored in `gym_settings.gmail_refresh_token`, now **encrypted at rest** with AES-256-GCM ([token-crypto.ts](src/lib/token-crypto.ts)). Written `encryptToken`-ed in the OAuth callback ([callback:51](src/app/api/gmail/callback/route.ts#L51)); each Gmail route `decryptToken`s it before `setCredentials({ refresh_token })` ([sync:189](src/app/api/gmail/sync/route.ts#L189), [send:45](src/app/api/gmail/send/route.ts#L45)). Legacy plaintext rows decrypt to themselves and get re-encrypted on the next re-connect. Requires `GMAIL_TOKEN_ENCRYPTION_KEY`. **[High]**
- Captcha: a Cloudflare Turnstile token is collected on login/signup and handed to Supabase Auth (`captchaToken`), which verifies it server-side; the app does not verify it itself.
- `signOut()` ([user-context.tsx:46-49](src/lib/user-context.tsx#L46-L49)) calls `auth.signOut()` then redirects to `/`.

### Authorization model
- **Primary boundary = Postgres RLS.** Every table has `auth.uid() = user_id` policies (or, for `email_messages`, an EXISTS subquery on the parent thread). The anon-key client cannot read/write other users' rows. [AGENTS.md](AGENTS.md) states RLS is *the* ownership boundary and warns against redundant `.eq("user_id")` filters.
- **Secondary checks:** every action/route calls `getUser()` and returns 401/empty if absent; the billed API routes (`/api/ai/generate`, `/api/gmail/*`, `/api/style/*`) go further and call `requirePaidUser(supabase)` ([subscription.ts](src/lib/subscription.ts)), which combines the `getUser()` check with an `active`-subscription check (401/402); feedback route additionally verifies generation ownership before acting ([feedback:30-39](src/app/api/style/feedback/route.ts#L30-L39)).

### Protected routes & subscription gate
Enforced by the (single, root) middleware's `protectedRoutes`/`authRoutes`/`subscriptionExemptRoutes` lists ([middleware.ts:4-7](middleware.ts#L4-L7)). It guards all four app pages — `/dashboard`, `/inbox`, `/contacts`, `/settings` — redirecting anonymous visits to `/login` and bouncing logged-in users off `/login`/`/signup`. **On top of auth, it enforces billing:** a logged-in user with `profiles.subscription_status !== 'active'` visiting a protected page is redirected to `/subscribe` ([middleware.ts:96-114](middleware.ts#L96-L114)). `/subscribe` itself requires login but is subscription-exempt. The Stripe webhook is bypassed entirely (no session). RLS remains the actual *data* boundary; the middleware enforces *access* (auth + payment) and is UX/defence-in-depth for the former.

> **Note [High]:** the *middleware* subscription gate still only fires for paths in `protectedRoutes` — the four **page** routes; `/api/*` is not in that list. The billed API routes no longer rely on it, though: each one calls `requirePaidUser(supabase)` ([subscription.ts](src/lib/subscription.ts)) at the top of the handler, which checks auth **and** `profiles.subscription_status === 'active'` and returns 401/402 otherwise. So a logged-in-but-un-subscribed (or churned) user who calls `POST /api/ai/generate`, `/api/gmail/sync`, `/api/gmail/send`, or any `/api/style/*` endpoint **directly** is now rejected at the billed-work layer, not just redirected at the UI layer. Daily usage caps remain as a second guard. **[High]**

---

# 12. External Integrations

### A. Supabase (Postgres + Auth)
- **Purpose:** database, auth, RLS, RPCs.
- **Data exchanged:** all user data; auth credentials/sessions.
- **Entry points:** [src/lib/supabase/client.ts](src/lib/supabase/client.ts) (browser), [server.ts](src/lib/supabase/server.ts) (server), [middleware.ts](middleware.ts).
- **Failure handling:** factories throw a descriptive error if env vars are missing/invalid ([client.ts:11-15](src/lib/supabase/client.ts#L11-L15)); middleware degrades gracefully if Supabase env is absent ([middleware.ts:36-41](middleware.ts#L36-L41)); `UserProvider` wraps `createClient()` in try/catch ([user-context.tsx:27-29](src/lib/user-context.tsx#L27-L29)).
- **Security:** anon key + RLS everywhere **except** the Stripe webhook, which uses the **service-role key** (`SUPABASE_SERVICE_ROLE_KEY`, bypasses RLS) to write `profiles`.

### B. Google Gemini (`@google/generative-ai`)
- **Purpose:** reply generation (`gemini-2.5-flash-lite`) + embeddings (`gemini-embedding-001`).
- **Data exchanged:** inbound email text + gym rules + style examples (out); draft text / 3072-dim vector (in). **[High]** Note: email content is sent to Google for both generation and embedding.
- **Entry points:** [ai/generate/route.ts:8,103](src/app/api/ai/generate/route.ts#L103); [style-memory.ts:17,166-181](src/lib/style-memory.ts#L166-L181).
- **Failure handling:** generation returns 500 with `error:true` ([generate:113-118](src/app/api/ai/generate/route.ts#L113-L118)); embeddings return `null` and degrade (sample saved without vector / retrieval returns null) — never throws ([style-memory.ts:177-180, 298-308 test](src/lib/style-memory.ts#L177-L180)).
- **Security:** `GEMINI_API_KEY` server-side only; daily usage caps via `increment_usage` provide a soft cost ceiling.

### C. Gmail API (`googleapis`)
- **Purpose:** OAuth, read inbox threads/messages, send replies.
- **Data exchanged:** OAuth code/tokens; thread & message payloads (in); raw MIME messages (out).
- **Entry points:** [gmail/auth](src/app/api/gmail/auth/route.ts), [callback](src/app/api/gmail/callback/route.ts), [sync](src/app/api/gmail/sync/route.ts), [send](src/app/api/gmail/send/route.ts).
- **Failure handling:** sync wraps everything in try/catch returning 500 with message + a per-thread `dropped[]` diagnostic array ([sync:319-326, 177](src/app/api/gmail/sync/route.ts#L319-L326)); missing env vars → explicit 500; not-connected → 400.
- **Security:** scopes `gmail.readonly`/`send`/`modify`; refresh token in `gym_settings` **AES-256-GCM-encrypted at rest** ([token-crypto.ts](src/lib/token-crypto.ts)); OAuth callback **CSRF-protected via `state` cookie**; inbound HTML sanitized + iframe-sandboxed; outbound headers CRLF-validated.

### D. Stripe (`stripe`)
- **Purpose:** subscription billing — Checkout sessions + lifecycle webhook.
- **Data exchanged:** out — customer email, `supabase_uid` metadata, price id; in — Checkout URL, subscription objects, signed webhook events.
- **Entry points:** [stripe/checkout/route.ts](src/app/api/stripe/checkout/route.ts) (server-side `POST`, returns hosted URL), [stripe/webhook/route.ts](src/app/api/stripe/webhook/route.ts) (Stripe → app).
- **Failure handling:** checkout returns 401/500 on missing user/price; webhook returns 400 on bad/missing signature, 500 on handler error, and logs (does not fail the request) on individual DB update errors.
- **Security:** secret key server-side only (`STRIPE_SECRET_KEY`); webhook authenticated by **signature verification** with `STRIPE_WEBHOOK_SECRET`; webhook bypasses middleware auth (no session) and writes via service-role.

### E. Cloudflare Turnstile (`@marsidev/react-turnstile`)
- **Purpose:** captcha / bot protection on login + signup.
- **Data exchanged:** site key (`NEXT_PUBLIC_TURNSTILE_SITE_KEY`) out; a verification token in, forwarded to Supabase as `captchaToken`.
- **Verification:** performed by **Supabase Auth** (the project must have Turnstile enabled with the matching secret), not by app code. CSP already allowlists `challenges.cloudflare.com` ([middleware.ts:13,17-18](middleware.ts#L13-L18)).

### F. Vercel (deployment) — platform, not called from code.

> **QStash** appears only as a column name (`scheduled_follow_ups.qstash_message_id`) — there is **no QStash integration in the app code**. **[High]** It's a Phase-2 placeholder.

---

# 13. Feature Inventory

| # | Feature | Entry point(s) | Main files | DB deps | API/Action deps | Related components |
|---|---|---|---|---|---|---|
| 1 | **Auth (signup/login/session + captcha)** | `/signup`,`/login` | login/signup pages (Turnstile), [auth/callback](src/app/auth/callback/route.ts), [middleware.ts](middleware.ts), [user-context.tsx](src/lib/user-context.tsx) | `auth.users`,`profiles` (trigger) | Supabase Auth, Turnstile | UserProvider, Navbar |
| 2 | **Gmail connection** | Settings → `/api/gmail/auth` | [gmail/auth](src/app/api/gmail/auth/route.ts), [callback](src/app/api/gmail/callback/route.ts) | `gym_settings` | Google OAuth | settings page |
| 3 | **Gmail sync** | Inbox "Sync" | [gmail/sync](src/app/api/gmail/sync/route.ts) | `contacts`,`email_threads`,`email_messages`,`gym_settings` | Gmail API | InboxPage |
| 4 | **Inbox reading** | `/inbox` | [inbox/page.tsx](src/app/inbox/page.tsx), [threads.ts](src/app/actions/threads.ts) | `email_threads`,`email_messages`,`contacts` | `listThreads`,`getThreadDetail` | ThreadView, MessageBubble, EmailHtmlFrame |
| 5 | **AI reply generation** | "Suggest a Reply" | [ai/generate](src/app/api/ai/generate/route.ts), [style-memory.ts](src/lib/style-memory.ts), [usage-limits.ts](src/lib/usage-limits.ts) | `gym_settings`,`style_*`,`usage_counters` | Gemini | ReplyPanel |
| 6 | **Send reply** | "Send Reply" | [gmail/send](src/app/api/gmail/send/route.ts), [ai-generations.ts](src/app/actions/ai-generations.ts) | `email_threads`,`ai_generations`,`style_samples` | Gmail API | ReplyPanel |
| 7 | **Style learning** | sends, settings paste/list/delete, backfill | [style-memory.ts](src/lib/style-memory.ts), [style/*](src/app/api/style/) (incl. [samples](src/app/api/style/samples/route.ts)) | `style_samples`,`style_profile`,`style_feedback` | Gemini embed + RPCs | StyleFeedback, settings |
| 8 | **Style feedback** | "Sound like you?" | [style/feedback](src/app/api/style/feedback/route.ts) | `style_feedback`,`style_samples` | `apply_style_feedback` | StyleFeedback |
| 9 | **Contacts CRM** | `/contacts` | [contacts/page.tsx](src/app/contacts/page.tsx), [contacts.ts](src/app/actions/contacts.ts) | `contacts` | `listContacts`,`updateContactType` | Badge |
| 10 | **Gym rules/settings** | `/settings` | [settings/page.tsx](src/app/settings/page.tsx), [gym-settings.ts](src/app/actions/gym-settings.ts) | `gym_settings` | save/get/disconnect | Card, Input, Textarea |
| 11 | **Dashboard** | `/dashboard` | [dashboard/page.tsx](src/app/dashboard/page.tsx) | `email_threads` | `listThreads` | StatCard, QuickAction |
| 12 | **Usage limits** | inside generate/add-sample | [usage-limits.ts](src/lib/usage-limits.ts) | `usage_counters` | `increment_usage` | — |
| 13 | **Marketing/legal** | `/`,`/about`,`/contact`,`/privacy`,`/terms` | respective pages | — | — | LandingNavbar, Footer |
| 14 | **Subscription / billing (paywall)** | `/subscribe`, Stripe Checkout/webhook | [subscribe/page.tsx](src/app/subscribe/page.tsx), [stripe/checkout](src/app/api/stripe/checkout/route.ts), [stripe/webhook](src/app/api/stripe/webhook/route.ts), [middleware.ts](middleware.ts), [subscription.ts](src/lib/subscription.ts) | `profiles` | Stripe | — |
| 15 | **Gmail token encryption** | inside connect/sync/send | [token-crypto.ts](src/lib/token-crypto.ts) | `gym_settings` | Node `crypto` | — |

**Defined-but-unused (data model only):** templates, scheduled_follow_ups, activity_logs. **[High]**

---

# 14. File Dependency Map (Top 50)

Ranked by importance for *understanding* the app (criticality × blast-radius). For each: why it exists / what depends on it / what it depends on.

1. **[AGENTS.md](AGENTS.md)** — the security contract that overrides defaults. *Depends on:* nothing. *Depended on by:* every engineer's decisions.
2. **[src/lib/types.ts](src/lib/types.ts)** — domain model. *Dep by:* nearly all pages/actions/components. *Dep on:* none.
3. **[supabase/schema.sql](supabase/schema.sql)** — core tables + RLS. *Dep by:* all data access. *Dep on:* Supabase auth.users.
4. **[supabase/style-memory-schema.sql](supabase/style-memory-schema.sql)** — pgvector tables + RPCs. *Dep by:* style-memory + style routes. *Dep on:* pgvector.
5. **[middleware.ts](middleware.ts)** (root, active) — auth + CSP. *Dep by:* every request. *Dep on:* `@supabase/ssr`.
6. **[src/lib/style-memory.ts](src/lib/style-memory.ts)** — core IP. *Dep by:* ai/generate, style/*, ai-generations. *Dep on:* Gemini, Supabase, schema.
7. **[src/lib/supabase/server.ts](src/lib/supabase/server.ts)** — server DB client. *Dep by:* all actions + routes. *Dep on:* `@supabase/ssr`, cookies.
8. **[src/lib/supabase/client.ts](src/lib/supabase/client.ts)** — browser DB client. *Dep by:* user-context, login, signup. *Dep on:* `@supabase/ssr`.
9. **[src/app/inbox/page.tsx](src/app/inbox/page.tsx)** — the core UI + reply flow. *Dep by:* route `/inbox`. *Dep on:* actions/threads, actions/ai-generations, ui, api routes.
10. **[src/app/api/ai/generate/route.ts](src/app/api/ai/generate/route.ts)** — generation endpoint. *Dep on:* style-memory, usage-limits, Gemini, gym_settings.
11. **[src/app/api/gmail/sync/route.ts](src/app/api/gmail/sync/route.ts)** — ingestion. *Dep on:* googleapis, Supabase.
12. **[src/app/api/gmail/send/route.ts](src/app/api/gmail/send/route.ts)** — egress. *Dep on:* googleapis, Supabase.
13. **[src/lib/user-context.tsx](src/lib/user-context.tsx)** — global auth state. *Dep by:* ClientLayout, Navbar. *Dep on:* client.ts.
14. **[src/app/client-layout.tsx](src/app/client-layout.tsx)** — provider/chrome shell. *Dep by:* layout.tsx. *Dep on:* UserProvider, Navbar, Footer.
15. **[src/app/layout.tsx](src/app/layout.tsx)** — root layout. *Dep by:* whole app. *Dep on:* ClientLayout.
16. **[src/app/actions/threads.ts](src/app/actions/threads.ts)** — thread CRUD. *Dep by:* inbox, dashboard.
17. **[src/app/actions/ai-generations.ts](src/app/actions/ai-generations.ts)** — approve/reject + style hook. *Dep by:* inbox. *Dep on:* style-memory.
18. **[src/lib/usage-limits.ts](src/lib/usage-limits.ts)** — cost guard. *Dep by:* generate, add-sample.
19. **[supabase/usage-limits-schema.sql](supabase/usage-limits-schema.sql)** — counters + RPC. *Dep by:* usage-limits.ts.
20. **[src/app/api/gmail/callback/route.ts](src/app/api/gmail/callback/route.ts)** — stores Gmail token.
21. **[src/app/api/gmail/auth/route.ts](src/app/api/gmail/auth/route.ts)** — OAuth start.
22. **[src/app/settings/page.tsx](src/app/settings/page.tsx)** — rules + connection + examples.
23. **[src/app/actions/gym-settings.ts](src/app/actions/gym-settings.ts)** — settings CRUD.
24. **[src/app/actions/contacts.ts](src/app/actions/contacts.ts)** — contacts CRUD.
25. **[src/app/contacts/page.tsx](src/app/contacts/page.tsx)** — CRM UI.
26. **[src/app/dashboard/page.tsx](src/app/dashboard/page.tsx)** — landing-after-login.
27. **[src/app/api/style/backfill/route.ts](src/app/api/style/backfill/route.ts)** — historical ingestion.
28. **[src/app/api/style/add-sample/route.ts](src/app/api/style/add-sample/route.ts)** — manual sample.
29. **[src/app/api/style/feedback/route.ts](src/app/api/style/feedback/route.ts)** — reweighting.
30. **[src/app/api/style/status/route.ts](src/app/api/style/status/route.ts)** — sample stats.
31. **[src/app/auth/callback/route.ts](src/app/auth/callback/route.ts)** — Supabase session exchange.
32. **[src/app/login/page.tsx](src/app/login/page.tsx)** / 33. **[src/app/signup/page.tsx](src/app/signup/page.tsx)** — auth UI.
34. **[src/components/layout/Navbar.tsx](src/components/layout/Navbar.tsx)** — navigation. *Dep on:* user-context.
35. **[src/components/ui/Button.tsx](src/components/ui/Button.tsx)** — most-used primitive.
36. **[src/components/ui/Input.tsx](src/components/ui/Input.tsx)** — Input/Textarea/Select.
37. **[src/components/ui/Card.tsx](src/components/ui/Card.tsx)** — Card family.
38. **[src/components/ui/Badge.tsx](src/components/ui/Badge.tsx)** — status chips.
39. **[src/components/ui/index.ts](src/components/ui/index.ts)** — barrel export.
40. **[src/lib/utils.ts](src/lib/utils.ts)** — `cn()`, `formatDate()`.
41. **[next.config.ts](next.config.ts)** — security headers.
42. **[tailwind.config.ts](tailwind.config.ts)** — design tokens.
43. **[tsconfig.json](tsconfig.json)** — `@/*` path alias.
44. **[jest.config.ts](jest.config.ts)** — test config.
45. **[src/app/globals.css](src/app/globals.css)** — global styles/utilities (e.g. `gradient-brand`).
46. **[src/app/page.tsx](src/app/page.tsx)** — landing.
47. **[src/components/layout/Footer.tsx](src/components/layout/Footer.tsx)** — landing footer.
48. **[src/lib/__tests__/style-memory.test.ts](src/lib/__tests__/style-memory.test.ts)** — behaviour spec for the engine.
49. **[src/app/api/style/__tests__/add-sample.test.ts](src/app/api/style/__tests__/add-sample.test.ts)** — route test.
50. **[README.md](README.md)** — product + setup overview.

> **Not in this top-50 but worth knowing:** the inbox sub-components in [src/app/inbox/components/](src/app/inbox/components/) (`ThreadView`, `MessageBubble`, `EmailHtmlFrame`, `ReplyPanel`, `StyleFeedback`) and [src/app/api/style/samples/route.ts](src/app/api/style/samples/route.ts) (list/delete examples). The previously-listed dead `src/middleware.ts` and the unused `ui/ScoreRing|Stepper|ProgressBar|ToggleChip` have since been **deleted**.
>
> **Billing/security subsystem (added after the original top-50 was numbered; rank them ~alongside the integration routes):** [src/app/api/stripe/webhook/route.ts](src/app/api/stripe/webhook/route.ts) (the only service-role writer; source of truth for subscription state), [src/app/api/stripe/checkout/route.ts](src/app/api/stripe/checkout/route.ts), [src/lib/token-crypto.ts](src/lib/token-crypto.ts) (Gmail token at-rest crypto — breaking it breaks all Gmail access), [src/lib/subscription.ts](src/lib/subscription.ts), and [src/app/subscribe/page.tsx](src/app/subscribe/page.tsx). Also note `middleware.ts` (#5) now additionally enforces the **subscription gate**, and `supabase/schema.sql` (#3) now defines the `profiles` table + `on_auth_user_created` trigger.

---

# 15. Data Flow Analysis (worked examples)

### Flow 1 — Generate a reply (full path)

```
[Input] User clicks "Suggest a Reply" (thread messages in component state)
   ↓  handleGenerate() — inbox/components/ThreadView.tsx
[Validation] none client-side beyond having a thread
   ↓  fetch POST /api/ai/generate  { threadId, subject, messages }
[API] ai/generate/route.ts
   → auth.getUser()                         (401 if missing)
   → enforceDailyLimit("generate")          (429 if over; usage_counters via increment_usage)
   → read gym_settings(gym_name, gym_context)
   → retrieveStyleContext():
        embedText(inbound) ──► Gemini embeddings
        rpc match_style_samples(query_emb,3) ──► pgvector kNN (RLS-scoped)
        read style_profile
   → buildStylePromptSection() + tone rule
   → Gemini generateContent (flash-lite, 160 tok, temp 0.4)
   ↓
[Response] { generation:null, subject:"Re: …", body }
   ↓
[UI] setDraftBody(body) → editable textarea
```

### Flow 2 — Send a reply

```
[Input] edited draftBody + replyTo
   ↓ handleSend() — inbox/components/ThreadView.tsx
[Validation] requires draftBody.trim() && replyTo (client)
   ↓ fetch POST /api/gmail/send {threadId,gmailThreadId,to,subject,body}
[API] gmail/send/route.ts
   → auth.getUser()
   → CRLF check on to/subject  (400 "Invalid header value")  ← sink validation
   → read gym_settings.gmail_refresh_token
   → build raw RFC822 MIME → gmail.users.messages.send({raw,threadId})
   → upsert sent reply into email_messages (outbound, keyed on real msg id)
   → update email_threads.status='replied', last_message_at=now
   ↓
[then] approveGeneration(genId, body, threadId)  (only if a generation exists)
   → ai_generations.status='sent', final_body
   → email_threads.status='replied'
   → addStyleSample + updateStyleProfile (fire-and-forget; body>20)
   ↓
[Response] {success:true}
[UI] sent=true → "Reply sent" + StyleFeedback
```

### Flow 3 — Sync inbox

```
[Input] click "Sync"
   ↓ POST /api/gmail/sync
[API] auth → env check → read refresh token
   → threads.list(q:"newer_than:14d category:primary", max 200)
   → load known gmail_history_id per thread; skip unchanged threads
   → mapPool(changed, 4): threads.get(full) → walk() MIME → applyCids → sanitize
        → upsert contact → upsert email_threads(+gmail_history_id) → batched upsert email_messages
   → auto-archive threads not in current Primary set (14d window)
   → update gym_settings.gmail_last_synced_at
[Response] {synced,skipped,archived,gmailThreadCount,resultSizeEstimate,dropped}
[UI] loadThreads() refreshes list / shows error banner
```

### Flow 4 — Update a contact's type

```
[Input] click badge → choose option in <select>
   ↓ handleTypeChange — contacts/page.tsx:49
[Action] updateContactType(id,type) → supabase update contacts (RLS-scoped) → revalidatePath
[UI] optimistic local map() update; editingId cleared
```

### Flow 5 — Subscribe & activate (two decoupled halves)

```
[Half A — checkout, synchronous]
[Input] click "Subscribe" on /subscribe
   ↓ POST /api/stripe/checkout
[API] auth.getUser() (401)  → read NEXT_PUBLIC_STRIPE_PRICE_ID (500 if missing)
   → find/create Stripe Customer; persist profiles.stripe_customer_id
   → stripe.checkout.sessions.create(mode:subscription,
       metadata.supabase_uid=user.id, success_url=/dashboard)
   ↓ { url }
[UI] window.location = url → Stripe-hosted checkout → on success → /dashboard

[Half B — webhook, asynchronous, server-to-server]
[Input] Stripe POSTs event → /api/stripe/webhook (middleware bypass)
[API] verify stripe-signature (400 if bad)  → service-role Supabase client (bypasses RLS)
   switch event.type:
     checkout.session.completed → retrieve subscription → period_end
        → UPDATE profiles SET subscription_status='active',... WHERE id = metadata.supabase_uid
          (fallback: WHERE stripe_customer_id = customerId, with zero-row count guard)
     customer.subscription.updated → status active|inactive WHERE subscription_id=…
     customer.subscription.deleted → status inactive WHERE subscription_id=…
   ↓ { received:true }

[Gate] next protected-page request: middleware reads profiles.subscription_status
        active → allowed ; otherwise → redirect /subscribe
```

> The two halves race: the `/dashboard` redirect (Half A) can land before the webhook (Half B) flips the status, briefly bouncing the user back to `/subscribe`. **[Medium]**

---

# 16. Security Architecture (current implementation)

### Authentication
- Supabase email/password; cookie sessions refreshed in middleware.
- **Cloudflare Turnstile** captcha on login/signup, verified by Supabase Auth (bot/abuse mitigation).
- Signup is **non-enumerable** — `"User already registered"` is swallowed and shows the same success screen ([signup:33-38](src/app/signup/page.tsx#L33-L38)).

### Authorization
- **RLS is the primary boundary** — `auth.uid() = user_id` on all tables (or parent-thread subquery for `email_messages`; `profiles` is `auth.uid() = id`, **select-only** for owners) ([schema.sql](supabase/schema.sql), [style-memory-schema.sql](supabase/style-memory-schema.sql)). Anon key used everywhere **except the Stripe webhook**, which uses the **service-role key (bypasses RLS)** to write `profiles` — justified because it has no session and is authenticated by Stripe signature instead. RPCs are mostly `security invoker` (RLS preserved); `increment_usage` and the `handle_new_user` trigger are `security definer`.
- **Subscription/access gate (two layers)** — (1) middleware redirects logged-in, non-`active` users away from the four app *page* routes to `/subscribe`; (2) the billed API routes (`/api/ai/generate`, `/api/gmail/*`, `/api/style/*`) enforce the same check in-handler via the shared `requirePaidUser(supabase)` helper ([subscription.ts](src/lib/subscription.ts)) — auth + `profiles.subscription_status === 'active'`, returning 401/402. The paywall therefore now covers the cost-incurring endpoints, not just the UI (see §11).
- App-layer checks: per-endpoint `getUser()`; ownership re-check in feedback route; Stripe webhook signature verification.

### Input validation
- **At the sink:** Gmail `to`/`subject` rejected if they contain CR/LF (header-injection prevention) ([send:14-16](src/app/api/gmail/send/route.ts#L14-L16)).
- Style feedback: rating allowlist ([feedback:15,25-27](src/app/api/style/feedback/route.ts#L25-L27)). Add-sample: min length 20.
- Generation: trusts JSON body shape (no schema validation); relies on RLS + downstream slicing/truncation. **[Medium]**

### Database protections
- RLS; FK cascades; uniqueness constraints prevent duplicates (`gmail_message_id`, `(user_id,email)`, `(user_id,gmail_thread_id)`, `message_id`/`generation_id` on samples).
- **No string-interpolated SQL** is the stated rule ([AGENTS.md](AGENTS.md)). Mostly upheld via the query builder. *Two value-interpolation spots exist* in PostgREST `in(...)` filters: sync auto-archive builds an id list string ([sync:297-303](src/app/api/gmail/sync/route.ts#L297-L303)) and backfill builds an exclusion list ([backfill:40-46](src/app/api/style/backfill/route.ts#L40-L46)). These interpolate *values* (Gmail/UUID ids), not SQL, and the backfill file documents the trade-off. **[Medium]**

### API protections
- All sensitive endpoints require auth; AI endpoints have **daily caps** (fail-open) as a cost guard.
- **Stripe webhook** authenticated by HMAC signature verification (`STRIPE_WEBHOOK_SECRET`); rejects unsigned/forged events with 400 before any DB write.
- **Gmail OAuth callback** is CSRF-protected by a `state` cookie matched against the returned `state` param.
- Untrusted email HTML: sanitized (script/handler/`javascript:`/`data:` stripped) at sync, then rendered in a **sandboxed iframe without `allow-same-origin`** — the real containment ([inbox/components/EmailHtmlFrame.tsx](src/app/inbox/components/EmailHtmlFrame.tsx), [sync:108-117](src/app/api/gmail/sync/route.ts#L108-L117)).
- **CSP with per-request nonce + `strict-dynamic`** ([middleware.ts:7-18](middleware.ts#L7-L18)); plus `X-Frame-Options:DENY`, `X-Content-Type-Options:nosniff`, `Referrer-Policy`, `Permissions-Policy` ([next.config.ts](next.config.ts)).

### Secret management
- All secrets via env vars: Supabase anon **and service-role** keys, `GEMINI_API_KEY`, Google OAuth creds, `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`/`NEXT_PUBLIC_STRIPE_PRICE_ID`, `GMAIL_TOKEN_ENCRYPTION_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `NEXT_PUBLIC_APP_URL`. `.env.local` git-ignored. **[Medium]**
- **Two especially sensitive secrets** now exist: `SUPABASE_SERVICE_ROLE_KEY` (full DB access, RLS-bypassing — used only in the webhook) and `GMAIL_TOKEN_ENCRYPTION_KEY` (loss = inability to decrypt stored Gmail tokens; leak = the encryption is moot). Both must be server-only env vars (they are — no `NEXT_PUBLIC_` prefix).

### Data-at-rest encryption
- **Gmail refresh token is now encrypted at rest** with AES-256-GCM ([token-crypto.ts](src/lib/token-crypto.ts)) before storage in `gym_settings.gmail_refresh_token`, replacing the previous plaintext storage. Authenticated encryption (GCM auth tag) also detects tampering. Legacy plaintext rows are tolerated (returned as-is) and re-encrypted on the next Gmail re-connect. **[High]** Residual exposure: a token is briefly plaintext in process memory whenever a Gmail call runs, and the encryption key sits in the same environment as the DB credentials.

---

# 17. Performance Architecture (current behavior)

### Rendering strategy
- Pages are client components that render a spinner, then fetch on mount and hydrate. Root layout forces dynamic rendering via `connection()` ([layout.tsx:17](src/app/layout.tsx#L17)). Minimal use of RSC data loading. **[High]**

### Middleware cost
- Middleware runs `auth.getUser()` on every matched request, **plus an extra `profiles` SELECT** on protected-page requests for the subscription gate ([middleware.ts:96-101](middleware.ts#L96-L101)). So a logged-in user loading `/inbox` incurs: middleware `getUser` + `profiles` query, then the page's own `getUser` (via `UserProvider`) and data fetches. Auth is now effectively resolved twice and subscription once per protected navigation. Acceptable at current scale; no caching of the subscription status between requests. **[Medium]**

### Caching
- No client data cache (no React Query/SWR). Server mutations call `revalidatePath()`. Browser Supabase client is a singleton. **[High]**

### Query optimization
- Indexes on `email_threads(user_id,status)` and `(user_id,last_message_at desc)` support the inbox queries ([schema.sql:62-63](supabase/schema.sql#L62-L63)).
- pgvector **IVFFlat** cosine index (lists=50) on `style_samples.embedding` ([style-memory-schema.sql](supabase/style-memory-schema.sql)); embeddings truncated to 768 dims to fit index limits + reduce cost/latency. Note: since `match_style_samples` now scales distance by feedback `weight`, the `ORDER BY` is a per-user scan+sort rather than an index-served kNN (acceptable because RLS scopes each query to one user's samples).
- `getThreadDetail` does two round-trips (thread+messages join, then latest generation) ([threads.ts:28-45](src/app/actions/threads.ts#L28-L45)).

### Network requests
- Generation: embedding + profile fetched in parallel inside `retrieveStyleContext` ([style-memory.ts:323-330](src/lib/style-memory.ts#L323-L330)).
- **Sync is now incremental + bounded-parallel:** threads whose `gmail_history_id` is unchanged are skipped entirely (no `threads.get`); the remainder are fetched 4-at-a-time via `mapPool`, and each thread's messages are written in a single batched upsert. This replaced the previous strictly-sequential N+1 loop, cutting both API round-trips and DB writes on a typical re-sync. Still capped at 200 listed threads per serverless invocation; backfill remains batched (20) for the same timeout reason. **[High]**
- Prompt inputs are aggressively truncated (last 2 messages ×180 chars; inbound ×400; embed ×1000; raw email ×12000) to control token cost/latency ([generate:9,59-75](src/app/api/ai/generate/route.ts#L59-L75), [style-memory.ts:20](src/lib/style-memory.ts#L20)).

### State update patterns
- Optimistic local updates for archive/contact-type; otherwise refetch after mutation. Inbox "Show more" re-fetches a larger page rather than appending ([inbox/page.tsx:107-116](src/app/inbox/page.tsx#L107-L116)).

> No measured benchmarks exist in the repo; the above is behavioural, from code. **[High]**

---

# 18. Technical Debt Inventory

> Several items from previous revisions have been **resolved** and are no longer debt: the duplicate/misconfigured middleware (now a single correct file), the 722-line `inbox/page.tsx` (split into `inbox/components/*`), the strictly-sequential sync N+1 (now incremental + parallel), `weight` being unused in ranking (now consumed by `match_style_samples`), the unused deps/components/SSE branch (deleted), and — new this revision — **plaintext Gmail refresh tokens** (now AES-256-GCM encrypted via [token-crypto.ts](src/lib/token-crypto.ts)), and — also this revision — the **subscription paywall not covering billed API routes** (every billed route — `/api/ai/generate`, `/api/gmail/*`, `/api/style/*` — now calls `requirePaidUser` from [subscription.ts](src/lib/subscription.ts), which enforces auth + an `active` subscription in-handler). They're called out here so a reader of an older doc isn't confused.

### High Risk
1. **Style learning from live sends often doesn't fire.** `/api/ai/generate` returns `generation:null` ([generate:112](src/app/api/ai/generate/route.ts#L112)), so `approveGeneration`'s `addStyleSample` path is usually skipped on fresh drafts. *Why high:* the headline feature's send-time feedback loop is partially inert; learning effectively depends on manual add-sample/backfill. **[Medium-High]** (Confidence Medium on real-world frequency since a thread could carry a pre-existing generation.)

### Medium Risk
2. **Multiple near-duplicate HTML/text cleaners** with subtle differences: `cleanEmailText` ([style-memory.ts:33](src/lib/style-memory.ts#L33)), `toPlainText` ([generate:11](src/app/api/ai/generate/route.ts#L11)), `cleanBody` (now in [inbox/components/MessageBubble.tsx](src/app/inbox/components/MessageBubble.tsx)), `sanitize` ([sync](src/app/api/gmail/sync/route.ts)). *Why:* will drift — the inbox copy now also owns quoted-text stripping, widening the divergence. **[High]**
3. **200-thread single invocation for sync.** Incremental skip + 4-way parallelism reduced the load, but a first sync (or a busy mailbox where many threads changed) still fetches up to 200 threads in one serverless call. *Why:* timeout/rate-limit risk at the tail. **[Medium]**
4. **Value-interpolated `in(...)` filters** in sync/backfill ([sync](src/app/api/gmail/sync/route.ts), [backfill:40-46](src/app/api/style/backfill/route.ts#L40-L46)) — brushes the "no interpolation in filters" rule and has a documented URL-budget ceiling. **[Medium]**
5. **Redundant `.eq("user_id")` filters** contradict [AGENTS.md](AGENTS.md) (e.g. [threads.ts:16](src/app/actions/threads.ts#L16), [contacts.ts:14](src/app/actions/contacts.ts#L14)). Harmless defense-in-depth but the kind of drift the doc warns about. (Note: the new `samples` route deliberately omits them, per the convention.) **[High]**
6. **Thin test coverage** — only `style-memory.ts` and `style/*` are tested ([jest.config.ts](jest.config.ts)); the riskiest code (sync, send, middleware, generate) is untested. The sync rewrite (parallel `mapPool`, incremental partition) added logic with no tests. **[High]**

6b. **Verbose debug logging in the Stripe webhook.** [stripe/webhook/route.ts](src/app/api/stripe/webhook/route.ts) emits many `console.log/warn/error` lines (added while debugging activation, per commits `3272c47`/`9a92928`), some including `customerId`/`subscriptionId`/`uid`. *Why:* log noise + low-grade identifier leakage into logs; should be trimmed now that activation works. **[Medium]**
6c. **Checkout↔webhook activation race.** Checkout redirects to `/dashboard` while activation happens asynchronously in the webhook; if the webhook is slow, the user is bounced to `/subscribe` despite having paid. No "pending"/polling state. **[Medium]**
6d. **Two sources of truth for subscription status.** Middleware queries `profiles.subscription_status` inline; [subscription.ts](src/lib/subscription.ts) `requirePaidUser` is a separate reader (used by the billed API routes) that the middleware doesn't share. They can drift in interpretation (e.g. handling of `past_due`). The webhook also collapses all Stripe statuses to just `active`/`inactive` ([webhook:105](src/app/api/stripe/webhook/route.ts#L105)), discarding `past_due`/`trialing`/`canceled` nuance. **[Medium]**

### Low Risk
7. **Unused data model:** `templates` (seeded but unread), `scheduled_follow_ups`, `activity_logs`. **[High]**
8. **Repo artifacts** (`ruvector.db`, `tsconfig.tsbuildinfo`, `.venv/`) present in tree. **[Medium]** (verify `.gitignore`).
9. **Split send responsibility** — the `send` route now sends, persists the outbound message, and marks the thread replied; `approveGeneration` separately marks the generation sent + triggers learning. Two writers touch the same thread/generation lifecycle. Minor coupling. **[Medium]**
10. **Non-functional contact form.** [contact/page.tsx](src/app/contact/page.tsx) renders inputs but its `onSubmit` only `preventDefault()`s — it sends nothing. Real contact is via the mailto links. **[Low]**
11. **Legacy plaintext tokens never proactively migrated.** `decryptToken` tolerates pre-encryption rows and they're only re-encrypted opportunistically on the next Gmail re-connect ([token-crypto.ts:37-43](src/lib/token-crypto.ts#L37-L43)) — an account that never re-connects keeps its token in plaintext indefinitely. **[Low]** (No backfill script exists.)

---

# 19. New Engineer Onboarding Guide

### Read first (in this order)
1. [AGENTS.md](AGENTS.md) — the rules that override your instincts (RLS = authz; no SQL interpolation; iframe sandbox; validate at the sink).
2. [README.md](README.md) — product framing + setup + the style-learning explainer.
3. [src/lib/types.ts](src/lib/types.ts) — the whole domain in one screen.
4. [supabase/schema.sql](supabase/schema.sql) + [supabase/style-memory-schema.sql](supabase/style-memory-schema.sql) + [usage-limits-schema.sql](supabase/usage-limits-schema.sql) — the data model **is** the security model.
5. [src/lib/supabase/server.ts](src/lib/supabase/server.ts) & [client.ts](src/lib/supabase/client.ts) — how a request becomes a user-scoped DB client.
6. [middleware.ts](middleware.ts) (root) — auth + CSP. It's the only middleware (the old `src/middleware.ts` duplicate is gone).
7. [src/lib/style-memory.ts](src/lib/style-memory.ts) — the core engine; read with [README.md:125-136](README.md#L125-L136).
8. [src/app/inbox/page.tsx](src/app/inbox/page.tsx) + [inbox/components/](src/app/inbox/components/) + [api/ai/generate](src/app/api/ai/generate/route.ts) + [api/gmail/sync](src/app/api/gmail/sync/route.ts) + [api/gmail/send](src/app/api/gmail/send/route.ts) — the end-to-end core loop.

### Concepts to learn first
- **Next.js App Router** dual backend: Server Actions vs Route Handlers, and when each is used here.
- **Supabase RLS** and why app code does *not* (need to) filter by user.
- **Retrieval-augmented personalization** (embed → kNN → inject), no fine-tuning.
- **Two separate OAuth systems** (Supabase identity vs Gmail access).
- **Three access layers:** RLS (data), middleware auth guard, and the middleware **subscription gate** (`profiles.subscription_status`).
- **Stripe billing split:** synchronous Checkout creation vs asynchronous webhook activation; the webhook is the *only* code that writes subscription state, and the *only* code using the service-role key.
- This is **Next.js 16**; per [AGENTS.md](AGENTS.md), read `node_modules/next/dist/docs/` before touching routing/middleware rather than relying on older-version memory.

### Most critical parts
- `style-memory.ts` (correctness of the product), the Gmail sync MIME walker (data quality), and middleware/RLS (security).

### Easiest to break
- The **iframe sandbox flags** in `EmailHtmlFrame` (never add `allow-same-origin`).
- The **embedding dimension contract** (768) — tied to SQL `vector(768)` + IVFFlat; changing models needs a coordinated migration.
- The **CRLF header check** in `gmail/send`.
- The **HTML cleaners** (several near-duplicate copies — change one, the others drift).
- **Middleware route lists** (now correct; keep them in sync with the actual pages when you add a route — and remember new app pages need adding to `protectedRoutes` to be both auth- and subscription-gated).
- The **per-thread `gmail_history_id` skip** in sync — if you change how/when it's written, you can silently stop ingesting updates to existing threads.
- The **`GMAIL_TOKEN_ENCRYPTION_KEY`** — rotating or losing it makes every stored Gmail token undecryptable (users must re-connect). Never expose it client-side.
- The **Stripe webhook signature check / `STRIPE_WEBHOOK_SECRET`** — without it the service-role webhook would accept forged events and could activate arbitrary accounts.
- The **`metadata.supabase_uid`** passed through Checkout — it's how the webhook maps a Stripe customer back to a Supabase user; drop it and activation falls back to the fragile customer-id lookup.

### Suggested first tasks (to learn safely)
- Read-only: trace one generate→send cycle with logging.
- Run the tests: `npm test` (covers `style-memory.ts`).
- Local run: `npm run dev` after setting env vars ([README.md:62-71](README.md#L62-L71)).

---

# 20. Glossary

### Product / features
- **Reply Rules / gym context** — free-text rules (`gym_settings.gym_context`) injected verbatim into every generation prompt.
- **Style learning / style memory** — retrieval-based personalization from past replies (`style_samples` + `style_profile` + `style_feedback`).
- **Style sample** — one cleaned outbound email stored with an embedding + `weight`. The `weight` (raised/lowered by feedback) now scales retrieval ranking, and samples can be listed/removed from Settings.
- **Style profile** — aggregate stats (tone score, avg words, greetings/sign-offs) over a user's samples.
- **Backfill** — batch import of historical sent emails into style memory.
- **Sync** — pulling recent Gmail Primary threads into the DB; **incremental** (skips threads whose `gmail_history_id` is unchanged) and **bounded-parallel** (`mapPool`, 4 at a time).
- **Auto-archive** — marking threads `archived` when they leave the Primary set within the 14-day window.
- **`gmail_history_id`** — Gmail's per-thread change marker, stored on `email_threads` so a re-sync can skip unchanged threads.
- **Subscription gate / paywall** — middleware redirect of logged-in, non-`active` users to `/subscribe`; page-level only.
- **Checkout session** — a Stripe-hosted payment page created by `/api/stripe/checkout`.
- **Stripe webhook** — server-to-server callback that records subscription state into `profiles`; signature-verified, service-role.
- **Turnstile** — Cloudflare captcha on login/signup, verified by Supabase Auth.

### Components
- **UserProvider / useUser** — global auth context.
- **ClientLayout** — client shell choosing chrome by route.
- **ThreadView / MessageBubble / ReplyPanel / StyleFeedback / EmailHtmlFrame** — inbox sub-components.
- **EmailHtmlFrame** — sandboxed iframe rendering untrusted email HTML.
- **Design system** — `Button`, `Card`, `Input`/`Textarea`/`Select`, `Badge`.

### Services / modules
- **Server Action** — `"use server"` function called directly from the client ([actions/](src/app/actions/)).
- **Route Handler** — HTTP endpoint under [api/](src/app/api/).
- **style-memory.ts** — the personalization engine.
- **usage-limits.ts** — daily cost guard.
- **subscription.ts** — reads `profiles.subscription_status` (helper; not used by the middleware gate).
- **token-crypto.ts** — AES-256-GCM encrypt/decrypt of the Gmail refresh token (`enc:v1:` format).
- **enforceDailyLimit / increment_usage** — soft per-user daily cap (fail-open) + its atomic Postgres function.

### Database entities
- **profiles** — per-user subscription state (Stripe ids, status, period end); service-role-written.
- **gym_settings, contacts, email_threads, email_messages, ai_generations** — core.
- **style_samples, style_profile, style_feedback** — style learning.
- **usage_counters** — daily caps.
- **templates, scheduled_follow_ups, activity_logs** — defined but unused by app code.
- **match_style_samples / apply_style_feedback / increment_usage** — RPC functions; **handle_new_user** — trigger that auto-creates a `profiles` row.

### Internal terminology / config
- **RLS (Row-Level Security)** — Postgres policies enforcing `auth.uid() = user_id`; the app's authorization boundary.
- **security invoker / definer** — RPC execution context (caller's vs creator's permissions).
- **IVFFlat** — pgvector approximate-nearest-neighbour index used for style retrieval.
- **Matryoshka truncation** — using the leading 768 dims of a larger embedding (+ renormalize) without major quality loss.
- **CSP nonce / strict-dynamic** — per-request script allowlisting set in middleware.
- **`cn()`** — clsx class-name helper.
- **`@/*`** — TS path alias → `src/*` ([tsconfig.json](tsconfig.json)).
- **Primary category** — the Gmail inbox tab filtered in sync (`category:primary`).

---

## Confidence & Limitations Summary
- **High confidence:** folder/route structure (incl. the inbox component split and the new `subscribe`/`stripe` routes), data model (incl. `gmail_history_id` and `profiles`), RLS-as-authz + the single service-role exception, the generate/sync/send flows, the Stripe checkout/webhook flow, the subscription gate in middleware (and that it does **not** cover `/api/*`), Gmail token encryption, Turnstile on auth — all read directly from the current source.
- **Medium confidence:** real-world frequency of the "generation:null skips learning" issue; exact caching behaviour of Next 16 RSC; `connection()` intent; the precise Stripe API version pinned by `stripe@^22`; the practical likelihood of the checkout↔webhook activation race.
- **Could not be determined from the codebase:** production env-var values (`.env.local`/`.env.local.example` are outside the readable path); whether the SQL files (incl. the `profiles` table + trigger) have actually been applied to the live DB (they are manual); whether the live Supabase project has Turnstile captcha actually enabled (the app only supplies the token); runtime performance numbers; whether `templates`/`scheduled_follow_ups`/`activity_logs` are used by anything outside this repo.

*End of document.*
