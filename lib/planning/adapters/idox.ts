import { extractPostcode } from "../../scoring.ts";
import type { NormalisedPlanningApplication } from "../types.ts";

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
};

export async function fetchIdoxApplications(
  source: import("../types.ts").PlanningSourceRecord,
  options: IdoxFetchOptions = {}
): Promise<NormalisedPlanningApplication[]> {
  const baseUrl = basePortalUrl(source.endpointUrl);
  const now = options.now ?? new Date();
  const lookbackDays = Math.max(1, Math.min(options.lookbackDays ?? Number(source.config.lookbackDays ?? 7), 31));
  const maxPages = Math.max(1, Math.min(options.maxPages ?? Number(source.config.maxPages ?? 10), 25));
  const searchDateField = source.config.searchDateField ?? "validated";
  const start = new Date(now.getTime() - lookbackDays * 86_400_000);
  const advancedUrl = new URL("search.do?action=advanced", baseUrl).toString();
  const resultsUrl = new URL("advancedSearchResults.do?action=firstPage", baseUrl).toString();
  const commonHeaders = {
    "user-agent": "ProjectSignal/0.3 planning source scanner",
    ...(source.config?.requestHeaders ?? {})
  };

  const session = await fetch(advancedUrl, {
    headers: commonHeaders,
    cache: "no-store"
  });
  if (!session.ok) {
    throw new Error(`${source.councilName} Idox search page returned ${session.status}`);
  }

  const cookie = sessionCookie(session);
  const advancedHtml = await session.text();
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

  const searchResponse = await fetch(resultsUrl, {
    method: "POST",
    headers: {
      ...commonHeaders,
      "content-type": "application/x-www-form-urlencoded",
      referer: advancedUrl,
      ...(cookie ? { cookie } : {})
    },
    body,
    cache: "no-store"
  });
  if (!searchResponse.ok) {
    throw new Error(`${source.councilName} Idox search returned ${searchResponse.status}`);
  }

  const firstHtml = await searchResponse.text();
  const detailLinks = parseIdoxSearchResultLinks(firstHtml, baseUrl);

  // Some Idox installations redirect directly to the only matching result.
  if (searchResponse.url.includes("applicationDetails.do")) {
    const direct = new URL(searchResponse.url).toString();
    if (!detailLinks.includes(direct)) detailLinks.push(direct);
  }

  const pageLinks = parseIdoxPagedSearchLinks(firstHtml, baseUrl).slice(0, Math.max(0, maxPages - 1));
  for (const pageUrl of pageLinks) {
    const page = await fetch(pageUrl, {
      headers: { ...commonHeaders, ...(cookie ? { cookie } : {}) },
      cache: "no-store"
    });
    if (!page.ok) continue;
    for (const link of parseIdoxSearchResultLinks(await page.text(), baseUrl)) {
      if (!detailLinks.includes(link)) detailLinks.push(link);
    }
  }

  const applications: NormalisedPlanningApplication[] = [];
  for (const summaryUrl of detailLinks) {
    const [summaryResponse, detailsResponse] = await Promise.all([
      fetch(detailTabUrl(summaryUrl, "summary"), {
        headers: { ...commonHeaders, ...(cookie ? { cookie } : {}) },
        cache: "no-store"
      }),
      fetch(detailTabUrl(summaryUrl, "details"), {
        headers: { ...commonHeaders, ...(cookie ? { cookie } : {}) },
        cache: "no-store"
      })
    ]);

    if (!summaryResponse.ok) continue;
    const summaryHtml = await summaryResponse.text();
    const detailsHtml = detailsResponse.ok ? await detailsResponse.text() : "";
    const application = parseIdoxApplicationHtml({
      summaryHtml,
      detailsHtml,
      sourceUrl: detailTabUrl(summaryUrl, "summary")
    });
    if (application) applications.push(application);
  }

  return applications;
}
