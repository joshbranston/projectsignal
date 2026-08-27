import type Stripe from "stripe";
import { activateInitialCustomerAccess } from "./customer-activation.ts";
import { billingDatabaseError } from "./checkout.ts";
import { getSubscriptionCurrentPeriodEnd, stripeUnixToIso } from "./subscription.ts";

type AdminClient = {
  from(name: string): any;
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

type StripeReader = Pick<Stripe, "subscriptions">;

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

function invoiceSubscriptionId(invoice: Stripe.Invoice) {
  const value = invoice as Stripe.Invoice & {
    subscription?: string | { id: string } | null;
    parent?: { subscription_details?: { subscription?: string | { id: string } | null } | null } | null;
  };
  return asId(value.subscription) || asId(value.parent?.subscription_details?.subscription);
}

async function syncCurrentSubscription(
  subscription: Stripe.Subscription,
  stripeEventId: string,
  admin: AdminClient
) {
  let companyId = subscription.metadata?.company_id;
  if (!companyId) {
    const lookup = await admin
      .from("subscriptions")
      .select("company_id")
      .eq("provider_subscription_id", subscription.id)
      .maybeSingle();
    if (lookup.error) throw billingDatabaseError("look_up_subscription_company", lookup.error);
    companyId = lookup.data?.company_id;
  }
  if (!companyId) return;

  const currentPeriodEnd = stripeUnixToIso(getSubscriptionCurrentPeriodEnd(subscription));
  const mappedStatus = mapStatus(subscription.status);
  const update = await admin
    .from("subscriptions")
    .update({
      provider_customer_id: asId(subscription.customer),
      provider_subscription_id: subscription.id,
      status: mappedStatus,
      current_period_ends_at: currentPeriodEnd,
      cancel_at_period_end: subscription.cancel_at_period_end
    })
    .eq("company_id", companyId)
    .select("company_id")
    .maybeSingle();
  if (update.error) throw billingDatabaseError("synchronize_subscription", update.error);
  if (!update.data) throw billingDatabaseError("synchronize_subscription", { message: "Local subscription not found" });

  if (mappedStatus === "active") {
    const startUnix = typeof subscription.start_date === "number"
      ? subscription.start_date
      : subscription.created;
    await activateInitialCustomerAccess(admin, {
      companyId,
      effectiveAt: stripeUnixToIso(startUnix) ?? new Date().toISOString(),
      lockedUntil: currentPeriodEnd,
      stripeEventId
    });
  }
}

async function currentSubscriptionById(stripe: StripeReader, id: string) {
  return await stripe.subscriptions.retrieve(id);
}

export async function processStripeWebhookEvent(input: {
  event: Stripe.Event;
  stripe: StripeReader;
  admin: AdminClient;
}) {
  const { event, stripe, admin } = input;
  let subscriptionId: string | null = null;

  if (event.type === "checkout.session.completed") {
    subscriptionId = asId((event.data.object as Stripe.Checkout.Session).subscription);
    if (!subscriptionId) throw billingDatabaseError("read_checkout_subscription", { message: "Checkout subscription missing" });
  } else if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    subscriptionId = (event.data.object as Stripe.Subscription).id;
  } else if (event.type === "invoice.payment_failed" || event.type === "invoice.payment_succeeded") {
    const invoice = event.data.object as Stripe.Invoice;
    subscriptionId = invoiceSubscriptionId(invoice);
    if (!subscriptionId) {
      const customerId = asId(invoice.customer);
      if (!customerId) return;
      const lookup = await admin
        .from("subscriptions")
        .select("provider_subscription_id")
        .eq("provider_customer_id", customerId)
        .maybeSingle();
      if (lookup.error) throw billingDatabaseError("look_up_invoice_subscription", lookup.error);
      subscriptionId = lookup.data?.provider_subscription_id ?? null;
    }
  } else {
    return;
  }

  if (!subscriptionId) return;
  const current = await currentSubscriptionById(stripe, subscriptionId);
  await syncCurrentSubscription(current, event.id, admin);
}
