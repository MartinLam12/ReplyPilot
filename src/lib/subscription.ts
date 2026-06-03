import { createClient } from "@/lib/supabase/server";

export async function getUserSubscriptionStatus(
  userId: string
): Promise<{ active: boolean; currentPeriodEnd: Date | null }> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("profiles")
    .select("subscription_status, current_period_end")
    .eq("id", userId)
    .single();

  if (!data) {
    return { active: false, currentPeriodEnd: null };
  }

  return {
    active: data.subscription_status === "active",
    currentPeriodEnd: data.current_period_end
      ? new Date(data.current_period_end)
      : null,
  };
}
