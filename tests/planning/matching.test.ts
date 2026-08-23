import assert from "node:assert/strict";
import test from "node:test";
import { isCountyLeadEligible } from "../../lib/planning/matching.ts";

const base = {
  subscriptionStatus: "active",
  entitlementCountyId: "leicestershire",
  applicationCountyIds: ["leicestershire"],
  entitlementStartsAt: "2026-08-01T00:00:00.000Z",
  applicationFirstSeenAt: "2026-08-10T00:00:00.000Z",
  opportunityScore: 8,
  minimumScore: 7,
  opportunityMinValueGbp: 10000,
  minimumOpportunityGbp: 5000
};

test("active customer in the application county receives a qualifying new opportunity", () => {
  assert.equal(isCountyLeadEligible(base), true);
});

test("trialing subscriptions do not receive new leads", () => {
  assert.equal(isCountyLeadEligible({ ...base, subscriptionStatus: "trialing" }), false);
});

test("a customer without entitlement to the application county does not receive the lead", () => {
  assert.equal(
    isCountyLeadEligible({ ...base, entitlementCountyId: "derbyshire" }),
    false
  );
});

test("county entitlement does not unlock applications first seen before it started", () => {
  assert.equal(
    isCountyLeadEligible({
      ...base,
      entitlementStartsAt: "2026-08-15T00:00:00.000Z"
    }),
    false
  );
});

test("opportunity must meet customer score threshold", () => {
  assert.equal(isCountyLeadEligible({ ...base, opportunityScore: 6.9 }), false);
});

test("opportunity minimum value must meet customer minimum value", () => {
  assert.equal(
    isCountyLeadEligible({ ...base, opportunityMinValueGbp: 4999 }),
    false
  );
});
