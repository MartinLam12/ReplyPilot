"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { EmailThread } from "@/lib/types";

export async function listThreads(): Promise<EmailThread[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase
    .from("email_threads")
    .select("*, contact:contacts(*)")
    .eq("user_id", user.id)
    .neq("status", "archived")
    .order("last_message_at", { ascending: false })
    .limit(50);

  return (data as EmailThread[]) || [];
}

export async function getThreadDetail(threadId: string): Promise<EmailThread | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: thread } = await supabase
    .from("email_threads")
    .select("*, contact:contacts(*), messages:email_messages(*)")
    .eq("id", threadId)
    .eq("user_id", user.id)
    .order("sent_at", { referencedTable: "email_messages", ascending: true })
    .single();

  if (!thread) return null;

  const { data: generation } = await supabase
    .from("ai_generations")
    .select("*")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  return { ...(thread as EmailThread), latest_generation: generation || null };
}

export async function archiveThread(threadId: string): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  await supabase
    .from("email_threads")
    .update({ status: "archived" })
    .eq("id", threadId)
    .eq("user_id", user.id);

  revalidatePath("/inbox");
}
