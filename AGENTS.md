<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Security conventions

- **RLS is the ownership boundary.** Every table has `auth.uid() = user_id` policies (see `supabase/*.sql`). The Supabase client used by routes and server actions runs as the authenticated user, so reads and writes are automatically scoped. Do **not** add redundant `.eq("user_id", user.id)` filters at call sites — they are spot-treatment that drifts and teaches the wrong rule. The one place an explicit filter is required is if you ever use the service-role key (which bypasses RLS) — and that itself needs review.
- **No string-interpolated SQL anywhere.** All DB access goes through the Supabase query builder. If you reach for a raw subquery or a `${value}` inside a filter string, stop: fetch the IDs in a separate round-trip and pass them as values, or define a Postgres function. Keep the codebase free of this pattern.
- **Inbound email HTML renders inside a sandboxed iframe** (`src/app/inbox/page.tsx`). The sandbox omits `allow-same-origin` on purpose — that is what actually contains untrusted email content. The regex sanitiser in the sync route is defence-in-depth only; do not weaken the iframe sandbox.
- **Validate at the sink, not in middleware.** Output-bound fields (e.g. email headers) are validated in the route that emits them. Do not introduce a global validation layer.
