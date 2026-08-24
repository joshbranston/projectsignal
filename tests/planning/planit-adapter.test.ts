import assert from "node:assert/strict";
import test from "node:test";
import { fetchPlanItApplications, normalisePlanItRecord } from "../../lib/planning/adapters/planit.ts";
import type { PlanningSourceRecord } from "../../lib/planning/types.ts";

function source(): PlanningSourceRecord {
  return {
    id: "source-nwl",
    councilId: "council-nwl",
    councilSlug: "north-west-leicestershire",
    councilName: "North West Leicestershire",
    slug: "primary",
    adapter: "custom",
    endpointUrl: "https://www.planit.org.uk/api/applics/json",
    format: "json",
    config: {
      provider: "planit",
      authority: "North West Leicestershire",
      lookbackDays: 7,
      pageSize: 2,
      maxPages: 2
    }
  };
}

test("normalisePlanItRecord falls back to uid when reference is blank", () => {
  const application = normalisePlanItRecord({
    reference: "",
    uid: "26/00456/FUL",
    name: "NorthWestLeicestershire/26/00456/FUL",
    address: "10 Main Street Coalville Leicestershire LE67 3AA",
    postcode: "LE67 3AA",
    description: "Replacement windows and doors to dwelling",
    app_type: "Full",
    app_state: "Undecided",
    start_date: "2026-08-19",
    location_x: -1.37,
    location_y: 52.72,
    url: "https://plans.nwleics.gov.uk/public-access/applicationDetails.do?keyVal=abc",
    other_fields: {
      date_received: "2026-08-18",
      date_validated: "2026-08-19",
      application_type: "Householder",
      applicant_company: "Example Homes Ltd",
      agent_company: "Example Architects Ltd"
    }
  });

  assert.ok(application);
  assert.equal(application.externalReference, "26/00456/FUL");
  assert.equal(application.proposal, "Replacement windows and doors to dwelling");
  assert.equal(application.postcode, "LE67 3AA");
  assert.equal(application.latitude, 52.72);
  assert.equal(application.longitude, -1.37);
  assert.equal(application.submittedAt, "2026-08-18");
  assert.equal(application.validatedAt, "2026-08-19");
  assert.equal(application.applicationType, "Householder");
  assert.equal(application.sourceUrl, "https://plans.nwleics.gov.uk/public-access/applicationDetails.do?keyVal=abc");
  assert.equal(application.applicantName, "Example Homes Ltd");
  assert.equal(application.agentName, "Example Architects Ltd");
});

test("fetchPlanItApplications caps automated PlanIt scans at one page per source run", async () => {
  const originalFetch = globalThis.fetch;
  const requested: URL[] = [];

  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    requested.push(url);
    assert.match(String((init.headers as Record<string, string>)?.["user-agent"] ?? ""), /ProjectSignal/i);

    if (url.searchParams.get("page") === "1") {
      return Response.json({
        total: 3,
        from: 0,
        to: 1,
        records: [
          { uid: "A/1", description: "First", start_date: "2026-08-20", address: "A LE67 1AA" },
          { uid: "A/2", description: "Second", start_date: "2026-08-20", address: "B LE67 1AB" }
        ]
      });
    }

    if (url.searchParams.get("page") === "2") {
      return Response.json({
        total: 3,
        from: 2,
        to: 2,
        records: [
          { uid: "A/3", description: "Third", start_date: "2026-08-20", address: "C LE67 1AD" }
        ]
      });
    }

    throw new Error(`Unexpected page ${url.searchParams.get("page")}`);
  };

  try {
    const applications = await fetchPlanItApplications(source());
    assert.equal(applications.length, 2);
    assert.equal(requested.length, 1);
    assert.equal(requested[0].searchParams.get("auth"), "North West Leicestershire");
    assert.equal(requested[0].searchParams.get("recent"), "7");
    assert.equal(requested[0].searchParams.get("pg_sz"), "2");
    assert.equal(requested[0].searchParams.get("compress"), "on");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
