import assert from "node:assert/strict";
import test from "node:test";
import { processStripeWebhookEvent } from "../../lib/billing/stripe-webhook.ts";

function queryResult(data: unknown, error: unknown = null) {
  const query: any = {
    select() { return query; },
    eq() { return query; },
    maybeSingle: async () => ({ data, error }),
    single: async () => ({ data, error }),
    then(resolve: (value: unknown) => unknown) {
      return Promise.resolve({ data, error }).then(resolve);
    }
  };
  return query;
}

function adminMock(options: { lookupError?: unknown; updateError?: unknown } = {}) {
  const calls: Array<{ method: string; args: unknown }> = [];
  return {
    calls,
    admin: {
      from(name: string) {
        return {
          select() {
            calls.push({ method: "lookup", args: name });
            return queryResult({ company_id: "company-1", provider_subscription_id: "sub_live" }, options.lookupError);
          },
          update(value: unknown) {
            calls.push({ method: "update", args: value });
            return queryResult({ company_id: "company-1" }, options.updateError);
          }
        };
      },
      async rpc(name: string, args: unknown) {
        calls.push({ method: "rpc", args: [name, args] });
        return { data: { activatedCounties: 0, backfilledOpportunities: 0 }, error: null };
      }
    }
  };
}

const currentSubscription = (status = "active") => ({
  id: "sub_live",
  object: "subscription",
  customer: "cus_live",
  status,
  metadata: { company_id: "company-1" },
  created: 1_777_000_000,
  current_period_end: 1_779_000_000,
  cancel_at_period_end: false,
  items: { data: [] }
});

test("checkout completion retrieves current Stripe state and atomically activates access", async () => {
  const { admin, calls } = adminMock();
  const retrieved: string[] = [];
  await processStripeWebhookEvent({
    event: {
      id: "evt_checkout", created: 1_777_000_000, type: "checkout.session.completed",
      data: { object: { subscription: "sub_live", metadata: { company_id: "company-1" }, payment_status: "paid" } }
    } as any,
    stripe: { subscriptions: { retrieve: async (id: string) => { retrieved.push(id); return currentSubscription(); } } } as any,
    admin: admin as any
  });

  assert.deepEqual(retrieved, ["sub_live"]);
  assert.equal(calls.filter((call) => call.method === "rpc").length, 1);
  assert.match(JSON.stringify(calls), /activate_initial_customer_access/);
  assert.match(JSON.stringify(calls), /2026/);
});

test("an out-of-order stale event cannot overwrite current Stripe subscription state", async () => {
  const { admin, calls } = adminMock();
  await processStripeWebhookEvent({
    event: {
      id: "evt_old", created: 1, type: "customer.subscription.updated",
      data: { object: { ...currentSubscription("active"), status: "active" } }
    } as any,
    stripe: { subscriptions: { retrieve: async () => currentSubscription("canceled") } } as any,
    admin: admin as any
  });

  const update = calls.find((call) => call.method === "update");
  assert.equal((update?.args as any).status, "canceled");
  assert.equal(calls.some((call) => call.method === "rpc"), false);
});

test("subscription lookup failures reject the webhook for Stripe retry", async () => {
  const { admin } = adminMock({ lookupError: { message: "temporary database failure" } });
  const withoutMetadata = { ...currentSubscription(), metadata: {} };
  await assert.rejects(
    processStripeWebhookEvent({
      event: { id: "evt_lookup", created: 1, type: "customer.subscription.updated", data: { object: withoutMetadata } } as any,
      stripe: { subscriptions: { retrieve: async () => withoutMetadata } } as any,
      admin: admin as any
    }),
    (error: any) => error?.name === "BillingDatabaseError" && error?.operation === "look_up_subscription_company"
  );
});

test("invoice failure also synchronizes the current subscription instead of stale event state", async () => {
  const { admin, calls } = adminMock();
  await processStripeWebhookEvent({
    event: {
      id: "evt_invoice", created: 1, type: "invoice.payment_failed",
      data: { object: { customer: "cus_live", parent: { subscription_details: { subscription: "sub_live" } } } }
    } as any,
    stripe: { subscriptions: { retrieve: async () => currentSubscription("active") } } as any,
    admin: admin as any
  });
  const update = calls.find((call) => call.method === "update");
  assert.equal((update?.args as any).status, "active");
});
