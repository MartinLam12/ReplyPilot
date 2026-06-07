import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@/lib/supabase/server";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

// GET: return current_period_end so the confirm UI can show it before the user commits.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // RLS scopes this to the authenticated user — no explicit user_id filter needed.
  const { data } = await supabase
    .from("profiles")
    .select("subscription_id, current_period_end")
    .single();

  return NextResponse.json({
    periodEnd: data?.subscription_id ? (data.current_period_end ?? null) : null,
  });
}

// POST: schedule cancellation at period end. Does NOT update profiles — the
// customer.subscription.updated webhook handles that to avoid a write race.
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // RLS scopes this to the authenticated user — no explicit user_id filter needed.
  const { data } = await supabase
    .from("profiles")
    .select("subscription_id")
    .single();

  const subscriptionId = data?.subscription_id as string | null | undefined;
  if (!subscriptionId) {
    return NextResponse.json({ error: "No active subscription found" }, { status: 400 });
  }

  let subscription: Stripe.Subscription;
  try {
    subscription = await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
    });
  } catch (err) {
    console.error("[cancel] stripe update failed:", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: "Could not schedule cancellation. Please try again." },
      { status: 500 }
    );
  }

  const item = subscription.items?.data?.[0];
  const periodEnd = item?.current_period_end
    ? new Date(item.current_period_end * 1000).toISOString()
    : null;

  return NextResponse.json({ periodEnd });
}
