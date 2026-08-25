import { readFile, writeFile } from "node:fs/promises";
import { runPlanningCoverageTests, type PlanningCoverageTestTarget } from "../lib/planning/coverage-runner.ts";
import { runPlanningSourceTest } from "../lib/planning/source-test-cli.ts";
import type { OfficialPlanningSourceDefinition } from "../lib/planning/coverage.ts";

type Investigation = {
  generatedAt: string;
  verificationGeneratedAt?: string;
  authorities: Array<{
    authorityName: string;
    authoritySlug: string;
    platformHint: string | null;
    portalUrl: string | null;
    portalProbe?: { outcome: string; platform: string | null } | null;
    adapterVerification?: {
      outcome: "passed" | "failed";
      checkedAt: string;
      applicationsReturned: number;
      detailEnriched: number;
      error: string | null;
    };
  }>;
};

const path = "docs/planning-authority-investigation.json";
const investigation = JSON.parse(await readFile(path, "utf8")) as Investigation;
const deep = process.argv.includes("--deep");
const PREVERIFIED = new Set([
  "wigan", "leicester", "blaby", "charnwood", "peak-district-national-park",
  "lichfield", "south-staffordshire", "east-staffordshire", "cannock-chase"
]);

function supportedSource(authority: Investigation["authorities"][number]): OfficialPlanningSourceDefinition | null {
  if (!authority.portalUrl || authority.portalProbe?.outcome !== "reachable") return null;
  const hint = authority.platformHint ?? "";
  const detected = authority.portalProbe.platform ?? "";
  const common = {
    authoritySlug: authority.authoritySlug,
    officialCouncilPage: authority.portalUrl,
    endpoint: authority.portalUrl,
    classification: "OFFICIAL_READY" as const,
    status: "ready" as const,
    evidence: "Pending bounded local adapter verification",
    lastInvestigatedAt: "2026-08-24",
    localVerification: { outcome: "passed" as const, checkedAt: "2026-08-24" }
  };
  if (detected === "DEF / MasterGov" && /^(?:DEF|def_v3|def_csrf|Plansearch|online_register)$/.test(hint)) {
    return { ...common, platform: "DEF Software / MasterGov", adapter: "custom", provider: "mastergov" };
  }
  if (detected === "NEC ASSURE" && hint === "NECSWS") {
    return { ...common, platform: detected, adapter: "custom", provider: "assure" };
  }
  if (detected === "StatMap HorizoNext" && hint === "statmap") {
    return { ...common, platform: detected, adapter: "custom", provider: "statmap_horizon" };
  }
  if (hint === "Agile Applications" && new URL(authority.portalUrl).hostname === "planning.agileapplications.co.uk") {
    return { ...common, platform: "Agile Applications Citizen Portal", adapter: "custom", provider: "agile_applications" };
  }
  return null;
}

const targets = investigation.authorities.flatMap((authority): PlanningCoverageTestTarget[] => {
  if (PREVERIFIED.has(authority.authoritySlug)) return [];
  if (deep) {
    if (authority.adapterVerification?.outcome !== "passed" ||
        authority.adapterVerification.applicationsReturned < 1 ||
        authority.adapterVerification.detailEnriched > 0) return [];
  } else if (authority.adapterVerification) return [];
  const source = supportedSource(authority);
  return source ? [{
    authoritySlug: authority.authoritySlug,
    authorityName: authority.authorityName,
    countySlugs: [],
    source
  }] : [];
});

process.stdout.write(`Verifying ${targets.length} discovered sources (${deep ? "detail enrichment" : "classification"}) with global concurrency 2 and per-host concurrency 1.\n`);
const report = await runPlanningCoverageTests(targets, {
  lookbackDays: 7,
  maxPages: 10,
  enrichDetails: deep,
  runOne: async (target) => {
    const source = target.source;
    if (!source.adapter) throw new Error("No adapter configured");
    const result = await runPlanningSourceTest({
      adapter: source.adapter,
      provider: source.provider ?? null,
      endpoint: source.endpoint,
      config: source.config ?? {},
      lookbackDays: 7,
      now: new Date("2026-08-24T12:00:00.000Z"),
      maxPages: 10,
      enrichDetails: deep,
      json: true,
      score: false
    });
    return result.summary;
  }
});

const bySlug = new Map(report.results.map((result) => [result.authoritySlug, result]));
for (const authority of investigation.authorities) {
  const result = bySlug.get(authority.authoritySlug);
  if (!result) continue;
  authority.adapterVerification = {
    outcome: result.status,
    checkedAt: "2026-08-24",
    applicationsReturned: result.applicationsReturned,
    detailEnriched: result.detailEnriched,
    error: result.error
  };
  process.stdout.write(`${result.status === "passed" ? "PASS" : "FAIL"} ${authority.authorityName}: ${result.applicationsReturned}${result.error ? ` - ${result.error}` : ""}\n`);
}

investigation.verificationGeneratedAt = new Date().toISOString();
await writeFile(path, `${JSON.stringify(investigation, null, 2)}\n`);
process.stdout.write(`Completed: ${report.passed} passed, ${report.failed} failed.\n`);
