/**
 * POST /api/style/add-sample
 *
 * Adds a manually pasted email as a style sample.
 * Body: { body: string }
 *
 * Returns:
 *   200 { ok: true, sampleCount: number }  — sample saved
 *   400 { error: string }                  — input validation failed
 *   500 { error: string }                  — DB or embedding failure
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { addStyleSample, updateStyleProfile } from "@/lib/style-memory";
import { enforceDailyLimit } from "@/lib/usage-limits";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const emailBody = body?.body?.trim();

  if (!emailBody || emailBody.length < 20) {
    return NextResponse.json({ error: "Email text too short" }, { status: 400 });
  }

  const limit = await enforceDailyLimit(supabase, "add_sample");
  if (!limit.allowed) {
    return NextResponse.json({ error: limit.message }, { status: 429 });
  }

  const result = await addStyleSample(supabase, user.id, emailBody);

  if (!result.saved) {
    return NextResponse.json(
      { error: result.reason ?? "Failed to save style sample" },
      { status: 500 }
    );
  }

  await updateStyleProfile(supabase, user.id);

  const { data: profile } = await supabase
    .from("style_profile")
    .select("sample_count")
    .eq("user_id", user.id)
    .single();

  // Use 0 as the fallback — never fake a non-zero count
  return NextResponse.json({ ok: true, sampleCount: profile?.sample_count ?? 0 });
}
