import { fetchPlanningApplications } from "./scanner.ts";
import { scoreWindowsOpportunity } from "../scoring.ts";
import type {
  NormalisedPlanningApplication,
  PlanningSourceConfig,
  PlanningSourceRecord
} from "./types.ts";

export type PlanningSourceTestOptions = {
  adapter: "csv" | "idox_public_access" | "custom";
  provider: "planit" | "mastergov" | "assure" | null;
  endpoint: string;
  config: PlanningSourceConfig;
  lookbackDays: number;
  now: Date;
  maxPages: number;
  enrichDetails: boolean;
  json: boolean;
  score: boolean;
};

export type PlanningSourceFetchOptions = {
  now: Date;
  lookbackDays: number;
  maxPages: number;
  enrichDetails: boolean;
};

export type PlanningSourceTestResult = {
  source: {
    adapter: string;
    provider: string | null;
    endpoint: string;
    from: string;
    to: string;
    lookbackDays: number;
    maxPages: number;
  };
  summary: {
    applicationsReturned: number;
    detailEnriched: number;
    earliestDate: string | null;
    latestDate: string | null;
  };
  applications: NormalisedPlanningApplication[];
};

export type PlanningSourceTestFormatOptions = {
  json: boolean;
  score: boolean;
};

export type PlanningSourceTestIo = {
  stdout: (value: string) => void;
  stderr: (value: string) => void;
};

type FetchApplications = (
  source: PlanningSourceRecord,
  options: PlanningSourceFetchOptions
) => Promise<NormalisedPlanningApplication[]>;

function positiveInteger(value: string | undefined, name: string, maximum: number) {
  if (!value || !/^\d+$/.test(value)) throw new Error(`${name} must be an integer`);
  const numeric = Number(value);
  if (numeric < 1 || numeric > maximum) {
    throw new Error(`${name} must be between 1 and ${maximum}`);
  }
  return numeric;
}

function booleanValue(value: string | undefined, name: string) {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false`);
}

export function parsePlanningSourceTestArgs(argv: string[]): PlanningSourceTestOptions {
  const values = new Map<string, string>();
  const switches = new Set<string>();
  const booleanSwitches = new Set(["--json", "--score"]);
  const valueFlags = new Set([
    "--adapter",
    "--provider",
    "--endpoint",
    "--config-json",
    "--lookback-days",
    "--now",
    "--max-pages",
    "--enrich-details"
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (booleanSwitches.has(flag)) {
      switches.add(flag);
      continue;
    }
    if (!valueFlags.has(flag)) throw new Error(`Unknown argument: ${flag}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    if (values.has(flag)) throw new Error(`${flag} may only be provided once`);
    values.set(flag, value);
    index += 1;
  }

  const adapter = values.get("--adapter");
  if (!adapter || !["csv", "idox_public_access", "custom"].includes(adapter)) {
    throw new Error("--adapter must be csv, idox_public_access, or custom");
  }
  const provider = values.get("--provider") ?? null;
  if (adapter === "custom" && !["planit", "mastergov", "assure"].includes(provider ?? "")) {
    throw new Error("--provider must be planit, mastergov, or assure for custom adapters");
  }
  if (adapter !== "custom" && provider) {
    throw new Error("--provider is only valid with --adapter custom");
  }
  const endpoint = values.get("--endpoint");
  if (!endpoint) throw new Error("--endpoint is required");
  let parsedEndpoint: URL;
  try {
    parsedEndpoint = new URL(endpoint);
  } catch {
    throw new Error("--endpoint must be a valid HTTP(S) URL");
  }
  if (!["http:", "https:"].includes(parsedEndpoint.protocol) || parsedEndpoint.username || parsedEndpoint.password) {
    throw new Error("--endpoint must be a valid HTTP(S) URL without embedded credentials");
  }
  const nowText = values.get("--now");
  const now = nowText ? new Date(nowText) : new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("--now must be a valid date-time");
  let config: PlanningSourceConfig = {};
  const configText = values.get("--config-json");
  if (configText) {
    try {
      const parsed = JSON.parse(configText);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      config = parsed as PlanningSourceConfig;
    } catch {
      throw new Error("--config-json must be a JSON object");
    }
  }

  return {
    adapter: adapter as PlanningSourceTestOptions["adapter"],
    provider: provider as PlanningSourceTestOptions["provider"],
    endpoint: parsedEndpoint.toString(),
    config,
    lookbackDays: values.has("--lookback-days")
      ? positiveInteger(values.get("--lookback-days"), "--lookback-days", 31)
      : 7,
    now,
    maxPages: values.has("--max-pages")
      ? positiveInteger(values.get("--max-pages"), "--max-pages", 25)
      : 10,
    enrichDetails: values.has("--enrich-details")
      ? booleanValue(values.get("--enrich-details"), "--enrich-details")
      : true,
    json: switches.has("--json"),
    score: switches.has("--score")
  };
}

function isoDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

function relevantDate(application: NormalisedPlanningApplication) {
  return application.validatedAt ?? application.submittedAt ?? application.decisionAt;
}

function hasDetailPayload(application: NormalisedPlanningApplication) {
  return Boolean(
    application.rawPayload &&
    typeof application.rawPayload === "object" &&
    "details" in application.rawPayload
  );
}

function testSource(options: PlanningSourceTestOptions): PlanningSourceRecord {
  return {
    id: "local-source-test",
    councilId: "local-source-test",
    councilSlug: "local-source-test",
    councilName: "Local planning source",
    slug: "cli",
    adapter: options.adapter,
    endpointUrl: options.endpoint,
    format: options.adapter === "csv" ? "csv" : options.provider === "planit" ? "json" : "html",
    config: {
      ...options.config,
      ...(options.provider ? { provider: options.provider } : {}),
      lookbackDays: options.lookbackDays,
      maxPages: options.maxPages,
      enrichDetails: options.enrichDetails
    }
  };
}

export async function runPlanningSourceTest(
  options: PlanningSourceTestOptions,
  dependencies: { fetchApplications?: FetchApplications } = {}
): Promise<PlanningSourceTestResult> {
  const fetchOptions: PlanningSourceFetchOptions = {
    now: options.now,
    lookbackDays: options.lookbackDays,
    maxPages: options.maxPages,
    enrichDetails: options.enrichDetails
  };
  const fetchApplications = dependencies.fetchApplications ?? fetchPlanningApplications;
  const applications = await fetchApplications(testSource(options), fetchOptions);
  const from = isoDay(new Date(options.now.getTime() - options.lookbackDays * 86_400_000));
  const to = isoDay(options.now);
  const bounded = applications.filter((application) => {
    const date = relevantDate(application);
    return Boolean(date && date >= from && date <= to);
  });
  const dates = bounded
    .map(relevantDate)
    .filter((value): value is string => Boolean(value))
    .sort();

  return {
    source: {
      adapter: options.adapter,
      provider: options.provider,
      endpoint: options.endpoint,
      from,
      to,
      lookbackDays: options.lookbackDays,
      maxPages: options.maxPages
    },
    summary: {
      applicationsReturned: bounded.length,
      detailEnriched: bounded.filter(hasDetailPayload).length,
      earliestDate: dates[0] ?? null,
      latestDate: dates.at(-1) ?? null
    },
    applications: bounded
  };
}

const SENSITIVE_QUERY_PARAMETER = /(?:api[-_]?key|token|secret|password|pass|auth|signature|session|csrf)/i;

function sanitizedUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    for (const name of Array.from(url.searchParams.keys())) {
      if (SENSITIVE_QUERY_PARAMETER.test(name)) url.searchParams.set(name, "[REDACTED]");
    }
    return url.toString();
  } catch {
    return "[invalid URL]";
  }
}

function applicationOutput(application: NormalisedPlanningApplication, includeScore: boolean) {
  const output: Record<string, unknown> = {
    externalReference: application.externalReference,
    address: application.address,
    postcode: application.postcode,
    proposal: application.proposal,
    applicationType: application.applicationType,
    stage: application.stage,
    submittedAt: application.submittedAt,
    validatedAt: application.validatedAt,
    sourceUrl: sanitizedUrl(application.sourceUrl)
  };
  if (includeScore) {
    const scored = scoreWindowsOpportunity(
      application.proposal,
      application.address ?? "",
      application.decision ?? ""
    );
    output.score = {
      score: scored.score,
      priority: scored.priority,
      minValue: scored.minValue,
      maxValue: scored.maxValue,
      reason: scored.reason
    };
  }
  return output;
}

function display(value: unknown) {
  const text = String(value ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return text || "-";
}

export function formatPlanningSourceTestResult(
  result: PlanningSourceTestResult,
  options: PlanningSourceTestFormatOptions
) {
  const safeResult = {
    source: {
      ...result.source,
      endpoint: sanitizedUrl(result.source.endpoint)
    },
    summary: result.summary,
    applications: result.applications.map((application) => applicationOutput(application, options.score))
  };
  if (options.json) return JSON.stringify(safeResult, null, 2);

  const lines = [
    "Source",
    `  Adapter: ${display(safeResult.source.adapter)}`,
    `  Provider: ${display(safeResult.source.provider)}`,
    `  Endpoint: ${display(safeResult.source.endpoint)}`,
    `  Window: ${safeResult.source.from} to ${safeResult.source.to} (${safeResult.source.lookbackDays} days)`,
    `  Max pages: ${safeResult.source.maxPages}`,
    "",
    "Summary",
    `  Applications returned: ${safeResult.summary.applicationsReturned}`,
    `  Detail enriched: ${safeResult.summary.detailEnriched}`,
    `  Earliest relevant date: ${display(safeResult.summary.earliestDate)}`,
    `  Latest relevant date: ${display(safeResult.summary.latestDate)}`,
    "",
    "Applications"
  ];

  safeResult.applications.forEach((application, index) => {
    const score = application.score as {
      score: number;
      priority: string;
      minValue: number;
      maxValue: number;
      reason: string;
    } | undefined;
    lines.push(
      `${index + 1}. ${display(application.externalReference)}`,
      `   Address: ${display(application.address)}`,
      `   Postcode: ${display(application.postcode)}`,
      `   Proposal: ${display(application.proposal)}`,
      `   Application type: ${display(application.applicationType)}`,
      `   Stage/status: ${display(application.stage)}`,
      `   Submitted: ${display(application.submittedAt)}`,
      `   Validated: ${display(application.validatedAt)}`,
      `   Source URL: ${display(application.sourceUrl)}`
    );
    if (score) {
      lines.push(
        `   Score: ${score.score} (${score.priority})`,
        `   Estimated value: \u00a3${score.minValue.toLocaleString("en-GB")}\u2013\u00a3${score.maxValue.toLocaleString("en-GB")}`,
        `   Reason: ${display(score.reason)}`
      );
    }
  });

  if (!safeResult.applications.length) lines.push("  No applications in the bounded window.");
  return `${lines.join("\n")}\n`;
}

function secretValues(options: PlanningSourceTestOptions) {
  const secrets = new Set<string>();
  const endpoint = new URL(options.endpoint);
  for (const [name, value] of endpoint.searchParams) {
    if (value && SENSITIVE_QUERY_PARAMETER.test(name)) secrets.add(value);
  }
  for (const value of Object.values(options.config.requestHeaders ?? {})) {
    if (value) secrets.add(value);
  }
  const visit = (value: unknown, key = "") => {
    if (typeof value === "string" && SENSITIVE_QUERY_PARAMETER.test(key) && value) {
      secrets.add(value);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [childKey, childValue] of Object.entries(value)) visit(childValue, childKey);
  };
  visit(options.config);
  return Array.from(secrets).sort((left, right) => right.length - left.length);
}

function sanitizedError(error: unknown, options: PlanningSourceTestOptions | null) {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of options ? secretValues(options) : []) {
    message = message.split(secret).join("[REDACTED]");
  }
  return message.replace(/[\u0000-\u001f\u007f]+/g, " ").trim() || "Unknown failure";
}

export async function runPlanningSourceTestCli(
  argv: string[],
  io: PlanningSourceTestIo,
  dependencies: { fetchApplications?: FetchApplications } = {}
) {
  let options: PlanningSourceTestOptions | null = null;
  try {
    options = parsePlanningSourceTestArgs(argv);
    const result = await runPlanningSourceTest(options, dependencies);
    const output = formatPlanningSourceTestResult(result, options);
    io.stdout(output.endsWith("\n") ? output : `${output}\n`);
    return 0;
  } catch (error) {
    io.stderr(`Planning source test failed: ${sanitizedError(error, options)}\n`);
    return 1;
  }
}
