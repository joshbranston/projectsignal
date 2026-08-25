import assert from "node:assert/strict";
import test from "node:test";
import {
  formatPlanningCoverageMarkdown,
  formatPlanningSourcePlatformsMarkdown
} from "../../lib/planning/coverage-report.ts";
import type { PlanningCoverageRow } from "../../lib/planning/coverage.ts";

const inventory: PlanningCoverageRow[] = [
  {
    entity: 626086,
    authorityName: "Charnwood",
    authoritySlug: "charnwood",
    countySlugs: ["leicestershire"],
    officialSource: {
      authoritySlug: "charnwood",
      platform: "NEC ASSURE",
      adapter: "custom",
      provider: "assure",
      officialCouncilPage: "https://www.charnwood.gov.uk/planning",
      endpoint: "https://planning.example.test/search",
      status: "live",
      classification: "OFFICIAL_LIVE",
      evidence: "Verified",
      lastInvestigatedAt: "2026-08-24",
      localVerification: {
        outcome: "passed",
        checkedAt: "2026-08-24",
        recordCount: 6,
        detailsVerified: true
      }
    },
    officialClassification: "evidenced",
    fallback: { platform: "PlanIt", adapter: "custom", provider: "planit", status: "active" }
  },
  {
    entity: 626115,
    authorityName: "Cannock | Chase",
    authoritySlug: "cannock-chase",
    countySlugs: ["staffordshire"],
    officialSource: null,
    officialClassification: "unclassified",
    fallback: { platform: "PlanIt", adapter: "custom", provider: "planit", status: "active" }
  }
];

test("coverage report is complete, transparent about fallbacks, and markdown-safe", () => {
  const markdown = formatPlanningCoverageMarkdown(inventory, new Date("2026-08-24T18:00:00Z"));

  assert.match(markdown, /Authorities: 2/);
  assert.match(markdown, /Official live: 1/);
  assert.match(markdown, /Fallback covered: 2/);
  assert.match(markdown, /Cannock \\| Chase/);
  assert.match(markdown, /Unclassified official \/ PlanIt active/);
  assert.match(markdown, /NEC ASSURE \/ OFFICIAL_LIVE/);
  assert.match(markdown, /https:\/\/www\.charnwood\.gov\.uk\/planning/);
  assert.match(markdown, /passed: 6 records; details verified/);
  assert.match(markdown, /2026-08-24/);
  assert.match(markdown, /\| County \| Authorities \| Fallback covered \| Official live \|/);
  assert.match(markdown, /\| leicestershire \| 1 \| 1 \| 1 \| 0 \| 0 \| 0 \| 0 \|/);
  assert.match(markdown, /\| staffordshire \| 1 \| 1 \| 0 \| 0 \| 0 \| 0 \| 1 \|/);
});

test("platform report groups every classified family and keeps PlanIt explicitly fallback-only", () => {
  const markdown = formatPlanningSourcePlatformsMarkdown(inventory, new Date("2026-08-24T18:00:00Z"));
  assert.match(markdown, /NEC ASSURE/);
  assert.match(markdown, /custom\/assure/);
  assert.match(markdown, /Charnwood/);
  assert.match(markdown, /OFFICIAL_LIVE: 1/);
  assert.match(markdown, /PlanIt \(fallback\)/);
  assert.match(markdown, /Fallback-only; not official coverage/);
});
