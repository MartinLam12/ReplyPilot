"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { Contact } from "@/lib/types";

export async function listContacts(type?: string): Promise<Contact[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  let query = supabase
    .from("contacts")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (type) {
    query = query.eq("type", type);
  }

  const { data } = await query;
  return (data as Contact[]) || [];
}

export async function updateContactType(contactId: string, type: string): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  await supabase
    .from("contacts")
    .update({ type })
    .eq("id", contactId)
    .eq("user_id", user.id);

  revalidatePath("/contacts");
}

export async function upsertContact(
  email: string,
  name?: string,
  type?: string
): Promise<Contact | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("contacts")
    .upsert(
      { user_id: user.id, email, name: name || null, type: type || "lead" },
      { onConflict: "user_id,email" }
    )
    .select()
    .single();

  revalidatePath("/contacts");
  return data as Contact;
}
