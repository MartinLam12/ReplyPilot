import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("subscription_status, current_period_end")
    .single();

  const now = new Date().toISOString();
  const active =
    profile?.subscription_status === "active" &&
    !!profile?.current_period_end &&
    profile.current_period_end > now;

  return NextResponse.json({ status: active ? "active" : "inactive" });
}
