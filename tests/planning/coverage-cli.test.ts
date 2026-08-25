import assert from "node:assert/strict";
import test from "node:test";
import {
  parsePlanningCoverageArgs,
  runPlanningCoverageCli
} from "../../lib/planning/coverage-cli.ts";
import type { PlanningCoverageRow } from "../../lib/planning/coverage.ts";

const inventory: PlanningCoverageRow[] = [
  {
    entity: 626115,
    authorityName: "Cannock Chase",
    authoritySlug: "cannock-chase",
    countySlugs: ["staffordshire"],
    officialSource: {
      authoritySlug: "cannock-chase",
      platform: "Agile Applications Citizen Portal",
      adapter: "custom",
      provider: "agile_applications",
      officialCouncilPage: "https://www.cannockchasedc.gov.uk/planning",
      endpoint: "https://planning.agileapplications.co.uk/cannock",
      classification: "OFFICIAL_READY",
      status: "ready",
      evidence: "fixture",
      lastInvestigatedAt: "2026-08-24",
      localVerification: { outcome: "passed", checkedAt: "2026-08-24" }
    },
    officialClassification: "evidenced",
    fallback: { platform: "PlanIt", adapter: "custom", provider: "planit", status: "active" }
  }
];

test("coverage CLI parses bounded county options deterministically", () => {
  const options = parsePlanningCoverageArgs([
    "--county", "staffordshire",
    "--platform", "agile_applications",
    "--lookback-days", "7",
    "--max-pages", "4",
    "--enrich-details", "true",
    "--now", "2026-08-24T12:00:00Z",
    "--json"
  ]);

  assert.deepEqual(options, {
    countySlug: "staffordshire",
    platform: "agile_applications",
    lookbackDays: 7,
    maxPages: 4,
    enrichDetails: true,
    now: new Date("2026-08-24T12:00:00Z"),
    json: true
  });
});

test("coverage CLI executes selected official targets and returns nonzero on isolated failures", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCode = await runPlanningCoverageCli(
    ["--county", "staffordshire", "--json"],
    { stdout: (value) => stdout.push(value), stderr: (value) => stderr.push(value) },
    {
      loadInventory: async () => inventory,
      runOne: async () => { throw new Error("upstream unavailable"); }
    }
  );

  assert.equal(exitCode, 1);
  assert.equal(stderr.length, 0);
  const output = JSON.parse(stdout.join(""));
  assert.equal(output.failed, 1);
  assert.equal(output.results[0].authoritySlug, "cannock-chase");
  assert.equal(output.results[0].error, "upstream unavailable");
});

test("coverage CLI rejects unsafe ranges before loading the inventory", async () => {
  let loaded = false;
  const stderr: string[] = [];
  const exitCode = await runPlanningCoverageCli(
    ["--lookback-days", "99"],
    { stdout: () => undefined, stderr: (value) => stderr.push(value) },
    { loadInventory: async () => { loaded = true; return inventory; } }
  );

  assert.equal(exitCode, 1);
  assert.equal(loaded, false);
  assert.match(stderr.join(""), /lookback-days must be between 1 and 31/);
});

test("coverage CLI accepts the explicit nationwide --all mode", () => {
  const options = parsePlanningCoverageArgs(["--all", "--enrich-details", "false"]);
  assert.equal(options.countySlug, undefined);
  assert.equal(options.enrichDetails, false);
  assert.throws(() => parsePlanningCoverageArgs(["--all", "--county", "staffordshire"]), /cannot be combined/);
});
