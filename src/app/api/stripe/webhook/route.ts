import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripeKey = process.env.STRIPE_SECRET_KEY;
if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not configured");
const stripe = new Stripe(stripeKey);

function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

function getPeriodEnd(subscription: Stripe.Subscription): string | null {
  const item = subscription.items?.data?.[0];
  if (!item?.current_period_end) return null;
  return new Date(item.current_period_end * 1000).toISOString();
}

export async function POST(request: NextRequest) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("[webhook] STRIPE_WEBHOOK_SECRET is not configured");
    return NextResponse.json({ error: "Service misconfigured" }, { status: 500 });
  }

  const body = await request.text();
  const sig = request.headers.get("stripe-signature");

  if (!sig) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      webhookSecret
    );
  } catch (err) {
    console.error("[webhook] signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const supabase = createServiceClient();

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== "subscription") break;

        const customerId = session.customer as string;
        const subscriptionId = session.subscription as string | null;
        if (!subscriptionId) {
          console.error("[webhook] checkout.session.completed: null subscriptionId, skipping");
          break;
        }

        const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
          expand: ["items"],
        });
        const periodEnd = getPeriodEnd(subscription);

        // Primary path: read uid from session metadata (set in checkout route).
        const uid = session.metadata?.supabase_uid;

        if (uid) {
          const { error, count } = await supabase
            .from("profiles")
            .update({
              stripe_customer_id: customerId,
              subscription_id: subscriptionId,
              subscription_status: "active",
              current_period_end: periodEnd,
              updated_at: new Date().toISOString(),
            }, { count: "exact" })
            .eq("id", uid);
          if (error || !count) {
            console.error("[webhook] checkout.session.completed: update failed — user not activated", { error: error?.message });
          } else {
            console.log("[webhook] checkout.session.completed: activated via metadata uid");
            await supabase.from("activity_logs").insert({
              user_id: uid,
              entity_type: "subscription",
              action: "activated",
              entity_id: null,
              metadata: { subscription_id: subscriptionId },
            });
          }
          break;
        }

        // Fallback: try existing stripe_customer_id on profiles.
        console.warn("[webhook] checkout.session.completed: no uid in metadata, falling back to customer lookup");
        const { data: updatedProfiles, error, count } = await supabase
          .from("profiles")
          .update({
            stripe_customer_id: customerId,
            subscription_id: subscriptionId,
            subscription_status: "active",
            current_period_end: periodEnd,
            updated_at: new Date().toISOString(),
          }, { count: "exact" })
          .eq("stripe_customer_id", customerId)
          .select("id");

        if (error || !count) {
          console.error("[webhook] checkout.session.completed: fallback lookup failed — user not activated", { error: error?.message });
        } else {
          console.log("[webhook] checkout.session.completed: activated via fallback");
          const resolvedUid = updatedProfiles?.[0]?.id;
          if (resolvedUid) {
            await supabase.from("activity_logs").insert({
              user_id: resolvedUid,
              entity_type: "subscription",
              action: "activated",
              entity_id: null,
              metadata: { subscription_id: subscriptionId },
            });
          }
        }
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const periodEnd = getPeriodEnd(subscription);
        const { error } = await supabase
          .from("profiles")
          .update({
            subscription_status: subscription.status === "active" ? "active" : "inactive",
            current_period_end: periodEnd,
            updated_at: new Date().toISOString(),
          })
          .eq("subscription_id", subscription.id);
        if (error) {
          console.error("[webhook] customer.subscription.updated: DB update failed", { error: error.message });
        } else {
          console.log("[webhook] customer.subscription.updated: status →", subscription.status);
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const { data: cancelledProfiles, error } = await supabase
          .from("profiles")
          .update({
            subscription_status: "inactive",
            updated_at: new Date().toISOString(),
          })
          .eq("subscription_id", subscription.id)
          .select("id");
        if (error) {
          console.error("[webhook] customer.subscription.deleted: DB update failed", { error: error.message });
        } else {
          console.log("[webhook] customer.subscription.deleted: deactivated");
          const resolvedUid = cancelledProfiles?.[0]?.id;
          if (resolvedUid) {
            await supabase.from("activity_logs").insert({
              user_id: resolvedUid,
              entity_type: "subscription",
              action: "cancelled",
              entity_id: null,
              metadata: { subscription_id: subscription.id },
            });
          }
        }
        break;
      }

      default:
        break;
    }
  } catch (err) {
    console.error("[webhook] handler error for", event.type, err);
    return NextResponse.json({ error: "Handler error" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}