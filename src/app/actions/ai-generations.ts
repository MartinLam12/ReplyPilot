"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePaidUser } from "@/lib/subscription";
import { enforceDailyLimit } from "@/lib/usage-limits";
import { addStyleSample, updateStyleProfile } from "@/lib/style-memory";
import { revalidatePath } from "next/cache";

export async function approveGeneration(
  finalBody: string,
  threadId: string,
  generationId?: string | null
): Promise<void> {
  const supabase = await createClient();
  const auth = await requirePaidUser(supabase);
  if (!auth.ok) return;
  const user = auth.user;

  const limit = await enforceDailyLimit(supabase, "add_sample");
  if (!limit.allowed) return;

  // Only update a generation row if one actually exists. Fresh drafts from
  // /api/ai/generate don't persist a row, so generationId is often null —
  // style learning below must run regardless.
  if (generationId) {
    await supabase
      .from("ai_generations")
      .update({ status: "sent", final_body: finalBody })
      .eq("id", generationId)
      .eq("user_id", user.id);
  }

  await supabase
    .from("email_threads")
    .update({ status: "replied" })
    .eq("id", threadId)
    .eq("user_id", user.id);

  // ── Style learning: add this sent reply as a voice sample ─────────────────
  // Runs after DB update, never throws — a failure here must not affect the UX.
  // Fires on every send, whether or not a generation row pre-existed.
  if (finalBody?.trim().length > 20) {
    await addStyleSample(supabase, user.id, finalBody, generationId ? { generationId } : {});
    await updateStyleProfile(supabase, user.id);
  } else {
    console.warn(
      "[approveGeneration] style learning skipped — body too short",
      JSON.stringify({ threadId, generationId: generationId ?? null, bodyLength: finalBody?.trim().length ?? 0 })
    );
  }

  revalidatePath("/inbox");
}

export async function rejectGeneration(generationId: string): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  await supabase
    .from("ai_generations")
    .update({ status: "rejected" })
    .eq("id", generationId)
    .eq("user_id", user.id);

  revalidatePath("/inbox");
}
