import assert from "node:assert/strict";
import test from "node:test";

async function loadEntitlements() {
  try {
    return await import("../../lib/territory/entitlements.ts");
  } catch {
    return {} as Record<string, unknown>;
  }
}

test("only active subscriptions can receive new leads", async () => {
  const module = await loadEntitlements();
  assert.equal(typeof module.subscriptionAllowsNewLeads, "function");
  const allows = module.subscriptionAllowsNewLeads as (status?: string | null) => boolean;
  assert.equal(allows("active"), true);
  assert.equal(allows("trialing"), false);
  assert.equal(allows("past_due"), false);
});

test("initial county selection is limited by the plan allowance", async () => {
  const module = await loadEntitlements();
  assert.equal(typeof module.validateInitialCountySelection, "function");
  const validate = module.validateInitialCountySelection as (
    counties: string[],
    limit: number
  ) => { ok: boolean; countySlugs?: string[]; error?: string };

  assert.deepEqual(validate(["leicestershire", "derbyshire", "staffordshire"], 3), {
    ok: true,
    countySlugs: ["leicestershire", "derbyshire", "staffordshire"]
  });
  assert.equal(validate(["leicestershire", "derbyshire", "staffordshire", "nottinghamshire"], 3).ok, false);
});

test("county selection is normalised and deduplicated before counting", async () => {
  const module = await loadEntitlements();
  assert.equal(typeof module.validateInitialCountySelection, "function");
  const validate = module.validateInitialCountySelection as (
    counties: string[],
    limit: number
  ) => { ok: boolean; countySlugs?: string[] };
  assert.deepEqual(validate(["Derbyshire", " derbyshire ", "DERBYSHIRE"], 3), {
    ok: true,
    countySlugs: ["derbyshire"]
  });
});

test("active and scheduled counties both consume plan capacity", async () => {
  const module = await loadEntitlements();
  assert.equal(typeof module.countySelectionUsage, "function");
  const usage = module.countySelectionUsage as (
    active: number,
    scheduled: number,
    limit: number
  ) => { used: number; remaining: number; atLimit: boolean };
  assert.deepEqual(usage(2, 1, 3), { used: 3, remaining: 0, atLimit: true });
});
