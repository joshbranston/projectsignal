import assert from "node:assert/strict";
import test from "node:test";
import { fetchCsvApplications } from "../../lib/planning/adapters/csv.ts";
import type { PlanningSourceRecord } from "../../lib/planning/types.ts";

const source: PlanningSourceRecord = {
  id: "source-1",
  councilId: "council-1",
  councilSlug: "wigan",
  councilName: "Wigan Metropolitan Borough Council",
  slug: "primary",
  adapter: "csv",
  endpointUrl: "https://example.test/wigan.csv",
  format: "csv",
  config: {
    fields: {
      externalReference: "REFVAL",
      address: "ADDRESS",
      proposal: "PROPOSAL",
      decision: "DECSN"
    }
  }
};

test("fetchCsvApplications maps Wigan CSV fields into the normalised contract", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    [
      "REFVAL,ADDRESS,PROPOSAL,DECSN",
      'A/26/00123,"12 Market Street, Wigan WN1 1AA","Replacement windows and bi-fold doors",Approved'
    ].join("\n"),
    { status: 200, headers: { "content-type": "text/csv" } }
  );

  try {
    const applications = await fetchCsvApplications(source);

    assert.equal(applications.length, 1);
    assert.deepEqual(applications[0], {
      externalReference: "A/26/00123",
      address: "12 Market Street, Wigan WN1 1AA",
      postcode: null,
      latitude: null,
      longitude: null,
      proposal: "Replacement windows and bi-fold doors",
      applicationType: null,
      stage: null,
      submittedAt: null,
      validatedAt: null,
      decisionAt: null,
      decision: "Approved",
      applicantName: null,
      agentName: null,
      agentContact: null,
      sourceUrl: "https://example.test/wigan.csv",
      rawPayload: {
        REFVAL: "A/26/00123",
        ADDRESS: "12 Market Street, Wigan WN1 1AA",
        PROPOSAL: "Replacement windows and bi-fold doors",
        DECSN: "Approved"
      }
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchCsvApplications skips rows missing reference or proposal", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    [
      "REFVAL,ADDRESS,PROPOSAL,DECSN",
      ',"No reference",Replacement windows,Pending',
      'A/26/00200,"No proposal",,Pending',
      'A/26/00201,"Valid row","New doors",Pending'
    ].join("\n"),
    { status: 200 }
  );

  try {
    const applications = await fetchCsvApplications(source);
    assert.equal(applications.length, 1);
    assert.equal(applications[0].externalReference, "A/26/00201");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
