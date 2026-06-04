import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

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
      process.env.STRIPE_WEBHOOK_SECRET!
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
        const subscriptionId = session.subscription as string;

        const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
          expand: ["items"],
        });
        const periodEnd = getPeriodEnd(subscription);

        // Primary path: read uid from session metadata (set in checkout route).
        const uid = session.metadata?.supabase_uid;

        if (uid) {
          console.log("[webhook] checkout.session.completed: updating by uid from session metadata", { uid, customerId, subscriptionId });
          const { error } = await supabase
            .from("profiles")
            .update({
              stripe_customer_id: customerId,
              subscription_id: subscriptionId,
              subscription_status: "active",
              current_period_end: periodEnd,
              updated_at: new Date().toISOString(),
            })
            .eq("id", uid);
          if (error) {
            console.error("[webhook] checkout.session.completed update failed:", error);
          } else {
            console.log("[webhook] checkout.session.completed: activated uid", uid);
          }
          break;
        }

        // Fallback: try existing stripe_customer_id on profiles.
        console.warn("[webhook] no supabase_uid in session metadata, falling back to stripe_customer_id lookup", { customerId });
        const { error, count } = await supabase
          .from("profiles")
          .update({
            stripe_customer_id: customerId,
            subscription_id: subscriptionId,
            subscription_status: "active",
            current_period_end: periodEnd,
            updated_at: new Date().toISOString(),
          }, { count: "exact" })
          .eq("stripe_customer_id", customerId);

        if (error || !count) {
          console.error("[webhook] fallback lookup also failed — user not activated", { customerId, error });
        } else {
          console.log("[webhook] checkout.session.completed: activated via fallback", customerId);
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
          console.error("[webhook] customer.subscription.updated failed:", error);
        } else {
          console.log("[webhook] customer.subscription.updated:", subscription.id, subscription.status);
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const { error } = await supabase
          .from("profiles")
          .update({
            subscription_status: "inactive",
            updated_at: new Date().toISOString(),
          })
          .eq("subscription_id", subscription.id);
        if (error) {
          console.error("[webhook] customer.subscription.deleted failed:", error);
        } else {
          console.log("[webhook] customer.subscription.deleted:", subscription.id);
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