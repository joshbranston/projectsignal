import { fetchEnglandAuthorityRegistry } from "./authority-registry.ts";
import { buildEnglandAuthorityCountyMappings, type EnglandCountySlug } from "../territory/england-authority-counties.ts";
import { EVIDENCED_OFFICIAL_PLANNING_SOURCES } from "./coverage-catalogue.ts";
import { buildPlanningCoverageInventory, type PlanningCoverageRow } from "./coverage.ts";
import {
  createPlanningCoverageTestTargets,
  runPlanningCoverageTests,
  type PlanningCoverageTestTarget
} from "./coverage-runner.ts";
import { runPlanningSourceTest } from "./source-test-cli.ts";
import type { PlanningSourceConfig } from "./types.ts";

export type PlanningCoverageCliOptions = {
  countySlug?: EnglandCountySlug;
  platform?: string;
  lookbackDays: number;
  maxPages: number;
  enrichDetails: boolean;
  now: Date;
  json: boolean;
};

type CoverageIo = { stdout: (value: string) => void; stderr: (value: string) => void };
type RunOne = (target: PlanningCoverageTestTarget) => Promise<{ applicationsReturned: number; detailEnriched: number }>;

function boundedInteger(value: string | undefined, flag: string, maximum: number) {
  if (!value || !/^\d+$/.test(value)) throw new Error(`${flag} must be an integer`);
  const number = Number(value);
  if (number < 1 || number > maximum) throw new Error(`${flag} must be between 1 and ${maximum}`);
  return number;
}

function booleanValue(value: string | undefined, flag: string) {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${flag} must be true or false`);
}

export function parsePlanningCoverageArgs(argv: string[]): PlanningCoverageCliOptions {
  const values = new Map<string, string>();
  let json = false;
  let all = false;
  const valueFlags = new Set(["--county", "--platform", "--lookback-days", "--max-pages", "--enrich-details", "--now"]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]!;
    if (flag === "--json") {
      json = true;
      continue;
    }
    if (flag === "--all") {
      if (all) throw new Error("--all may only be provided once");
      all = true;
      continue;
    }
    if (!valueFlags.has(flag)) throw new Error(`Unknown argument: ${flag}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    if (values.has(flag)) throw new Error(`${flag} may only be provided once`);
    values.set(flag, value);
    index += 1;
  }

  const now = values.has("--now") ? new Date(values.get("--now")!) : new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("--now must be a valid date-time");
  const countySlug = values.get("--county");
  if (countySlug && !/^[a-z]+(?:-[a-z]+)*$/.test(countySlug)) {
    throw new Error("--county must be a lowercase county slug");
  }
  if (all && countySlug) throw new Error("--all cannot be combined with --county");
  const platform = values.get("--platform");
  if (platform && !/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(platform)) {
    throw new Error("--platform must be a lowercase provider, adapter, or platform slug");
  }

  return {
    ...(countySlug ? { countySlug: countySlug as EnglandCountySlug } : {}),
    ...(platform ? { platform } : {}),
    lookbackDays: values.has("--lookback-days")
      ? boundedInteger(values.get("--lookback-days"), "--lookback-days", 31)
      : 7,
    maxPages: values.has("--max-pages")
      ? boundedInteger(values.get("--max-pages"), "--max-pages", 25)
      : 10,
    enrichDetails: values.has("--enrich-details")
      ? booleanValue(values.get("--enrich-details"), "--enrich-details")
      : false,
    now,
    json
  };
}

async function loadInventory(): Promise<PlanningCoverageRow[]> {
  const authorities = await fetchEnglandAuthorityRegistry();
  return buildPlanningCoverageInventory(
    authorities,
    buildEnglandAuthorityCountyMappings(),
    [...EVIDENCED_OFFICIAL_PLANNING_SOURCES]
  );
}

function defaultRunOne(options: PlanningCoverageCliOptions): RunOne {
  return async (target) => {
    const source = target.source;
    if (!source.adapter) throw new Error(`${source.platform} has no implemented adapter`);
    const result = await runPlanningSourceTest({
      adapter: source.adapter,
      provider: source.provider ?? null,
      endpoint: source.endpoint,
      config: (source.config ?? {}) as PlanningSourceConfig,
      lookbackDays: options.lookbackDays,
      now: options.now,
      maxPages: options.maxPages,
      enrichDetails: options.enrichDetails,
      json: true,
      score: false
    });
    return result.summary;
  };
}

function formatText(report: Awaited<ReturnType<typeof runPlanningCoverageTests>>) {
  const lines = [
    `Planning coverage tests: ${report.passed} passed, ${report.failed} failed`,
    ...report.results.map((result) =>
      `${result.status === "passed" ? "PASS" : "FAIL"} ${result.authorityName} (${result.platform}) ` +
      `${result.applicationsReturned} applications${result.error ? ` - ${result.error}` : ""}`
    )
  ];
  return `${lines.join("\n")}\n`;
}

export async function runPlanningCoverageCli(
  argv: string[],
  io: CoverageIo,
  dependencies: { loadInventory?: () => Promise<PlanningCoverageRow[]>; runOne?: RunOne } = {}
) {
  try {
    const options = parsePlanningCoverageArgs(argv);
    const inventory = await (dependencies.loadInventory ?? loadInventory)();
    const targets = createPlanningCoverageTestTargets(inventory, {
      countySlug: options.countySlug,
      platform: options.platform
    });
    if (!targets.length) throw new Error("No executable evidenced official sources matched the selection");
    const report = await runPlanningCoverageTests(targets, {
      lookbackDays: options.lookbackDays,
      maxPages: options.maxPages,
      enrichDetails: options.enrichDetails,
      runOne: dependencies.runOne ?? defaultRunOne(options)
    });
    io.stdout(options.json ? `${JSON.stringify(report, null, 2)}\n` : formatText(report));
    return report.failed ? 1 : 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`Planning coverage test failed: ${message.replace(/[\u0000-\u001f\u007f]+/g, " ")}\n`);
    return 1;
  }
}
