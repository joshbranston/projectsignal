import type Stripe from "stripe";
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { stripeClient } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

function mapStatus(status: string) {
  const allowed = new Set(["trialing","active","past_due","canceled","paused","incomplete"]);
  if (allowed.has(status)) return status;
  if (status === "unpaid") return "past_due";
  if (status === "incomplete_expired") return "canceled";
  return "incomplete";
}

function asId(value: string | { id: string } | null | undefined) {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

async function syncSubscription(subscription: Stripe.Subscription) {
  const admin = createAdminClient();
  const companyFromMetadata = subscription.metadata?.company_id;
  const subscriptionId = subscription.id;
  const customerId = asId(subscription.customer);

  let companyId = companyFromMetadata;
  if (!companyId) {
    const { data } = await admin
      .from("subscriptions")
      .select("company_id")
      .eq("provider_subscription_id", subscriptionId)
      .maybeSingle();
    companyId = data?.company_id;
  }

  if (!companyId) return;

  const currentPeriodEnd =
    // Stripe's current SDK exposes this on Subscription.
    (subscription as any).current_period_end
      ? new Date((subscription as any).current_period_end * 1000).toISOString()
      : null;

  await admin
    .from("subscriptions")
    .update({
      provider_customer_id: customerId,
      provider_subscription_id: subscriptionId,
      status: mapStatus(subscription.status),
      current_period_ends_at: currentPeriodEnd,
      cancel_at_period_end: subscription.cancel_at_period_end
    })
    .eq("company_id", companyId);
}

export async function POST(request: Request) {
  const stripe = stripeClient();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 503 });
  }

  const signature = (await headers()).get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing Stripe signature" }, { status: 400 });

  const body = await request.text();
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch {
    return NextResponse.json({ error: "Invalid Stripe signature" }, { status: 400 });
  }

  const admin = createAdminClient();

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const companyId = session.metadata?.company_id || session.client_reference_id;
      if (companyId) {
        await admin
          .from("subscriptions")
          .update({
            provider_customer_id: asId(session.customer),
            provider_subscription_id: asId(session.subscription),
            status: session.payment_status === "paid" ? "active" : "incomplete"
          })
          .eq("company_id", companyId);
      }
      break;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await syncSubscription(event.data.object as Stripe.Subscription);
      break;

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = asId(invoice.customer);
      if (customerId) {
        await admin
          .from("subscriptions")
          .update({ status: "past_due" })
          .eq("provider_customer_id", customerId);
      }
      break;
    }
  }

  return NextResponse.json({ received: true });
}
