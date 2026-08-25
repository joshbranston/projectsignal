import { load } from "cheerio";

export type CoverageIndexRow = {
  code: string;
  authorityName: string;
  platformHint: string;
};

export type CoverageDetail = {
  portalUrl: string;
  platformHint: string;
};

export type PortalProbeResult = {
  outcome: "reachable" | "http_error" | "transport_error" | "unsafe_protocol" | "redirect_limit";
  requestedUrl: string;
  finalUrl: string | null;
  status: number | null;
  contentType: string | null;
  platform: string;
  errorName: string | null;
  errorCode: string | null;
  error: string | null;
};

export type PortalProbeTarget = { authoritySlug: string; portalUrl: string };

export type AuthorityDiscoveryJoin = {
  authoritySlug: string;
  authorityName: string;
  authorityReference: string;
  officialCouncilPage: string | null;
  coverageCode: string | null;
  platformHint: string | null;
  legacySuccessor: string | null;
};

const SECRET_PARAMETER = /(?:api[-_]?key|token|secret|password|pass|auth|signature|session|csrf)/i;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_SIGNATURE_BODY = 512_000;

function isPrivateHostname(value: string) {
  const hostname = value.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "::1") return true;
  const octets = hostname.split(".").map(Number);
  if (octets.length === 4 && octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    return octets[0] === 10 || octets[0] === 127 ||
      (octets[0] === 169 && octets[1] === 254) ||
      (octets[0] === 172 && (octets[1] ?? 0) >= 16 && (octets[1] ?? 0) <= 31) ||
      (octets[0] === 192 && octets[1] === 168) || octets[0] === 0;
  }
  return /^f[cd][0-9a-f]*:/i.test(hostname) || /^fe[89ab][0-9a-f]*:/i.test(hostname);
}

function safePublicPortalUrl(url: URL) {
  return url.protocol === "https:" && !url.username && !url.password && !isPrivateHostname(url.hostname);
}

const LEGACY_LPA_SUCCESSORS: Readonly<Record<string, string>> = {
  E60000019: "Cumberland",
  E60000020: "Westmorland and Furness",
  E60000021: "Cumberland",
  E60000022: "Cumberland",
  E60000023: "Westmorland and Furness",
  E60000024: "Westmorland and Furness",
  E60000057: "North Yorkshire",
  E60000058: "North Yorkshire",
  E60000059: "North Yorkshire",
  E60000060: "North Yorkshire",
  E60000061: "North Yorkshire",
  E60000062: "North Yorkshire",
  E60000063: "North Yorkshire",
  E60000099: "North Northamptonshire",
  E60000100: "West Northamptonshire",
  E60000101: "North Northamptonshire",
  E60000102: "North Northamptonshire",
  E60000103: "West Northamptonshire",
  E60000104: "West Northamptonshire",
  E60000105: "North Northamptonshire",
  E60000233: "Buckinghamshire",
  E60000234: "Buckinghamshire",
  E60000235: "Buckinghamshire",
  E60000236: "Buckinghamshire",
  E60000314: "Somerset",
  E60000315: "Somerset",
  E60000316: "Somerset",
  E60000317: "Somerset"
};

const COVERAGE_NAME_ALIASES: Readonly<Record<string, string>> = {
  E60000053: "Hull",
  E60000113: "Herefordshire",
  E60000290: "Bristol",
  E60000293: "Council of the Isles of Scilly",
  E60000326: "The Broads"
};

function comparableAuthorityName(value: string) {
  return value
    .replace(/\s+LPA$/i, "")
    .replace(/^Kingston upon Hull, City of$/i, "Hull")
    .replace(/^Herefordshire, County of$/i, "Herefordshire")
    .replace(/^Bristol, City of$/i, "Bristol")
    .toLowerCase()
    .replace(/\b(?:the|city|borough|district|metropolitan|council|authority|national park)\b/g, "")
    .replace(/&|\band\b/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

export function joinAuthorityDiscovery(
  authorities: Array<{ authoritySlug: string; name: string; reference: string }>,
  localAuthorities: Array<{
    name: string;
    website: string;
    localPlanningAuthority: string;
  }>,
  coverageRows: CoverageIndexRow[]
): AuthorityDiscoveryJoin[] {
  const localByLpa = new Map(localAuthorities.map((item) => [item.localPlanningAuthority, item]));
  const coverageByName = new Map(
    coverageRows.map((item) => [comparableAuthorityName(item.authorityName), item])
  );
  return authorities.map((authority) => {
    const local = localByLpa.get(authority.reference);
    const coverageName = COVERAGE_NAME_ALIASES[authority.reference] ?? authority.name;
    const coverage = coverageByName.get(comparableAuthorityName(coverageName));
    return {
      authoritySlug: authority.authoritySlug,
      authorityName: authority.name.replace(/\s+LPA$/i, "").trim(),
      authorityReference: authority.reference,
      officialCouncilPage: local?.website ? new URL(local.website).toString() : null,
      coverageCode: coverage?.code ?? null,
      platformHint: coverage?.platformHint ?? null,
      legacySuccessor: LEGACY_LPA_SUCCESSORS[authority.reference] ?? null
    };
  });
}

export function parseCoverageIndex(html: string): CoverageIndexRow[] {
  const rows: CoverageIndexRow[] = [];
  const pattern = /href\\":\\"\\?\/coverage\/([^\\"]+)\\"[\s\S]{0,500}?children\\":\\"([^\\"]+)\\"[\s\S]{0,500}?children\\":\\"([^\\"]+)\\"/g;
  for (const match of html.matchAll(pattern)) {
    rows.push({ code: match[1]!, authorityName: match[2]!, platformHint: match[3]! });
  }
  return rows;
}

export function parseCoverageDetail(html: string): CoverageDetail {
  const $ = load(html);
  const visibleText = $("p")
    .map((_, element) => $(element).text())
    .get()
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const platformHint = visibleText.match(/planning portal\s*\(([^)]+)\)/i)?.[1]?.trim() ?? "Unknown";
  let portalUrl: string | null = null;
  $("a[href]").each((_, element) => {
    if (portalUrl) return;
    const href = $(element).attr("href")?.trim();
    if (!href?.startsWith("https://")) return;
    const text = $(element).text().trim().replace(/\/$/, "");
    if (text === href.replace(/\/$/, "") || /planning|publicaccess|portal|assure|horizon/i.test(href)) {
      portalUrl = href;
    }
  });
  if (!portalUrl) throw new Error("Coverage detail did not expose an original HTTPS planning portal");
  return { portalUrl, platformHint };
}

function safeUrl(value: string) {
  const url = new URL(value);
  for (const name of [...url.searchParams.keys()]) {
    if (SECRET_PARAMETER.test(name)) url.searchParams.set(name, "[REDACTED]");
  }
  return url.toString();
}

function endpointSecrets(value: string) {
  const url = new URL(value);
  return [...url.searchParams]
    .filter(([name, secret]) => SECRET_PARAMETER.test(name) && secret)
    .map(([, secret]) => secret)
    .sort((left, right) => right.length - left.length);
}

async function readSignatureBody(response: Response) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < MAX_SIGNATURE_BODY) {
    const { done, value } = await reader.read();
    if (done) break;
    const remaining = MAX_SIGNATURE_BODY - total;
    chunks.push(value.byteLength > remaining ? value.subarray(0, remaining) : value);
    total += Math.min(value.byteLength, remaining);
    if (total >= MAX_SIGNATURE_BODY) {
      await reader.cancel();
      break;
    }
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

function errorFacts(error: unknown, secrets: string[]) {
  const records: Record<string, unknown>[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current && typeof current === "object"; depth++) {
    const record = current as Record<string, unknown>;
    records.push(record);
    current = record.cause;
  }
  let message = records
    .map((record) => typeof record.message === "string" ? record.message : "")
    .filter(Boolean)
    .join(": ") || String(error);
  for (const secret of secrets) message = message.split(secret).join("[REDACTED]");
  message = message.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  return {
    name: records.find((record) => typeof record.name === "string")?.name as string | undefined,
    code: records.find((record) => typeof record.code === "string")?.code as string | undefined,
    message: message || "Unknown portal transport failure"
  };
}

export function identifyPlanningPlatform(url: string, html: string) {
  const clue = `${url}\n${html}`.toLowerCase();
  if (/online-applications|idox public access|search\.do\?action=/.test(clue)) return "Idox Public Access";
  if (/frmonlineplanningsearch|onlineplanningsearch|assurelive|\/assure\//.test(clue)) return "NEC ASSURE";
  if (/horizonext|statmap/.test(clue)) return "StatMap HorizoNext";
  if (/agileapplications|agile applications/.test(clue)) return "Agile Applications";
  if (/mastergov|def software|\/search\/advanced|\/planning\/weeklylist/.test(clue)) return "DEF / MasterGov";
  if (/planningexplorer|northgate/.test(clue)) return "Northgate PlanningExplorer";
  if (/ocellaweb|ocella/.test(clue)) return "Ocella";
  if (/arcus global|arcus planning|arcus\.planning/.test(clue)) return "Arcus";
  if (/placehub|placecube/.test(clue)) return "PlaceHub";
  if (/civica|cxm/.test(clue)) return "Civica CXM";
  return "Unknown";
}

function unsafeResult(requestedUrl: string, finalUrl: string | null, error: string): PortalProbeResult {
  return {
    outcome: "unsafe_protocol",
    requestedUrl: safeUrl(requestedUrl),
    finalUrl: finalUrl ? safeUrl(finalUrl) : null,
    status: null,
    contentType: null,
    platform: "Unknown",
    errorName: "UnsafeProtocol",
    errorCode: "UNSAFE_PROTOCOL",
    error
  };
}

export async function probePlanningPortal(
  portalUrl: string,
  fetchImpl: typeof fetch = fetch,
  options: { timeoutMs?: number; maxRedirects?: number } = {}
): Promise<PortalProbeResult> {
  const initial = new URL(portalUrl);
  if (!safePublicPortalUrl(initial)) return unsafeResult(portalUrl, null, "Planning portal must use public HTTPS without credentials");
  const secrets = endpointSecrets(portalUrl);
  const timeoutMs = Math.max(1_000, Math.min(options.timeoutMs ?? 12_000, 30_000));
  const maxRedirects = Math.max(0, Math.min(options.maxRedirects ?? 5, 5));
  let current = initial;

  try {
    for (let redirects = 0; redirects <= maxRedirects; redirects++) {
      const response = await fetchImpl(current, {
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "User-Agent": "ProjectSignal planning coverage research/1.0"
        }
      });
      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers.get("location");
        if (!location) {
          return { outcome: "http_error", requestedUrl: safeUrl(portalUrl), finalUrl: safeUrl(current.toString()), status: response.status, contentType: response.headers.get("content-type"), platform: "Unknown", errorName: "HttpRedirect", errorCode: "MISSING_LOCATION", error: "Redirect response omitted Location" };
        }
        const next = new URL(location, current);
        if (!safePublicPortalUrl(next)) return unsafeResult(portalUrl, next.toString(), "Planning portal attempted an unsafe or non-public redirect");
        current = next;
        continue;
      }
      const contentType = response.headers.get("content-type");
      const body = await readSignatureBody(response);
      return {
        outcome: response.ok ? "reachable" : "http_error",
        requestedUrl: safeUrl(portalUrl),
        finalUrl: safeUrl(current.toString()),
        status: response.status,
        contentType,
        platform: identifyPlanningPlatform(current.toString(), body),
        errorName: response.ok ? null : "HttpError",
        errorCode: response.ok ? null : `HTTP_${response.status}`,
        error: response.ok ? null : `Planning portal returned HTTP ${response.status}`
      };
    }
    return { outcome: "redirect_limit", requestedUrl: safeUrl(portalUrl), finalUrl: safeUrl(current.toString()), status: null, contentType: null, platform: "Unknown", errorName: "RedirectLimit", errorCode: "REDIRECT_LIMIT", error: `Planning portal exceeded ${maxRedirects} redirects` };
  } catch (error) {
    const facts = errorFacts(error, secrets);
    return {
      outcome: "transport_error",
      requestedUrl: safeUrl(portalUrl),
      finalUrl: safeUrl(current.toString()),
      status: null,
      contentType: null,
      platform: identifyPlanningPlatform(current.toString(), ""),
      errorName: facts.name ?? "Error",
      errorCode: facts.code ?? null,
      error: facts.message
    };
  }
}

export async function runPortalProbes(
  targets: PortalProbeTarget[],
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}
) {
  const results = new Array<{ authoritySlug: string; probe: PortalProbeResult }>(targets.length);
  const pending = targets.map((target, index) => ({ target, index }));
  const activeHosts = new Set<string>();
  const running = new Set<Promise<void>>();

  const start = (item: (typeof pending)[number]) => {
    const host = new URL(item.target.portalUrl).hostname.toLowerCase();
    activeHosts.add(host);
    const operation = (async () => {
      try {
        results[item.index] = {
          authoritySlug: item.target.authoritySlug,
          probe: await probePlanningPortal(item.target.portalUrl, options.fetchImpl ?? fetch, {
            timeoutMs: options.timeoutMs
          })
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
      const index = pending.findIndex(({ target }) =>
        !activeHosts.has(new URL(target.portalUrl).hostname.toLowerCase())
      );
      if (index < 0) break;
      start(pending.splice(index, 1)[0]!);
    }
    if (running.size) await Promise.race(running);
  }
  return results;
}
