import assert from "node:assert/strict";
import test from "node:test";
import {
  createPlanningCoverageTestTargets,
  runPlanningCoverageTests,
  type PlanningCoverageTestTarget
} from "../../lib/planning/coverage-runner.ts";
import type { PlanningCoverageRow } from "../../lib/planning/coverage.ts";

function target(authoritySlug: string, endpoint: string): PlanningCoverageTestTarget {
  return {
    authoritySlug,
    authorityName: authoritySlug,
    countySlugs: ["staffordshire"],
    source: {
      authoritySlug,
      platform: "Test",
      adapter: "custom",
      provider: "assure",
      officialCouncilPage: "https://council.example.test/planning",
      endpoint,
      classification: "OFFICIAL_READY",
      status: "ready",
      evidence: "fixture",
      lastInvestigatedAt: "2026-08-24",
      localVerification: { outcome: "passed", checkedAt: "2026-08-24" }
    }
  };
}

test("coverage runner limits global concurrency to two and each host to one", async () => {
  const targets = [
    target("a", "https://one.example.test/search/a"),
    target("b", "https://one.example.test/search/b"),
    target("c", "https://two.example.test/search/c"),
    target("d", "https://two.example.test/search/d")
  ];
  let active = 0;
  let maximumActive = 0;
  const hostActive = new Map<string, number>();
  let maximumSameHost = 0;

  const report = await runPlanningCoverageTests(targets, {
    lookbackDays: 7,
    maxPages: 3,
    enrichDetails: false,
    runOne: async (item) => {
      const host = new URL(item.source.endpoint).hostname;
      active += 1;
      hostActive.set(host, (hostActive.get(host) ?? 0) + 1);
      maximumActive = Math.max(maximumActive, active);
      maximumSameHost = Math.max(maximumSameHost, hostActive.get(host) ?? 0);
      await new Promise((resolve) => setTimeout(resolve, 8));
      active -= 1;
      hostActive.set(host, (hostActive.get(host) ?? 1) - 1);
      return { applicationsReturned: 1, detailEnriched: 0 };
    }
  });

  assert.equal(maximumActive, 2);
  assert.equal(maximumSameHost, 1);
  assert.equal(report.passed, 4);
  assert.equal(report.failed, 0);
});

test("coverage runner isolates failures and redacts endpoint credentials from diagnostics", async () => {
  const secret = "coverage-token-123";
  const report = await runPlanningCoverageTests(
    [
      target("fails", `https://one.example.test/search?api_key=${secret}`),
      target("passes", "https://two.example.test/search")
    ],
    {
      lookbackDays: 7,
      maxPages: 2,
      enrichDetails: false,
      runOne: async (item) => {
        if (item.authoritySlug === "fails") throw new Error(`upstream rejected token ${secret}`);
        return { applicationsReturned: 2, detailEnriched: 1 };
      }
    }
  );

  assert.equal(report.passed, 1);
  assert.equal(report.failed, 1);
  assert.equal(report.results[0]?.status, "failed");
  assert.doesNotMatch(JSON.stringify(report), new RegExp(secret));
  assert.match(report.results[0]?.error ?? "", /\[REDACTED\]/);
  assert.equal(report.results[1]?.applicationsReturned, 2);
});

test("coverage runner rejects unsafe bounds before making a request", async () => {
  let calls = 0;
  await assert.rejects(
    runPlanningCoverageTests([target("a", "https://one.example.test/search")], {
      lookbackDays: 32,
      maxPages: 3,
      enrichDetails: false,
      runOne: async () => {
        calls += 1;
        return { applicationsReturned: 0, detailEnriched: 0 };
      }
    }),
    /lookbackDays must be between 1 and 31/
  );
  assert.equal(calls, 0);
});

test("coverage target selection runs only evidenced executable sources in the requested county", () => {
  const row = (
    authoritySlug: string,
    countySlugs: string[],
    classification: "OFFICIAL_LIVE" | "OFFICIAL_READY" | "OFFICIAL_BLOCKED_WAF" | null
  ): PlanningCoverageRow => ({
    entity: 626001,
    authorityName: authoritySlug,
    authoritySlug,
    countySlugs: countySlugs as PlanningCoverageRow["countySlugs"],
    officialSource: classification
      ? {
          authoritySlug,
          platform: "Test",
          adapter: "custom",
          provider: "assure",
          officialCouncilPage: `https://${authoritySlug}.example.test/planning`,
          endpoint: `https://${authoritySlug}.example.test/search`,
          classification,
          status: classification === "OFFICIAL_LIVE" ? "live" : classification === "OFFICIAL_READY" ? "ready" : "blocked",
          evidence: "fixture",
          lastInvestigatedAt: "2026-08-24",
          ...(classification === "OFFICIAL_READY" ? { localVerification: { outcome: "passed" as const, checkedAt: "2026-08-24" } } : {}),
          ...(classification === "OFFICIAL_BLOCKED_WAF" ? { blocker: "fixture rejection" } : {})
        }
      : null,
    officialClassification: classification ? "evidenced" : "unclassified",
    fallback: { platform: "PlanIt", adapter: "custom", provider: "planit", status: "active" }
  });
  const inventory = [
    row("live-one", ["staffordshire"], "OFFICIAL_LIVE"),
    row("ready-one", ["staffordshire"], "OFFICIAL_READY"),
    row("blocked-one", ["staffordshire"], "OFFICIAL_BLOCKED_WAF"),
    row("other-county", ["leicestershire"], "OFFICIAL_LIVE"),
    row("fallback-only", ["staffordshire"], null)
  ];

  assert.deepEqual(
    createPlanningCoverageTestTargets(inventory, { countySlug: "staffordshire" })
      .map((item) => item.authoritySlug),
    ["live-one", "ready-one"]
  );

  assert.deepEqual(
    createPlanningCoverageTestTargets(inventory, { platform: "assure" })
      .map((item) => item.authoritySlug),
    ["live-one", "ready-one", "other-county"]
  );
});
