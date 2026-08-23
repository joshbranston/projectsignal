import assert from "node:assert/strict";
import test from "node:test";

async function loadHelpers() {
  try {
    return await import("../../lib/billing/subscription.ts");
  } catch {
    return {} as Record<string, unknown>;
  }
}

test("reads current period end from the subscription root when present", async () => {
  const module = await loadHelpers();
  assert.equal(typeof module.getSubscriptionCurrentPeriodEnd, "function");
  const getPeriodEnd = module.getSubscriptionCurrentPeriodEnd as (value: unknown) => number | null;
  assert.equal(getPeriodEnd({ current_period_end: 1_800_000_000 }), 1_800_000_000);
});

test("falls back to the first subscription item period end", async () => {
  const module = await loadHelpers();
  assert.equal(typeof module.getSubscriptionCurrentPeriodEnd, "function");
  const getPeriodEnd = module.getSubscriptionCurrentPeriodEnd as (value: unknown) => number | null;
  assert.equal(
    getPeriodEnd({ items: { data: [{ current_period_end: 1_810_000_000 }] } }),
    1_810_000_000
  );
});

test("returns null when Stripe does not provide a period end", async () => {
  const module = await loadHelpers();
  assert.equal(typeof module.getSubscriptionCurrentPeriodEnd, "function");
  const getPeriodEnd = module.getSubscriptionCurrentPeriodEnd as (value: unknown) => number | null;
  assert.equal(getPeriodEnd({ items: { data: [] } }), null);
});
