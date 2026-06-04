/**
 * POST /api/style/feedback
 *
 * Records user feedback on a generated reply and adjusts the weight of the
 * corresponding style_sample so future retrieval reflects the user's preference.
 *
 * Body: { generationId: string, rating: 'good' | 'too_formal' | 'too_casual' | 'wrong_style' }
 *
 * Weight adjustment is handled by the apply_style_feedback Postgres function
 * which clamps weight between 0.1 and 2.0.
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requirePaidUser } from "@/lib/subscription";

const VALID_RATINGS = new Set(["good", "too_formal", "too_casual", "wrong_style"]);

export async function POST(request: Request) {
  const supabase = await createClient();
  const auth = await requirePaidUser(supabase);
  if (!auth.ok) return auth.res;
  const user = auth.user;

  const body = await request.json().catch(() => null);
  const { generationId, rating } = body ?? {};

  if (!generationId || !rating || !VALID_RATINGS.has(rating)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // Verify the generation belongs to this user before recording feedback
  const { data: gen } = await supabase
    .from("ai_generations")
    .select("id")
    .eq("id", generationId)
    .eq("user_id", user.id)
    .single();

  if (!gen) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Store the feedback (ON CONFLICT DO NOTHING: one rating per generation)
  await supabase
    .from("style_feedback")
    .upsert(
      { user_id: user.id, generation_id: generationId, rating },
      { onConflict: "generation_id" }
    );

  // Adjust sample weight via stored procedure
  await supabase.rpc("apply_style_feedback", {
    p_generation_id: generationId,
    p_rating:        rating,
  });

  return NextResponse.json({ ok: true });
}
