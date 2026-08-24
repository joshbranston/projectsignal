import assert from "node:assert/strict";
import test from "node:test";
import { summariseCountyCoverage } from "../../lib/territory/coverage.ts";

test("coverage excludes inactive historical authorities from the denominator", () => {
  const summary = summariseCountyCoverage([
    { active: true, coverageStatus: "live", lastSuccessAt: "2026-08-23T10:00:00Z" },
    { active: true, coverageStatus: "live", lastSuccessAt: "2026-08-23T11:00:00Z" },
    { active: false, coverageStatus: "discovery", lastSuccessAt: null }
  ]);

  assert.equal(summary.totalAuthorities, 2);
  assert.equal(summary.liveAuthorities, 2);
  assert.equal(summary.coveragePercent, 100);
  assert.equal(summary.coverageStatus, "live");
  assert.equal(summary.lastSuccessfulRefresh, "2026-08-23T11:00:00Z");
});

test("coverage reports partial when only some current authorities are live", () => {
  const summary = summariseCountyCoverage([
    { active: true, coverageStatus: "live", lastSuccessAt: null },
    { active: true, coverageStatus: "live", lastSuccessAt: null },
    { active: true, coverageStatus: "discovery", lastSuccessAt: null }
  ]);

  assert.equal(summary.totalAuthorities, 3);
  assert.equal(summary.liveAuthorities, 2);
  assert.equal(summary.coveragePercent, 67);
  assert.equal(summary.coverageStatus, "partial");
});

test("coverage exposes testing and degraded authority counts", () => {
  const summary = summariseCountyCoverage([
    { active: true, coverageStatus: "testing", lastSuccessAt: null },
    { active: true, coverageStatus: "degraded", lastSuccessAt: "2026-08-20T09:00:00Z" },
    { active: true, coverageStatus: "discovery", lastSuccessAt: null }
  ]);

  assert.equal(summary.testingAuthorities, 1);
  assert.equal(summary.degradedAuthorities, 1);
  assert.equal(summary.liveAuthorities, 0);
  assert.equal(summary.coverageStatus, "degraded");
});
