"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { GymSettings } from "@/lib/types";

export async function getGymSettings(): Promise<GymSettings | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("gym_settings")
    .select("*")
    .eq("user_id", user.id)
    .single();

  return data;
}

export async function saveGymSettings(gymName: string, gymContext: string): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  await supabase.from("gym_settings").upsert(
    {
      user_id: user.id,
      gym_name: gymName,
      gym_context: gymContext,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );

  revalidatePath("/settings");
}

export async function disconnectGmail(): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  await supabase
    .from("gym_settings")
    .update({
      gmail_email: null,
      gmail_refresh_token: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id);

  revalidatePath("/settings");
}
