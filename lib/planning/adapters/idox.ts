import { extractPostcode } from "../../scoring.ts";
import type { NormalisedPlanningApplication, PlanningSourceRecord } from "../types.ts";

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function cleanHtml(value: string) {
  return decodeHtml(
    value
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

function nullable(value: string | undefined | null) {
  const text = String(value ?? "").trim();
  if (!text || /^(?:not available|blank field|n\/?a|null|none)$/i.test(text)) return null;
  return text;
}

function extractLabelValues(html: string) {
  const values: Record<string, string> = {};

  const rowPattern = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  for (const rowMatch of html.matchAll(rowPattern)) {
    const cells = Array.from(
      rowMatch[1].matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi),
      (match) => cleanHtml(match[1])
    ).filter(Boolean);
    if (cells.length >= 2 && cells[0]) values[cells[0]] = cells[1];
  }

  const dlPattern = /<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi;
  for (const match of html.matchAll(dlPattern)) {
    const label = cleanHtml(match[1]);
    const value = cleanHtml(match[2]);
    if (label) values[label] = value;
  }

  return values;
}

function isoDate(value: string | null | undefined) {
  const text = nullable(value);
  if (!text) return null;

  const match = text.match(/(?:\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+)?(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/i);
  if (!match) {
    const numeric = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
    if (!numeric) return null;
    return `${numeric[3]}-${numeric[2].padStart(2, "0")}-${numeric[1].padStart(2, "0")}`;
  }

  const months: Record<string, string> = {
    jan: "01", january: "01",
    feb: "02", february: "02",
    mar: "03", march: "03",
    apr: "04", april: "04",
    may: "05",
    jun: "06", june: "06",
    jul: "07", july: "07",
    aug: "08", august: "08",
    sep: "09", sept: "09", september: "09",
    oct: "10", october: "10",
    nov: "11", november: "11",
    dec: "12", december: "12"
  };
  const month = months[match[2].toLowerCase()];
  if (!month) return null;
  return `${match[3]}-${month}-${match[1].padStart(2, "0")}`;
}

export function parseIdoxSearchResultLinks(html: string, baseUrl: string) {
  const urls: string[] = [];
  const seen = new Set<string>();
  const hrefPattern = /href\s*=\s*["']([^"']*applicationDetails\.do\?[^"']*)["']/gi;

  for (const match of html.matchAll(hrefPattern)) {
    const href = decodeHtml(match[1]);
    const url = new URL(href, baseUrl).toString();
    if (!seen.has(url)) {
      seen.add(url);
      urls.push(url);
    }
  }

  return urls;
}

export function parseIdoxApplicationHtml(input: {
  summaryHtml: string;
  detailsHtml?: string;
  sourceUrl: string;
}): NormalisedPlanningApplication | null {
  const summary = extractLabelValues(input.summaryHtml);
  const details = extractLabelValues(input.detailsHtml ?? "");
  const externalReference = nullable(summary.Reference ?? details.Reference);
  const proposal = nullable(summary.Proposal ?? details.Proposal);

  if (!externalReference || !proposal) return null;

  const address = nullable(summary.Address ?? details.Address);

  return {
    externalReference,
    address,
    postcode: address ? extractPostcode(address) || null : null,
    latitude: null,
    longitude: null,
    proposal,
    applicationType: nullable(details["Application Type"] ?? summary["Application Type"]),
    stage: nullable(summary.Status ?? details.Status),
    submittedAt: isoDate(summary["Application Received"] ?? summary["Application Received Date"]),
    validatedAt: isoDate(summary["Application Validated"] ?? summary["Application Validated Date"]),
    decisionAt: isoDate(
      summary["Decision Issued Date"] ??
      summary["Decision Made Date"] ??
      details["Decision Issued Date"] ??
      details["Decision Made Date"]
    ),
    decision: nullable(summary.Decision ?? details.Decision),
    applicantName: nullable(details["Applicant Name"] ?? summary["Applicant Name"]),
    agentName: nullable(details["Agent Name"] ?? summary["Agent Name"]),
    agentContact: nullable(
      details["Agent Address"] ?? details["Agent Email"] ?? details["Agent Phone"]
    ),
    sourceUrl: input.sourceUrl,
    rawPayload: { summary, details }
  };
}

function basePortalUrl(endpointUrl: string) {
  return endpointUrl.endsWith("/") ? endpointUrl : `${endpointUrl}/`;
}

function requestHeaderValues(headers?: HeadersInit) {
  if (!headers) return [];

  try {
    return Array.from(new Headers(headers).entries())
      .filter(([, value]) => Boolean(value))
      .map(([, value]) => value);
  } catch {
    return [];
  }
}

function diagnosticText(value: unknown, redactedValues: string[]) {
  let text = String(value)
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  for (const redactedValue of [...new Set(redactedValues)].sort((a, b) => b.length - a.length)) {
    text = text.split(redactedValue).join("[REDACTED]");
  }

  return text
    .replace(
      /\b(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key)\s*[:=][^\r\n]*/gi,
      "[REDACTED]"
    )
    .slice(0, 300);
}

function transportErrorSummary(failure: unknown, redactedValues: string[]) {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = failure;

  while (current !== undefined && current !== null && parts.length < 5 && !seen.has(current)) {
    seen.add(current);

    if (typeof current !== "object") {
      parts.push(diagnosticText(current, redactedValues));
      break;
    }

    const record = current as Record<string, unknown>;
    const name = record.name ? diagnosticText(record.name, redactedValues) : "Error";
    const code = record.code ? diagnosticText(record.code, redactedValues) : "";
    const message = record.message ? diagnosticText(record.message, redactedValues) : "";
    const label = code ? `${name}[${code}]` : name;
    parts.push(message ? `${label}: ${message}` : label);
    current = record.cause;
  }

  return parts.join("; cause=") || "Unknown transport error";
}

function idoxTransportError(
  source: PlanningSourceRecord,
  action: string,
  failure: unknown,
  redactedValues: string[] = []
) {
  const host = new URL(source.endpointUrl).hostname;
  const sensitiveValues = [
    ...requestHeaderValues(source.config.requestHeaders),
    ...redactedValues
  ];
  return new Error(
    `${source.councilName} Idox ${action} failed ` +
    `(portal=${source.councilSlug}, host=${host}): ${transportErrorSummary(failure, sensitiveValues)}`,
    { cause: failure }
  );
}

async function fetchIdoxRequest(
  source: PlanningSourceRecord,
  operation: string,
  input: string,
  init: RequestInit,
  requestTimeoutMs: number,
  redactedValues: string[] = []
) {
  try {
    return await fetch(input, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(requestTimeoutMs)
    });
  } catch (failure) {
    throw idoxTransportError(
      source,
      `${operation} request`,
      failure,
      [...requestHeaderValues(init.headers), ...redactedValues]
    );
  }
}

async function readIdoxText(
  source: PlanningSourceRecord,
  operation: string,
  response: Response,
  redactedValues: string[] = []
) {
  try {
    return await response.text();
  } catch (failure) {
    throw idoxTransportError(source, `${operation} response`, failure, redactedValues);
  }
}

function formatUkDate(date: Date) {
  return `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${date.getUTCFullYear()}`;
}

function csrfToken(html: string) {
  for (const match of html.matchAll(/<input\b([^>]*)>/gi)) {
    const attrs = match[1];
    const name = attrs.match(/\bname\s*=\s*["']([^"']+)["']/i)?.[1];
    if (name !== "_csrf") continue;
    return attrs.match(/\bvalue\s*=\s*["']([^"']*)["']/i)?.[1] ?? null;
  }
  return null;
}

function sessionCookie(response: Response) {
  const header = response.headers.get("set-cookie");
  if (!header) return null;
  return header
    .split(/,(?=[^;,]+=)/)
    .map((part) => part.split(";", 1)[0].trim())
    .filter(Boolean)
    .join("; ");
}

function detailTabUrl(summaryUrl: string, tab: string) {
  const url = new URL(summaryUrl);
  url.searchParams.set("activeTab", tab);
  return url.toString();
}

function parseIdoxPagedSearchLinks(html: string, baseUrl: string) {
  const urls: string[] = [];
  const seen = new Set<string>();
  const hrefPattern = /href\s*=\s*["']([^"']*pagedSearchResults\.do\?[^"']*)["']/gi;
  for (const match of html.matchAll(hrefPattern)) {
    const url = new URL(decodeHtml(match[1]), baseUrl).toString();
    if (!seen.has(url)) {
      seen.add(url);
      urls.push(url);
    }
  }
  return urls;
}

export type IdoxFetchOptions = {
  now?: Date;
  lookbackDays?: number;
  maxPages?: number;
  requestTimeoutMs?: number;
};

export async function fetchIdoxApplications(
  source: PlanningSourceRecord,
  options: IdoxFetchOptions = {}
): Promise<NormalisedPlanningApplication[]> {
  const baseUrl = basePortalUrl(source.endpointUrl);
  const now = options.now ?? new Date();
  const lookbackDays = Math.max(1, Math.min(options.lookbackDays ?? Number(source.config.lookbackDays ?? 7), 31));
  const maxPages = Math.max(1, Math.min(options.maxPages ?? Number(source.config.maxPages ?? 10), 25));
  const requestTimeoutMs = Math.max(1, Math.min(options.requestTimeoutMs ?? 15_000, 30_000));
  const searchDateField = source.config.searchDateField ?? "validated";
  const start = new Date(now.getTime() - lookbackDays * 86_400_000);
  const advancedUrl = new URL("search.do?action=advanced", baseUrl).toString();
  const resultsUrl = new URL("advancedSearchResults.do?action=firstPage", baseUrl).toString();
  const commonHeaders = {
    "user-agent": "ProjectSignal/0.3 planning source scanner",
    ...(source.config?.requestHeaders ?? {})
  };
  const request = (
    operation: string,
    input: string,
    init: RequestInit,
    redactedValues: string[] = []
  ) => fetchIdoxRequest(source, operation, input, init, requestTimeoutMs, redactedValues);

  const session = await request("open-search-page", advancedUrl, {
    headers: commonHeaders,
    cache: "no-store"
  });
  if (!session.ok) {
    throw new Error(`${source.councilName} Idox search page returned ${session.status}`);
  }

  const cookie = sessionCookie(session);
  const advancedHtml = await readIdoxText(
    source,
    "read-search-page",
    session,
    cookie ? [cookie] : []
  );
  const csrf = csrfToken(advancedHtml);
  if (!csrf) {
    throw new Error(`${source.councilName} Idox search page did not provide a CSRF token`);
  }

  const datePrefix = searchDateField === "received" ? "applicationReceived" : "applicationValidated";
  const body = new URLSearchParams({
    _csrf: csrf,
    searchType: "Application",
    caseAddressType: "Application",
    [`date(${datePrefix}Start)`]: formatUkDate(start),
    [`date(${datePrefix}End)`]: formatUkDate(now)
  });

  const searchResponse = await request(
    "submit-search",
    resultsUrl,
    {
      method: "POST",
      headers: {
        ...commonHeaders,
        "content-type": "application/x-www-form-urlencoded",
        referer: advancedUrl,
        ...(cookie ? { cookie } : {})
      },
      body,
      cache: "no-store"
    },
    [csrf]
  );
  if (!searchResponse.ok) {
    throw new Error(`${source.councilName} Idox search returned ${searchResponse.status}`);
  }

  const sessionValues = cookie ? [csrf, cookie] : [csrf];
  const firstHtml = await readIdoxText(
    source,
    "read-search-results",
    searchResponse,
    sessionValues
  );
  const detailLinks = parseIdoxSearchResultLinks(firstHtml, baseUrl);

  // Some Idox installations redirect directly to the only matching result.
  if (searchResponse.url.includes("applicationDetails.do")) {
    const direct = new URL(searchResponse.url).toString();
    if (!detailLinks.includes(direct)) detailLinks.push(direct);
  }

  const pageLinks = parseIdoxPagedSearchLinks(firstHtml, baseUrl).slice(0, Math.max(0, maxPages - 1));
  for (const pageUrl of pageLinks) {
    const page = await request("load-results-page", pageUrl, {
      headers: { ...commonHeaders, ...(cookie ? { cookie } : {}) },
      cache: "no-store"
    });
    if (!page.ok) continue;
    const pageHtml = await readIdoxText(
      source,
      "read-results-page",
      page,
      cookie ? [cookie] : []
    );
    for (const link of parseIdoxSearchResultLinks(pageHtml, baseUrl)) {
      if (!detailLinks.includes(link)) detailLinks.push(link);
    }
  }

  const applications: NormalisedPlanningApplication[] = [];
  for (const summaryUrl of detailLinks) {
    const [summaryResponse, detailsResponse] = await Promise.all([
      request("load-summary", detailTabUrl(summaryUrl, "summary"), {
        headers: { ...commonHeaders, ...(cookie ? { cookie } : {}) },
        cache: "no-store"
      }),
      request("load-details", detailTabUrl(summaryUrl, "details"), {
        headers: { ...commonHeaders, ...(cookie ? { cookie } : {}) },
        cache: "no-store"
      })
    ]);

    if (!summaryResponse.ok) continue;
    const sessionCookieValues = cookie ? [cookie] : [];
    const summaryHtml = await readIdoxText(
      source,
      "read-summary",
      summaryResponse,
      sessionCookieValues
    );
    const detailsHtml = detailsResponse.ok
      ? await readIdoxText(source, "read-details", detailsResponse, sessionCookieValues)
      : "";
    const application = parseIdoxApplicationHtml({
      summaryHtml,
      detailsHtml,
      sourceUrl: detailTabUrl(summaryUrl, "summary")
    });
    if (application) applications.push(application);
  }

  return applications;
}
