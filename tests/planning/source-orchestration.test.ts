import assert from "node:assert/strict";
import test from "node:test";
import { isPlanItSource, sourceCanFallback } from "../../lib/planning/source-orchestration.ts";
import type { PlanningSourceRecord } from "../../lib/planning/types.ts";

function source(overrides: Partial<PlanningSourceRecord> = {}): PlanningSourceRecord {
  return {
    id: "source-1",
    councilId: "council-1",
    councilSlug: "example",
    councilName: "Example",
    slug: "primary",
    adapter: "csv",
    endpointUrl: "https://example.test/feed.csv",
    format: "csv",
    config: {},
    sourceRole: "primary",
    fallbackAfterFailures: 3,
    consecutiveFailures: 0,
    ...overrides
  };
}

test("identifies PlanIt custom sources from provider config", () => {
  assert.equal(isPlanItSource(source({ adapter: "custom", config: { provider: "planit" } })), true);
  assert.equal(isPlanItSource(source({ adapter: "csv" })), false);
});

test("fallback is eligible when no active primary exists", () => {
  const fallback = source({ sourceRole: "fallback" });
  assert.equal(sourceCanFallback(fallback, []), true);
});

test("healthy primary suppresses fallback", () => {
  const fallback = source({ sourceRole: "fallback", fallbackAfterFailures: 3 });
  const primary = source({ sourceRole: "primary", consecutiveFailures: 2 });
  assert.equal(sourceCanFallback(fallback, [primary]), false);
});

test("fallback becomes eligible when every primary reaches the failure threshold", () => {
  const fallback = source({ sourceRole: "fallback", fallbackAfterFailures: 3 });
  const primary = source({ sourceRole: "primary", consecutiveFailures: 3 });
  assert.equal(sourceCanFallback(fallback, [primary]), true);
});
