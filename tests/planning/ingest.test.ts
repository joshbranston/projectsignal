import assert from "node:assert/strict";
import test from "node:test";
import { buildPlanningApplicationPayload } from "../../lib/planning/ingest.ts";
import type { NormalisedPlanningApplication, PlanningSourceRecord } from "../../lib/planning/types.ts";

const source: PlanningSourceRecord = {
  id: "source-1",
  councilId: "council-1",
  councilSlug: "wigan",
  councilName: "Wigan Metropolitan Borough Council",
  slug: "primary",
  adapter: "csv",
  endpointUrl: "https://example.test/wigan.csv",
  format: "csv",
  config: {}
};

const application: NormalisedPlanningApplication = {
  externalReference: "A/26/00123",
  address: "12 Market Street, Wigan WN1 1AA",
  postcode: null,
  latitude: null,
  longitude: null,
  proposal: "Replacement windows",
  applicationType: null,
  stage: null,
  submittedAt: null,
  validatedAt: null,
  decisionAt: null,
  decision: "Approved",
  applicantName: null,
  agentName: null,
  agentContact: null,
  sourceUrl: "https://example.test/item/123",
  rawPayload: { REFVAL: "A/26/00123" }
};

test("buildPlanningApplicationPayload assigns council/source ids and extracts postcode from address", () => {
  const payload = buildPlanningApplicationPayload(source, application, "2026-08-23T10:00:00.000Z");

  assert.equal(payload.council_id, "council-1");
  assert.equal(payload.planning_source_id, "source-1");
  assert.equal(payload.external_reference, "A/26/00123");
  assert.equal(payload.postcode, "WN1 1AA");
  assert.equal(payload.last_seen_at, "2026-08-23T10:00:00.000Z");
  assert.deepEqual(payload.source_payload, { REFVAL: "A/26/00123" });
});
