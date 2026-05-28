/**
 * POST /api/style/backfill
 *
 * Processes the user's existing outbound email_messages into style_samples.
 * Call once after enabling the style learning module, then on demand.
 *
 * Processes in batches of 20 to stay within Vercel's function timeout.
 * Returns { processed, skipped, total } so the caller can show progress
 * and know when to call again (processed < total means more remain).
 *
 * Idempotent: the UNIQUE constraint on message_id means re-running is safe.
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { addStyleSample, updateStyleProfile } from "@/lib/style-memory";

const BATCH_SIZE = 20;

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Fetch already-processed message ids in a separate round-trip rather than
  // embedding a raw SQL subquery in the filter (which would bypass PostgREST
  // parameterization). RLS restricts style_samples to this user automatically.
  //
  // Trip-wire: if a single user accumulates more than a few hundred style_samples,
  // the UUID list will outgrow PostgREST's URL filter budget — switch to a
  // Postgres function (e.g. unprocessed_outbound_messages(p_limit int)) then.
  const { data: processedRows } = await supabase
    .from("style_samples")
    .select("message_id")
    .not("message_id", "is", null);

  const processedIds = (processedRows ?? [])
    .map((r) => r.message_id as string | null)
    .filter((id): id is string => !!id);

  const exclusionList = processedIds.length ? `(${processedIds.join(",")})` : null;

  let messagesQuery = supabase
    .from("email_messages")
    .select("id, body_text, thread_id")
    .eq("direction", "outbound");
  if (exclusionList) messagesQuery = messagesQuery.not("id", "in", exclusionList);

  const { data: messages, error } = await messagesQuery
    .order("sent_at", { ascending: false })
    .limit(BATCH_SIZE);

  if (error) {
    console.error("[backfill] query error:", error.message);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }

  // Count total remaining (for progress reporting)
  let countQuery = supabase
    .from("email_messages")
    .select("id", { count: "exact", head: true })
    .eq("direction", "outbound");
  if (exclusionList) countQuery = countQuery.not("id", "in", exclusionList);

  const { count: totalRemaining } = await countQuery;

  let processed = 0;
  let skipped   = 0;

  for (const msg of messages ?? []) {
    if (!msg.body_text?.trim()) { skipped++; continue; }

    await addStyleSample(supabase, user.id, msg.body_text, {
      messageId: msg.id,
    });
    processed++;
  }

  // Recompute style profile after batch
  if (processed > 0) {
    await updateStyleProfile(supabase, user.id);
  }

  return NextResponse.json({
    processed,
    skipped,
    remaining: Math.max(0, (totalRemaining ?? 0) - processed),
  });
}
