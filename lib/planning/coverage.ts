import type { EnglandCountySlug } from "../territory/england-authority-counties.ts";

export const OFFICIAL_SOURCE_CLASSIFICATIONS = [
  "OFFICIAL_LIVE",
  "OFFICIAL_READY",
  "OFFICIAL_BLOCKED_TLS",
  "OFFICIAL_BLOCKED_WAF",
  "OFFICIAL_BLOCKED_TIMEOUT",
  "OFFICIAL_BLOCKED_PORTAL_DOWN",
  "OFFICIAL_BLOCKED_INCOMPLETE",
  "OFFICIAL_BLOCKED_UNSAFE_PROTOCOL",
  "OFFICIAL_UNSUPPORTED"
] as const;

export type OfficialSourceClassification = typeof OFFICIAL_SOURCE_CLASSIFICATIONS[number];
export type OfficialSourceStatus = "live" | "ready" | "blocked";

export type OfficialPlanningSourceDefinition = {
  authoritySlug: string;
  platform: string;
  adapter: "csv" | "idox_public_access" | "custom" | null;
  provider?: "mastergov" | "assure" | "statmap_horizon" | "agile_applications";
  officialCouncilPage: string;
  endpoint: string;
  classification: OfficialSourceClassification;
  /** Deprecated compatibility clue for catalogue migrations; runtime decisions use classification. */
  status?: OfficialSourceStatus;
  evidence: string;
  blocker?: string;
  lastInvestigatedAt: string;
  localVerification?: {
    outcome: "passed" | "failed" | "not_run";
    checkedAt: string;
    recordCount?: number;
    detailsVerified?: boolean;
    clue?: string;
  };
  config?: Record<string, unknown>;
};

export type PlanningCoverageAuthority = {
  entity: number;
  name: string;
  slug: string;
  active: boolean;
};

export type PlanningCoverageMapping = {
  planningDataEntity: number;
  countySlug: string;
};

export type PlanningCoverageRow = {
  entity: number;
  authorityName: string;
  authoritySlug: string;
  countySlugs: EnglandCountySlug[];
  officialSource: OfficialPlanningSourceDefinition | null;
  officialClassification: "evidenced" | "unclassified";
  fallback: {
    platform: "PlanIt";
    adapter: "custom";
    provider: "planit";
    status: "active";
  };
};

export function buildPlanningCoverageInventory(
  authorities: PlanningCoverageAuthority[],
  mappings: PlanningCoverageMapping[],
  officialSources: OfficialPlanningSourceDefinition[]
): PlanningCoverageRow[] {
  validateOfficialPlanningSourceDefinitions(officialSources);
  const sourcesBySlug = new Map(officialSources.map((source) => [source.authoritySlug, source]));

  return authorities
    .filter((authority) => authority.active)
    .map((authority) => {
      const countySlugs = mappings
        .filter((mapping) => mapping.planningDataEntity === authority.entity)
        .map((mapping) => mapping.countySlug)
        .sort() as EnglandCountySlug[];
      if (!countySlugs.length) {
        throw new Error(`${authority.name} (${authority.entity}) has no customer-facing county mapping`);
      }
      const officialSource = sourcesBySlug.get(authority.slug) ?? null;
      return {
        entity: authority.entity,
        authorityName: authority.name,
        authoritySlug: authority.slug,
        countySlugs,
        officialSource,
        officialClassification: officialSource ? "evidenced" as const : "unclassified" as const,
        fallback: {
          platform: "PlanIt" as const,
          adapter: "custom" as const,
          provider: "planit" as const,
          status: "active" as const
        }
      };
    })
    .sort((left, right) => left.entity - right.entity);
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function requireHttps(value: string, label: string, authoritySlug: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${authoritySlug} ${label} must be an absolute HTTPS URL`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`${authoritySlug} ${label} must use HTTPS`);
  }
}

export function validateOfficialPlanningSourceDefinitions(
  sources: readonly OfficialPlanningSourceDefinition[]
) {
  const slugs = new Set<string>();
  for (const source of sources) {
    if (slugs.has(source.authoritySlug)) {
      throw new Error(`Duplicate official source definition for ${source.authoritySlug}`);
    }
    slugs.add(source.authoritySlug);
    requireHttps(source.officialCouncilPage, "official council page", source.authoritySlug);
    requireHttps(source.endpoint, "planning portal endpoint", source.authoritySlug);
    if (!OFFICIAL_SOURCE_CLASSIFICATIONS.includes(source.classification)) {
      throw new Error(`${source.authoritySlug} has an invalid official classification`);
    }
    if (!source.evidence.trim()) throw new Error(`${source.authoritySlug} requires classification evidence`);
    if (!DATE_ONLY.test(source.lastInvestigatedAt)) {
      throw new Error(`${source.authoritySlug} requires a YYYY-MM-DD investigation date`);
    }
    if (source.classification.startsWith("OFFICIAL_BLOCKED_") && !source.blocker?.trim()) {
      throw new Error(`${source.authoritySlug} blocked classification requires a blocker`);
    }
    if (["OFFICIAL_LIVE", "OFFICIAL_READY"].includes(source.classification) && !source.adapter) {
      throw new Error(`${source.authoritySlug} executable official source requires an adapter`);
    }
    if (source.classification === "OFFICIAL_READY" && source.localVerification?.outcome !== "passed") {
      throw new Error(`${source.authoritySlug} ready source requires passed local verification`);
    }
  }
}

export function isRunnableOfficialSource(source: OfficialPlanningSourceDefinition) {
  return source.classification === "OFFICIAL_LIVE" || source.classification === "OFFICIAL_READY";
}

function hasClassification(row: PlanningCoverageRow, classification: OfficialSourceClassification) {
  return row.officialSource?.classification === classification;
}

export function summarisePlanningCoverage(inventory: PlanningCoverageRow[]) {
  return {
    authorities: inventory.length,
    counties: new Set(inventory.flatMap((row) => row.countySlugs)).size,
    fallbackCovered: inventory.filter((row) => row.fallback.status === "active").length,
    officialLive: inventory.filter((row) => hasClassification(row, "OFFICIAL_LIVE")).length,
    officialReady: inventory.filter((row) => hasClassification(row, "OFFICIAL_READY")).length,
    officialBlockedTls: inventory.filter((row) => hasClassification(row, "OFFICIAL_BLOCKED_TLS")).length,
    officialBlockedWaf: inventory.filter((row) => hasClassification(row, "OFFICIAL_BLOCKED_WAF")).length,
    officialBlockedTimeout: inventory.filter((row) => hasClassification(row, "OFFICIAL_BLOCKED_TIMEOUT")).length,
    officialBlockedPortalDown: inventory.filter((row) => hasClassification(row, "OFFICIAL_BLOCKED_PORTAL_DOWN")).length,
    officialBlockedIncomplete: inventory.filter((row) => hasClassification(row, "OFFICIAL_BLOCKED_INCOMPLETE")).length,
    officialBlockedUnsafeProtocol: inventory.filter((row) => hasClassification(row, "OFFICIAL_BLOCKED_UNSAFE_PROTOCOL")).length,
    officialUnsupported: inventory.filter((row) => hasClassification(row, "OFFICIAL_UNSUPPORTED")).length,
    officialBlocked: inventory.filter((row) => row.officialSource?.classification.startsWith("OFFICIAL_BLOCKED_")).length,
    officialUnclassified: inventory.filter((row) => row.officialClassification === "unclassified").length
  };
}

export function summarisePlanningCoverageByCounty(inventory: PlanningCoverageRow[]) {
  const countySlugs = [...new Set(inventory.flatMap((row) => row.countySlugs))].sort();

  return countySlugs.map((countySlug) => {
    const rows = inventory.filter((row) => row.countySlugs.includes(countySlug));
    return {
      countySlug,
      authorities: rows.length,
      fallbackCovered: rows.filter((row) => row.fallback.status === "active").length,
      officialLive: rows.filter((row) => hasClassification(row, "OFFICIAL_LIVE")).length,
      officialReady: rows.filter((row) => hasClassification(row, "OFFICIAL_READY")).length,
      officialBlocked: rows.filter((row) => row.officialSource?.classification.startsWith("OFFICIAL_BLOCKED_")).length,
      officialUnsupported: rows.filter((row) => hasClassification(row, "OFFICIAL_UNSUPPORTED")).length,
      fallbackOnly: rows.filter((row) => !row.officialSource || !isRunnableOfficialSource(row.officialSource)).length,
      officialUnclassified: rows.filter((row) => row.officialClassification === "unclassified").length
    };
  });
}
