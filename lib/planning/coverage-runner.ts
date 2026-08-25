import { isRunnableOfficialSource, type OfficialPlanningSourceDefinition, type PlanningCoverageRow } from "./coverage.ts";
import type { EnglandCountySlug } from "../territory/england-authority-counties.ts";

export type PlanningCoverageTestTarget = {
  authoritySlug: string;
  authorityName: string;
  countySlugs: string[];
  source: OfficialPlanningSourceDefinition;
};

export type PlanningCoverageTestResult = {
  authoritySlug: string;
  authorityName: string;
  countySlugs: string[];
  platform: string;
  endpoint: string;
  status: "passed" | "failed";
  applicationsReturned: number;
  detailEnriched: number;
  error: string | null;
};

export type PlanningCoverageTestReport = {
  passed: number;
  failed: number;
  results: PlanningCoverageTestResult[];
};

export type PlanningCoverageRunnerOptions = {
  lookbackDays: number;
  maxPages: number;
  enrichDetails: boolean;
  runOne: (
    target: PlanningCoverageTestTarget
  ) => Promise<{ applicationsReturned: number; detailEnriched: number }>;
};

export function createPlanningCoverageTestTargets(
  inventory: PlanningCoverageRow[],
  filters: { countySlug?: EnglandCountySlug; platform?: string } = {}
): PlanningCoverageTestTarget[] {
  return inventory.flatMap((row) => {
    if (filters.countySlug && !row.countySlugs.includes(filters.countySlug)) return [];
    if (!row.officialSource || !isRunnableOfficialSource(row.officialSource)) {
      return [];
    }
    if (filters.platform) {
      const candidates = [row.officialSource.provider, row.officialSource.adapter, row.officialSource.platform]
        .filter((value): value is string => Boolean(value))
        .map((value) => value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""));
      if (!candidates.includes(filters.platform)) return [];
    }
    return [{
      authoritySlug: row.authoritySlug,
      authorityName: row.authorityName,
      countySlugs: row.countySlugs,
      source: row.officialSource
    }];
  });
}

const SENSITIVE_PARAMETER = /(?:api[-_]?key|token|secret|password|pass|auth|signature|session|csrf)/i;

function endpointSecrets(endpoint: string) {
  const secrets: string[] = [];
  const url = new URL(endpoint);
  for (const [name, value] of url.searchParams) {
    if (value && SENSITIVE_PARAMETER.test(name)) secrets.push(value);
  }
  return secrets.sort((left, right) => right.length - left.length);
}

function safeEndpoint(endpoint: string) {
  const url = new URL(endpoint);
  for (const name of Array.from(url.searchParams.keys())) {
    if (SENSITIVE_PARAMETER.test(name)) url.searchParams.set(name, "[REDACTED]");
  }
  return url.toString();
}

function safeFailure(error: unknown, endpoint: string) {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of endpointSecrets(endpoint)) {
    message = message.split(secret).join("[REDACTED]");
  }
  return message.replace(/[\u0000-\u001f\u007f]+/g, " ").trim() || "Unknown source-test failure";
}

function validateBounds(options: PlanningCoverageRunnerOptions) {
  if (!Number.isInteger(options.lookbackDays) || options.lookbackDays < 1 || options.lookbackDays > 31) {
    throw new Error("lookbackDays must be between 1 and 31");
  }
  if (!Number.isInteger(options.maxPages) || options.maxPages < 1 || options.maxPages > 25) {
    throw new Error("maxPages must be between 1 and 25");
  }
}

export async function runPlanningCoverageTests(
  targets: PlanningCoverageTestTarget[],
  options: PlanningCoverageRunnerOptions
): Promise<PlanningCoverageTestReport> {
  validateBounds(options);
  const results = new Array<PlanningCoverageTestResult>(targets.length);
  const pending = targets.map((target, index) => ({ target, index }));
  const activeHosts = new Set<string>();
  const running = new Set<Promise<void>>();

  const start = (item: (typeof pending)[number]) => {
    const host = new URL(item.target.source.endpoint).hostname.toLowerCase();
    activeHosts.add(host);
    const operation = (async () => {
      try {
        const summary = await options.runOne(item.target);
        results[item.index] = {
          authoritySlug: item.target.authoritySlug,
          authorityName: item.target.authorityName,
          countySlugs: item.target.countySlugs,
          platform: item.target.source.platform,
          endpoint: safeEndpoint(item.target.source.endpoint),
          status: "passed",
          applicationsReturned: summary.applicationsReturned,
          detailEnriched: summary.detailEnriched,
          error: null
        };
      } catch (error) {
        results[item.index] = {
          authoritySlug: item.target.authoritySlug,
          authorityName: item.target.authorityName,
          countySlugs: item.target.countySlugs,
          platform: item.target.source.platform,
          endpoint: safeEndpoint(item.target.source.endpoint),
          status: "failed",
          applicationsReturned: 0,
          detailEnriched: 0,
          error: safeFailure(error, item.target.source.endpoint)
        };
      } finally {
        activeHosts.delete(host);
      }
    })();
    running.add(operation);
    operation.finally(() => running.delete(operation));
  };

  while (pending.length || running.size) {
    while (running.size < 2) {
      const index = pending.findIndex(({ target }) => {
        const host = new URL(target.source.endpoint).hostname.toLowerCase();
        return !activeHosts.has(host);
      });
      if (index < 0) break;
      start(pending.splice(index, 1)[0]!);
    }
    if (running.size) await Promise.race(running);
  }

  return {
    passed: results.filter((result) => result.status === "passed").length,
    failed: results.filter((result) => result.status === "failed").length,
    results
  };
}
