/**
 * GET    /api/style/samples        — list the user's writing-style examples
 * DELETE /api/style/samples?id=…   — remove one example
 *
 * Both rely on RLS (auth.uid() = user_id) to scope rows to the caller, so no
 * explicit user_id filter is needed at the call site.
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { updateStyleProfile } from "@/lib/style-memory";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("style_samples")
    .select("id, clean_body, word_count, context_cluster, created_at")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ samples: data ?? [] });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  // RLS ensures this only ever deletes a row the caller owns.
  const { error } = await supabase.from("style_samples").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Recompute the style profile so future drafts reflect the removal.
  await updateStyleProfile(supabase, user.id);

  const { data: profile } = await supabase
    .from("style_profile")
    .select("sample_count")
    .eq("user_id", user.id)
    .single();

  return NextResponse.json({ ok: true, sampleCount: profile?.sample_count ?? 0 });
}
