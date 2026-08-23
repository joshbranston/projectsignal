import assert from "node:assert/strict";
import test from "node:test";
import { fetchPlanningApplications, runSourceBatch } from "../../lib/planning/scanner.ts";
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
