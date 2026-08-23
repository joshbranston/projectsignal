import assert from "node:assert/strict";
import test from "node:test";
import { runSourceBatch } from "../../lib/planning/scanner.ts";
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
