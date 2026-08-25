import {
  summarisePlanningCoverage,
  summarisePlanningCoverageByCounty,
  type PlanningCoverageRow
} from "./coverage.ts";

function cell(value: unknown) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/[\r\n]+/g, " ")
    .trim() || "—";
}

export function planningCoverageSnapshot(inventory: PlanningCoverageRow[], generatedAt = new Date()) {
  return {
    generatedAt: generatedAt.toISOString(),
    summary: summarisePlanningCoverage(inventory),
    counties: summarisePlanningCoverageByCounty(inventory),
    authorities: inventory
  };
}

export function formatPlanningCoverageMarkdown(
  inventory: PlanningCoverageRow[],
  generatedAt = new Date()
) {
  const summary = summarisePlanningCoverage(inventory);
  const counties = summarisePlanningCoverageByCounty(inventory);
  const lines = [
    "# ProjectSignal planning authority coverage",
    "",
    `Generated from the canonical Planning Data LPA registry on ${generatedAt.toISOString()}.`,
    "",
    `- Authorities: ${summary.authorities}`,
    `- Customer-facing counties: ${summary.counties}`,
    `- Fallback covered: ${summary.fallbackCovered}`,
    `- Official live: ${summary.officialLive}`,
    `- Official ready for controlled activation: ${summary.officialReady}`,
    `- Official blocked: ${summary.officialBlocked}`,
    `- Official unsupported: ${summary.officialUnsupported}`,
    `- Official unclassified: ${summary.officialUnclassified}`,
    "",
    "`Unclassified official / PlanIt active` means geographic opportunity coverage exists through the configured fallback, but the authority's own register has not yet been safely classified. It must not be reported as official-source coverage.",
    "",
    "## County coverage",
    "",
    "| County | Authorities | Fallback covered | Official live | Official ready | Official blocked | Official unsupported | Official unclassified |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"
  ];

  for (const county of counties) {
    lines.push(
      `| ${cell(county.countySlug)} | ${county.authorities} | ${county.fallbackCovered} | ` +
      `${county.officialLive} | ${county.officialReady} | ${county.officialBlocked} | ${county.officialUnsupported} | ${county.officialUnclassified} |`
    );
  }

  lines.push(
    "",
    "## Authority coverage",
    "",
    "| Entity | Authority | County coverage | Official classification | Adapter/provider | Official council page | Official endpoint | Local verification | Investigated | Blocker/evidence | Fallback |",
    "| ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"
  );

  for (const row of inventory) {
    const source = row.officialSource;
    const classification = source
      ? `${source.platform} / ${source.classification}`
      : "Unclassified official / PlanIt active";
    const adapter = source
      ? [source.adapter ?? "not implemented", source.provider].filter(Boolean).join(" / ")
      : "—";
    const clue = source ? source.blocker ?? source.evidence : "Official classification pending";
    const verification = source?.localVerification
      ? `${source.localVerification.outcome}` +
        (source.localVerification.recordCount === undefined ? "" : `: ${source.localVerification.recordCount} records`) +
        (source.localVerification.detailsVerified ? "; details verified" : "")
      : "not run";
    lines.push(
      `| ${row.entity} | ${cell(row.authorityName)} | ${cell(row.countySlugs.join(", "))} | ` +
      `${cell(classification)} | ${cell(adapter)} | ${cell(source?.officialCouncilPage)} | ${cell(source?.endpoint)} | ` +
      `${cell(verification)} | ${cell(source?.lastInvestigatedAt)} | ${cell(clue)} | PlanIt active |`
    );
  }

  return `${lines.join("\n")}\n`;
}

const PLATFORM_METHODS: Readonly<Record<string, { search: string; completeness: string }>> = {
  csv: { search: "Configured HTTPS CSV export", completeness: "Whole response plus required field mapping" },
  idox_public_access: { search: "Date-bounded advanced-search form", completeness: "Bounded pagination, visible reference dedupe" },
  mastergov: { search: "Disclaimer/session then date-bounded search", completeness: "Parsed pagination and hard page cap" },
  assure: { search: "DOM-equivalent weekly/date search", completeness: "Advertised total, modern/legacy pagination, hard caps" },
  statmap_horizon: { search: "Date-bounded public JSON pageRequest", completeness: "Advertised total, offset pagination, reference dedupe" },
  agile_applications: { search: "Public bootstrap then date-bounded JSON search", completeness: "Returned total must equal normalized results" }
};

export function formatPlanningSourcePlatformsMarkdown(
  inventory: PlanningCoverageRow[],
  generatedAt = new Date()
) {
  const groups = new Map<string, PlanningCoverageRow[]>();
  for (const row of inventory) {
    const platform = row.officialSource?.platform ?? "Unclassified";
    groups.set(platform, [...(groups.get(platform) ?? []), row]);
  }
  const lines = [
    "# Planning source platform matrix",
    "",
    `Generated from the 337-authority classified catalogue on ${generatedAt.toISOString()}.`,
    "",
    "PlanIt remains an active authority-scoped fallback. It is not counted as official-source coverage.",
    "",
    "| Platform | Provider | Authorities | Examples | Search method | Completeness | Status |",
    "| --- | --- | ---: | --- | --- | --- | --- |"
  ];
  for (const [platform, rows] of [...groups].sort(([left], [right]) => left.localeCompare(right))) {
    const providers = [...new Set(rows.map((row) => {
      const source = row.officialSource;
      return source ? source.provider ? `${source.adapter}/${source.provider}` : source.adapter ?? "not implemented" : "not implemented";
    }))].join(", ");
    const methodKey = rows.map((row) => row.officialSource?.provider ?? row.officialSource?.adapter).find(Boolean) ?? "";
    const method = PLATFORM_METHODS[methodKey] ?? { search: "No reusable safe adapter", completeness: "Not proven; fallback retained" };
    const status = [...new Set(rows.map((row) => row.officialSource?.classification ?? "UNCLASSIFIED"))]
      .map((classification) => `${classification}: ${rows.filter((row) => (row.officialSource?.classification ?? "UNCLASSIFIED") === classification).length}`)
      .join(", ");
    lines.push(
      `| ${cell(platform)} | ${cell(providers)} | ${rows.length} | ` +
      `${cell(rows.slice(0, 4).map((row) => row.authorityName).join(", "))} | ${cell(method.search)} | ` +
      `${cell(method.completeness)} | ${cell(status)} |`
    );
  }
  lines.push(
    `| PlanIt (fallback) | custom/planit | ${inventory.length} | All mapped authorities | Authority/date-bounded JSON API | Fallback orchestration | Fallback-only; not official coverage |`,
    "",
    "## Shared safety contract",
    "",
    "- HTTPS certificate verification remains enabled; plaintext redirects are rejected.",
    "- No proxy, WAF bypass, CAPTCHA solving, browser-fingerprint rotation, or document retrieval is used.",
    "- Search windows, pagination, redirects, timeouts, detail concurrency, and nationwide concurrency are bounded.",
    "- Advertised totals and visible application references are fail-closed completeness signals.",
    "- Diagnostics retain operation/status/nested transport codes while redacting session and secret values."
  );
  return `${lines.join("\n")}\n`;
}
