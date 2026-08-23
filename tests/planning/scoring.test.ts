import assert from "node:assert/strict";
import test from "node:test";
import { analyseWindowsApplication } from "../../lib/planning/scoring.ts";

const base = {
  id: "app-1",
  council_id: "council-1",
  external_reference: "A/26/00123",
  address: "12 Market Street, Wigan WN1 1AA",
  postcode: "WN1 1AA",
  latitude: null,
  longitude: null,
  proposal: "Replacement windows and bi-fold doors",
  stage: null,
  decision: "Approved",
  first_seen_at: "2026-08-23T10:00:00.000Z"
};

test("analyseWindowsApplication converts a strong glazing application into a trade opportunity", () => {
  const result = analyseWindowsApplication(base);
  assert.ok(result);
  assert.equal(result.planningApplicationId, "app-1");
  assert.equal(result.score, 10);
  assert.equal(result.stage, "Approved");
  assert.equal(result.minValue, 5000);
  assert.equal(result.maxValue, 20000);
});

test("analyseWindowsApplication returns null below the qualifying score", () => {
  const result = analyseWindowsApplication({
    ...base,
    proposal: "Works to oak tree canopy",
    decision: "Pending"
  });
  assert.equal(result, null);
});
