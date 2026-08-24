import assert from "node:assert/strict";
import test from "node:test";
import { fetchPlanningApplications, loadDuePlanningSources, planningSourceFromRow, runSourceBatch } from "../../lib/planning/scanner.ts";
import type { PlanningSourceRecord } from "../../lib/planning/types.ts";

function source(id: string): PlanningSourceRecord {
  return {
    id,
    councilId: `council-${id}`,
    councilSlug: id,
    councilName: id,
    slug: "primary",
    adapter: "csv",
    endpointUrl: `https://example.test/${id}.csv`,
    format: "csv",
    config: {}
  };
}

test("runSourceBatch isolates one source failure and continues scanning the rest", async () => {
  const scanned: string[] = [];
  const successes: string[] = [];
  const failures: string[] = [];

  const result = await runSourceBatch(
    [source("one"), source("two"), source("three")],
    async (item) => {
      scanned.push(item.id);
      if (item.id === "two") throw new Error("feed timeout");
      return { sourceRows: 5, applicationsSaved: 5, opportunities: 2, customerMatches: 1 };
    },
    async (item) => { successes.push(item.id); },
    async (item) => { failures.push(item.id); }
  );

  assert.deepEqual(scanned, ["one", "two", "three"]);
  assert.deepEqual(successes, ["one", "three"]);
  assert.deepEqual(failures, ["two"]);
  assert.equal(result.sourcesProcessed, 3);
  assert.equal(result.sourcesSucceeded, 2);
  assert.equal(result.sourcesFailed, 1);
  assert.equal(result.applicationsSaved, 10);
  assert.equal(result.customerMatches, 2);
});


test("fetchPlanningApplications dispatches Idox sources to the Idox adapter", async () => {
  const originalFetch = globalThis.fetch;
  const idoxSource: PlanningSourceRecord = {
    ...source("idox-council"),
    adapter: "idox_public_access",
    endpointUrl: "https://example.test/public-access/",
    format: "html",
    config: { lookbackDays: 7, maxPages: 1 }
  };

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith("search.do?action=advanced")) {
      return new Response('<input type="hidden" name="_csrf" value="token-1">', {
        status: 200,
        headers: { "set-cookie": "JSESSIONID=session-1; Path=/public-access; HttpOnly" }
      });
    }
    if (url.endsWith("advancedSearchResults.do?action=firstPage") && String(init.method ?? "GET") === "POST") {
      return new Response("<html><body>No results</body></html>", { status: 200 });
    }
    throw new Error(`Unexpected request ${String(init.method ?? "GET")} ${url}`);
  };

  try {
    const applications = await fetchPlanningApplications(idoxSource);
    assert.deepEqual(applications, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchPlanningApplications dispatches PlanIt custom sources to the PlanIt adapter", async () => {
  const originalFetch = globalThis.fetch;
  const planItSource: PlanningSourceRecord = {
    ...source("north-west-leicestershire"),
    adapter: "custom",
    endpointUrl: "https://www.planit.org.uk/api/applics/json",
    format: "json",
    config: {
      provider: "planit",
      authority: "North West Leicestershire",
      lookbackDays: 7,
      pageSize: 100,
      maxPages: 1
    }
  };

  globalThis.fetch = async () => Response.json({
    total: 1,
    from: 0,
    to: 0,
    records: [
      {
        uid: "26/00456/FUL",
        description: "Replacement windows",
        address: "Coalville LE67 3AA",
        start_date: "2026-08-20"
      }
    ]
  });

  try {
    const applications = await fetchPlanningApplications(planItSource);
    assert.equal(applications.length, 1);
    assert.equal(applications[0].externalReference, "26/00456/FUL");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchPlanningApplications dispatches MasterGov custom sources to the MasterGov adapter", async () => {
  const originalFetch = globalThis.fetch;
  const masterGovSource: PlanningSourceRecord = {
    ...source("leicester"),
    adapter: "custom",
    endpointUrl: "https://planning.example.test/",
    format: "html",
    config: { provider: "mastergov", lookbackDays: 7, maxPages: 1 }
  };

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/Search/Standard?")) {
      return new Response(`<div>1 result found</div><table><tr>
        <th>Application Number</th><th>Location</th><th>Description</th><th>Date Validated</th><th>Status Decision</th>
      </tr><tr>
        <td><a href="/Planning/Display/20261245">20261245</a></td><td>Leicester LE1 1AA</td>
        <td>Rear extension</td><td>20/08/2026</td><td>Pending decision</td>
      </tr></table>`);
    }
    if (url.endsWith("/Planning/Display/20261245")) {
      return new Response(`<table>
        <tr><th>Application Number</th><td>20261245</td></tr>
        <tr><th>Description</th><td>Rear extension</td></tr>
        <tr><th>Application Type</th><td>Full application</td></tr>
      </table>`);
    }
    throw new Error(`Unexpected request ${url}`);
  };

  try {
    const applications = await fetchPlanningApplications(masterGovSource);
    assert.equal(applications.length, 1);
    assert.equal(applications[0].externalReference, "20261245");
    assert.equal(applications[0].applicationType, "Full application");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchPlanningApplications dispatches ASSURE custom sources to the ASSURE adapter", async () => {
  const originalFetch = globalThis.fetch;
  const assureSource: PlanningSourceRecord = {
    ...source("charnwood"),
    adapter: "custom",
    endpointUrl: "https://planning.example.test/Assure/OnlinePlanningSearch",
    format: "html",
    config: { provider: "assure", lookbackDays: 7, maxPages: 1, enrichDetails: false }
  };

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith("/Assure/OnlinePlanningSearch")) {
      return new Response(`<form id="frmOnlinePlanningSearch">
        <input type="radio" name="SearchFor" value="PlanningApplications">
        <input type="hidden" name="urlOnlinePlanningWeeklyMonthlySearchView" value="/Assure/WeeklyView">
        <input type="hidden" name="urlOnlinePlanningWeeklyMonthlyGoSearch" value="/Assure/WeeklyResults">
        <input type="hidden" name="IsWeeklyListSearch" value="false">
        <input type="hidden" name="IsMonthlyListSearch" value="true">
        <div id="divOnlinePlanningSearchView"></div>
      </form>`);
    }
    if (url.includes("/Assure/WeeklyView")) {
      return new Response(`<select name="SelectedWeek"><option value="0" selected>Dates</option></select>
        <input name="WeeklyFromDate"><input name="WeeklyToDate">
        <input type="radio" name="WeeklyListStatus" value="ValidatedThisWeek">
        <div id="divWeeklyMonthlySearchResultsForSorting"></div>`);
    }
    if (url.endsWith("/Assure/WeeklyResults") && String(init.method).toUpperCase() === "POST") {
      return new Response(`<div id="divSearchList"><p>1 Result</p><article class="assure-search-result">
        <dl class="govuk-summary-list">
          <div class="govuk-summary-list__row"><dt>Application Reference</dt><dd>P/26/1521/2</dd></div>
          <div class="govuk-summary-list__row"><dt>Address</dt><dd>81 The Green, Mountsorrel LE12 7AE</dd></div>
          <div class="govuk-summary-list__row"><dt>Description</dt><dd>Rear conservatory</dd></div>
        </dl><a data-redirect-url="/Assure/OnlinePlanningOverview?applicationNumber=P%2F26%2F1521%2F2">View</a>
      </article></div>`);
    }
    throw new Error(`Unexpected request ${String(init.method ?? "GET")} ${url}`);
  };

  try {
    const applications = await fetchPlanningApplications(assureSource);
    assert.equal(applications.length, 1);
    assert.equal(applications[0].externalReference, "P/26/1521/2");
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("planningSourceFromRow parses flat claimed-source rows with lease metadata", () => {
  const parsed = planningSourceFromRow({
    id: "source-1",
    council_id: "council-1",
    council_slug: "example",
    council_name: "Example Council",
    slug: "fallback",
    adapter: "custom",
    endpoint_url: "https://www.planit.org.uk/api/applics/json",
    format: "json",
    config: { provider: "planit" },
    priority: 200,
    scan_every_minutes: 1440,
    consecutive_failures: 0,
    source_role: "fallback",
    fallback_after_failures: 3,
    lease_token: "11111111-1111-1111-1111-111111111111",
    lease_expires_at: "2026-08-24T07:10:00.000Z"
  });

  assert.equal(parsed.councilSlug, "example");
  assert.equal(parsed.sourceRole, "fallback");
  assert.equal(parsed.fallbackAfterFailures, 3);
  assert.equal(parsed.leaseToken, "11111111-1111-1111-1111-111111111111");
});

test("loadDuePlanningSources atomically claims a bounded batch through the service RPC", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const admin = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return {
        data: [{
          id: "source-1",
          council_id: "council-1",
          council_slug: "example",
          council_name: "Example Council",
          slug: "primary",
          adapter: "csv",
          endpoint_url: "https://example.test/feed.csv",
          format: "csv",
          config: {},
          priority: 100,
          scan_every_minutes: 1440,
          consecutive_failures: 0,
          source_role: "primary",
          fallback_after_failures: 3,
          lease_token: args.p_worker_token,
          lease_expires_at: "2026-08-24T07:10:00.000Z"
        }],
        error: null
      };
    }
  };

  const sources = await loadDuePlanningSources(admin, 7);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "claim_due_planning_sources");
  assert.equal(calls[0].args.p_limit, 7);
  assert.equal(calls[0].args.p_planit_limit, 1);
  assert.equal(calls[0].args.p_lease_seconds, 90);
  assert.match(String(calls[0].args.p_worker_token), /^[0-9a-f-]{36}$/i);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].leaseToken, calls[0].args.p_worker_token);
});
