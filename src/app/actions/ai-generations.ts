"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function approveGeneration(
  generationId: string,
  finalBody: string,
  threadId: string
): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  await supabase
    .from("ai_generations")
    .update({ status: "sent", final_body: finalBody })
    .eq("id", generationId)
    .eq("user_id", user.id);

  await supabase
    .from("email_threads")
    .update({ status: "replied" })
    .eq("id", threadId);

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
