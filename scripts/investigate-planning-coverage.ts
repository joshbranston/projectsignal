import { writeFile } from "node:fs/promises";
import { fetchEnglandAuthorityRegistry } from "../lib/planning/authority-registry.ts";
import {
  joinAuthorityDiscovery,
  parseCoverageDetail,
  parseCoverageIndex
} from "../lib/planning/coverage-discovery.ts";

const USER_AGENT = "ProjectSignal planning coverage research/1.0";
const PLANNING_DATA_LOCAL_AUTHORITY = "https://www.planning.data.gov.uk/entity.json";
const COVERAGE_INDEX = "https://plannexus.io/coverage";

async function fetchText(url: string) {
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
    headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": USER_AGENT }
  });
  if (!response.ok) throw new Error(`${new URL(url).hostname} returned HTTP ${response.status}`);
  return response.text();
}

async function fetchLocalAuthorities() {
  const url = new URL(PLANNING_DATA_LOCAL_AUTHORITY);
  url.searchParams.set("dataset", "local-authority");
  url.searchParams.set("limit", "500");
  for (const field of ["name", "website", "local-planning-authority", "end-date"]) {
    url.searchParams.append("field", field);
  }
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
    headers: { Accept: "application/json", "User-Agent": USER_AGENT }
  });
  if (!response.ok) throw new Error(`Planning Data local-authority registry returned HTTP ${response.status}`);
  const payload = await response.json() as { entities?: Array<Record<string, unknown>> };
  return (payload.entities ?? [])
    .filter((row) => !String(row["end-date"] ?? "").trim())
    .flatMap((row) => {
      const website = String(row.website ?? "").trim();
      const localPlanningAuthority = String(row["local-planning-authority"] ?? "").trim();
      if (!website || !localPlanningAuthority) return [];
      return [{
        name: String(row.name ?? "").trim(),
        website,
        localPlanningAuthority
      }];
    });
}

const [authorities, localAuthorities, coverageHtml] = await Promise.all([
  fetchEnglandAuthorityRegistry(),
  fetchLocalAuthorities(),
  fetchText(COVERAGE_INDEX)
]);
const coverageRows = parseCoverageIndex(coverageHtml);
if (coverageRows.length < 300) {
  throw new Error(`Nationwide coverage index yielded only ${coverageRows.length} authority rows`);
}
const joined = joinAuthorityDiscovery(
  authorities.map((authority) => ({
    authoritySlug: authority.slug,
    name: authority.name,
    reference: authority.reference ?? ""
  })),
  localAuthorities,
  coverageRows
);

const details = new Map<string, { portalUrl: string; platformHint: string }>();
const detailErrors = new Map<string, string>();
const codes = [...new Set(joined.flatMap((row) => row.coverageCode ? [row.coverageCode] : []))];
for (let index = 0; index < codes.length; index++) {
  const code = codes[index]!;
  try {
    const detail = parseCoverageDetail(await fetchText(`${COVERAGE_INDEX}/${encodeURIComponent(code)}`));
    details.set(code, detail);
  } catch (error) {
    detailErrors.set(code, error instanceof Error ? error.message : String(error));
  }
  if ((index + 1) % 25 === 0) process.stdout.write(`Discovered ${index + 1}/${codes.length} portal routes.\n`);
  await new Promise((resolve) => setTimeout(resolve, 50));
}

const snapshot = {
  generatedAt: new Date().toISOString(),
  evidence: {
    authorityRegistry: "Planning Data local-planning-authority and local-authority datasets",
    portalDiscovery: "PlanNexus public coverage index; each portal URL is subject to independent Node 22 verification",
    productionDependency: false
  },
  authorities: joined.map((row, index) => {
    const authority = authorities[index]!;
    const detail = row.coverageCode ? details.get(row.coverageCode) : undefined;
    return {
      entity: authority.entity,
      authorityName: row.authorityName,
      authoritySlug: row.authoritySlug,
      authorityReference: row.authorityReference,
      officialCouncilPage: row.officialCouncilPage,
      coverageCode: row.coverageCode,
      platformHint: detail?.platformHint ?? row.platformHint,
      portalUrl: detail?.portalUrl ?? null,
      legacySuccessor: row.legacySuccessor,
      discoveryError: row.coverageCode ? detailErrors.get(row.coverageCode) ?? null : null
    };
  })
};

await writeFile(
  "docs/planning-authority-investigation.json",
  `${JSON.stringify(snapshot, null, 2)}\n`
);
process.stdout.write(
  `Wrote ${snapshot.authorities.length} authority investigations; ` +
  `${details.size} portal routes and ${detailErrors.size} detail errors.\n`
);
