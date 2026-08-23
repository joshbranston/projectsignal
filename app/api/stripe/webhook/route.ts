import type Stripe from "stripe";
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { stripeClient } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getSubscriptionCurrentPeriodEnd,
  stripeUnixToIso
} from "@/lib/billing/subscription";

export const runtime = "nodejs";

function mapStatus(status: string) {
  const allowed = new Set(["trialing", "active", "past_due", "canceled", "paused", "incomplete"]);
  if (allowed.has(status)) return status;
  if (status === "unpaid") return "past_due";
  if (status === "incomplete_expired") return "canceled";
  return "incomplete";
}

function asId(value: string | { id: string } | null | undefined) {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

async function activateInitialCounties(
  companyId: string,
  effectiveAt: string,
  lockedUntil: string | null,
  stripeEventId: string | null
) {
  const admin = createAdminClient();

  await admin.rpc("activate_initial_company_counties", {
    p_company_id: companyId,
    p_effective_at: effectiveAt,
    p_locked_until: lockedUntil,
    p_stripe_event_id: stripeEventId
  });

  if (lockedUntil) {
    await admin
      .from("company_counties")
      .update({ locked_until: lockedUntil })
      .eq("company_id", companyId)
      .eq("status", "active");
  }
}

async function syncSubscription(
  subscription: Stripe.Subscription,
  stripeEventId: string | null = null
) {
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

  const currentPeriodEndUnix = getSubscriptionCurrentPeriodEnd(subscription);
  const currentPeriodEnd = stripeUnixToIso(currentPeriodEndUnix);
  const mappedStatus = mapStatus(subscription.status);

  await admin
    .from("subscriptions")
    .update({
      provider_customer_id: customerId,
      provider_subscription_id: subscriptionId,
      status: mappedStatus,
      current_period_ends_at: currentPeriodEnd,
      cancel_at_period_end: subscription.cancel_at_period_end
    })
    .eq("company_id", companyId);

  if (mappedStatus === "active") {
    const startUnix =
      typeof (subscription as any).start_date === "number"
        ? (subscription as any).start_date
        : subscription.created;

    await activateInitialCounties(
      companyId,
      stripeUnixToIso(startUnix) ?? new Date().toISOString(),
      currentPeriodEnd,
      stripeEventId
    );
  }
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
      const checkoutActivated =
        session.payment_status === "paid" ||
        session.payment_status === "no_payment_required";

      if (companyId) {
        await admin
          .from("subscriptions")
          .update({
            provider_customer_id: asId(session.customer),
            provider_subscription_id: asId(session.subscription),
            status: checkoutActivated ? "active" : "incomplete"
          })
          .eq("company_id", companyId);

        if (checkoutActivated) {
          await activateInitialCounties(
            companyId,
            stripeUnixToIso(event.created) ?? new Date().toISOString(),
            null,
            event.id
          );
        }
      }
      break;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await syncSubscription(event.data.object as Stripe.Subscription, event.id);
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
