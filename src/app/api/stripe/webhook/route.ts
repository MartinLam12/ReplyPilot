import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

// Service role client — only for writing subscription status from webhook.
function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

// In Stripe SDK v22+ current_period_end moved from Subscription to SubscriptionItem.
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

        console.log("[webhook] checkout.session.completed: attempting update by stripe_customer_id", { customerId, subscriptionId });
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
        console.log("[webhook] checkout.session.completed: update-by-customerId result", { customerId, subscriptionId, error: error ?? null, count });

        if (error || !count) {
          // stripe_customer_id may not be set yet on first checkout —
          // fall back to supabase uid stored in customer metadata.
          const customer = await stripe.customers.retrieve(customerId);
          if (customer.deleted) {
            console.error("[webhook] customer deleted:", customerId);
            break;
          }
          const uid = (customer as Stripe.Customer).metadata?.supabase_uid;
          if (!uid) {
            console.error("[webhook] no supabase_uid on customer:", customerId);
            break;
          }
          console.log("[webhook] checkout.session.completed: attempting fallback update by uid", { customerId, subscriptionId, uid });
          const { error: err2 } = await supabase
            .from("profiles")
            .update({
              stripe_customer_id: customerId,
              subscription_id: subscriptionId,
              subscription_status: "active",
              current_period_end: periodEnd,
              updated_at: new Date().toISOString(),
            })
            .eq("id", uid);
          console.log("[webhook] checkout.session.completed: fallback update-by-uid result", { customerId, subscriptionId, uid, error: err2 ?? null });
          if (err2) {
            console.error("[webhook] checkout.session.completed update failed:", err2);
          } else {
            console.log("[webhook] checkout.session.completed: activated uid", uid);
          }
        } else {
          console.log("[webhook] checkout.session.completed: activated customer", customerId);
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
