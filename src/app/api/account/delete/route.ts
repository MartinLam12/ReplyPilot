import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

// Service-role client — bypasses RLS. Used only for auth user deletion (step 5).
function createServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

export async function POST() {
  // ── Step 1: Authenticate ──────────────────────────────────────────────────
  // All subsequent DB operations use this RLS-scoped client; every delete is
  // automatically restricted to the authenticated user's rows.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // ── Step 2: Read subscription before touching anything ────────────────────
  const { data: profile } = await supabase
    .from("profiles")
    .select("subscription_id")
    .single();

  // ── Step 3: Cancel Stripe subscription immediately (not at period end) ────
  // Must happen before DB deletion so the profile row still exists for Stripe
  // to reference. Abort on failure — no data has been touched yet.
  if (profile?.subscription_id) {
    try {
      await stripe.subscriptions.cancel(profile.subscription_id as string);
    } catch (err) {
      const stripeErr = err as InstanceType<typeof Stripe.errors.StripeError>;
      const alreadyCancelled =
        stripeErr?.code === "subscription_already_canceled" ||
        (stripeErr as unknown as { status?: string })?.status === "canceled";
      if (!alreadyCancelled) {
        console.error(
          "[delete-account] Stripe cancel failed:",
          err instanceof Error ? err.message : err
        );
        return NextResponse.json(
          { error: "Could not cancel your subscription. Please try again or contact support." },
          { status: 500 }
        );
      }
    }
  }

  // ── Step 4: Delete app data in FK-safe order ──────────────────────────────
  // The .eq("user_id", ...) filter is required by the Supabase client to
  // execute a delete (it refuses filterless deletes). RLS still provides the
  // security boundary — this filter is belt-and-suspenders only.
  try {
    // 4a. scheduled_follow_ups — references contacts, email_threads, templates,
    //     and ai_generations with default RESTRICT; must go before all of them.
    const { error: e1 } = await supabase
      .from("scheduled_follow_ups")
      .delete()
      .eq("user_id", user.id);
    if (e1) throw new Error(`scheduled_follow_ups: ${e1.message}`);

    // 4b. style_samples — FK to email_messages/ai_generations is set-null so
    //     rows survive parent deletion; must be deleted explicitly.
    const { error: e2 } = await supabase
      .from("style_samples")
      .delete()
      .eq("user_id", user.id);
    if (e2) throw new Error(`style_samples: ${e2.message}`);

    // 4c. style_profile — no cascade, must be deleted explicitly.
    const { error: e3 } = await supabase
      .from("style_profile")
      .delete()
      .eq("user_id", user.id);
    if (e3) throw new Error(`style_profile: ${e3.message}`);

    // 4d. email_threads — cascades to email_messages, ai_generations,
    //     and (via ai_generations) style_feedback.
    const { error: e4 } = await supabase
      .from("email_threads")
      .delete()
      .eq("user_id", user.id);
    if (e4) throw new Error(`email_threads: ${e4.message}`);

    // 4e. contacts — safe now that scheduled_follow_ups is gone.
    const { error: e5 } = await supabase
      .from("contacts")
      .delete()
      .eq("user_id", user.id);
    if (e5) throw new Error(`contacts: ${e5.message}`);

    // 4f. templates — RLS excludes system rows (user_id = null); only user rows deleted.
    const { error: e6 } = await supabase
      .from("templates")
      .delete()
      .eq("user_id", user.id);
    if (e6) throw new Error(`templates: ${e6.message}`);

    // 4g. gym_settings — also removes the encrypted Gmail refresh token.
    const { error: e7 } = await supabase
      .from("gym_settings")
      .delete()
      .eq("user_id", user.id);
    if (e7) throw new Error(`gym_settings: ${e7.message}`);

    // 4h. activity_logs
    const { error: e8 } = await supabase
      .from("activity_logs")
      .delete()
      .eq("user_id", user.id);
    if (e8) throw new Error(`activity_logs: ${e8.message}`);

    // 4i. usage_counters
    const { error: e9 } = await supabase
      .from("usage_counters")
      .delete()
      .eq("user_id", user.id);
    if (e9) throw new Error(`usage_counters: ${e9.message}`);
  } catch (err) {
    console.error(
      "[delete-account] Data deletion failed:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { error: "Could not delete your account data. Please try again or contact support." },
      { status: 500 }
    );
  }

  // ── Step 5: Delete the Supabase auth user ─────────────────────────────────
  // Requires the service-role client — regular clients cannot call admin methods.
  // This also cascades to the profiles row (profiles.id references auth.users
  // on delete cascade), so profiles must NOT be deleted manually above.
  const adminClient = createServiceClient();
  const { error: authDeleteError } = await adminClient.auth.admin.deleteUser(user.id);
  if (authDeleteError) {
    console.error("[delete-account] Auth user deletion failed:", authDeleteError.message);
    return NextResponse.json(
      { error: "Could not remove your account. Please contact support." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
