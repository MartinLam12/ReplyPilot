import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";

type PaidUserResult =
  | { ok: true; user: User }
  | { ok: false; res: NextResponse };

// Auth + active-subscription gate for billed API routes. Returns the user on
// success, or a NextResponse (401/402) the caller should return as-is.
export async function requirePaidUser(
  supabase: SupabaseClient
): Promise<PaidUserResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    console.warn("[auth] unauthenticated request rejected");
    return { ok: false, res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("subscription_status, current_period_end")
    .eq("id", user.id)
    .single();

  const now = new Date().toISOString();
  if (
    profile?.subscription_status !== "active" ||
    !profile?.current_period_end ||
    profile.current_period_end <= now
  ) {
    console.warn("[auth] subscription gate rejected", { userId: user.id });
    return { ok: false, res: NextResponse.json({ error: "Subscription required" }, { status: 402 }) };
  }

  return { ok: true, user };
}
