import { extractPostcode } from "../../scoring.ts";
import type { NormalisedPlanningApplication, PlanningSourceRecord } from "../types.ts";

type MasterGovSearchApplication = NormalisedPlanningApplication & {
  rawPayload: { search: Record<string, string> };
};

export type MasterGovSearchResults = {
  applications: MasterGovSearchApplication[];
  pageUrls: string[];
  resultCount: number | null;
  recognized: boolean;
};

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
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

function nullable(value: string | null | undefined) {
  const text = String(value ?? "").trim();
  if (!text || /^(?:not available|blank field|n\/?a|null|none|-+)$/i.test(text)) return null;
  return text;
}

function isoDate(value: string | null | undefined) {
  const text = nullable(value);
  if (!text) return null;

  const numeric = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
  if (numeric) return `${numeric[3]}-${numeric[2].padStart(2, "0")}-${numeric[1].padStart(2, "0")}`;

  const named = text.match(/^(?:\w+\s+)?(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/);
  if (!named) return null;
  const months: Record<string, string> = {
    jan: "01", january: "01", feb: "02", february: "02", mar: "03", march: "03",
    apr: "04", april: "04", may: "05", jun: "06", june: "06", jul: "07", july: "07",
    aug: "08", august: "08", sep: "09", sept: "09", september: "09", oct: "10",
    october: "10", nov: "11", november: "11", dec: "12", december: "12"
  };
  const month = months[named[2].toLowerCase()];
  return month ? `${named[3]}-${month}-${named[1].padStart(2, "0")}` : null;
}

function tableCells(rowHtml: string) {
  return Array.from(
    rowHtml.matchAll(/<(th|td)\b[^>]*>([\s\S]*?)<\/\1>/gi),
    (match) => ({ tag: match[1].toLowerCase(), html: match[2], text: cleanHtml(match[2]) })
  );
}

function extractLabelValues(html: string) {
  const values: Record<string, string> = {};

  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = tableCells(row[1]);
    if (cells.length >= 2 && cells[0].text) values[cells[0].text] = cells[1].text;
  }

  for (const match of html.matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi)) {
    const label = cleanHtml(match[1]);
    if (label) values[label] = cleanHtml(match[2]);
  }

  return values;
}

function valueFor(values: Record<string, string>, ...labels: string[]) {
  const normalized = new Map(
    Object.entries(values).map(([key, value]) => [key.replace(/\s*:\s*$/, "").trim().toLowerCase(), value])
  );
  for (const label of labels) {
    const value = normalized.get(label.toLowerCase());
    if (value !== undefined) return value;
  }
  return undefined;
}

function safeSameOriginUrl(href: string, baseUrl: string) {
  try {
    const base = new URL(baseUrl);
    const resolved = new URL(decodeHtml(href), base);
    return resolved.origin === base.origin ? resolved.toString() : null;
  } catch {
    return null;
  }
}

function firstHref(html: string, baseUrl: string) {
  const href = html.match(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
  return href ? safeSameOriginUrl(href, baseUrl) : null;
}

export function parseMasterGovSearchResultsHtml(html: string, baseUrl: string): MasterGovSearchResults {
  const applications: MasterGovSearchApplication[] = [];
  const pageUrls: string[] = [];
  const seenPages = new Set<string>();
  const rows = Array.from(html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi), (match) => match[1]);
  let headers: string[] | null = null;

  for (const row of rows) {
    const cells = tableCells(row);
    if (!headers && cells.some((cell) => cell.tag === "th")) {
      const candidate = cells.map((cell) => cell.text);
      if (candidate.some((header) => /application\s*(?:number|reference)/i.test(header))) headers = candidate;
      continue;
    }
    if (!headers || cells.length < headers.length) continue;

    const search: Record<string, string> = {};
    headers.forEach((header, index) => { search[header] = cells[index]?.text ?? ""; });
    const externalReference = nullable(valueFor(search, "Application Number", "Application Reference"));
    const proposal = nullable(valueFor(search, "Description", "Proposal"));
    const referenceIndex = headers.findIndex((header) => /application\s*(?:number|reference)/i.test(header));
    const sourceUrl = referenceIndex >= 0 ? firstHref(cells[referenceIndex]?.html ?? "", baseUrl) : null;
    if (!externalReference || !proposal || !sourceUrl) continue;

    const address = nullable(valueFor(search, "Location", "Address"));
    applications.push({
      externalReference,
      address,
      postcode: address ? extractPostcode(address) || null : null,
      latitude: null,
      longitude: null,
      proposal,
      applicationType: nullable(valueFor(search, "Application Type")),
      stage: nullable(valueFor(search, "Status Decision", "Status")),
      submittedAt: isoDate(valueFor(search, "Date Received", "Received Date")),
      validatedAt: isoDate(valueFor(search, "Date Validated", "Validated Date")),
      decisionAt: isoDate(valueFor(search, "Decision Date", "Date Decision")),
      decision: nullable(valueFor(search, "Decision")),
      applicantName: null,
      agentName: null,
      agentContact: null,
      sourceUrl,
      rawPayload: { search }
    });
  }

  for (const match of html.matchAll(/href\s*=\s*["']([^"']*\/Search\/ResultsPage\/\d+[^"']*)["']/gi)) {
    const url = safeSameOriginUrl(match[1], baseUrl);
    if (url && !seenPages.has(url)) {
      seenPages.add(url);
      pageUrls.push(url);
    }
  }

  const resultCountMatch = cleanHtml(html).match(/\b(\d[\d,]*)\s+(?:search\s+)?results?\s+(?:found|returned)\b/i);
  const resultCount = resultCountMatch ? Number(resultCountMatch[1].replace(/,/g, "")) : null;
  return {
    applications,
    pageUrls,
    resultCount,
    recognized: headers !== null || resultCount !== null
  };
}

export function parseMasterGovApplicationHtml(input: {
  detailHtml: string;
  sourceUrl: string;
  fallback?: MasterGovSearchApplication;
}): NormalisedPlanningApplication | null {
  const details = extractLabelValues(input.detailHtml);
  const fallback = input.fallback;
  const detailReference = nullable(valueFor(details, "Application Number", "Application Reference"));
  if (
    fallback &&
    detailReference &&
    detailReference.replace(/\s+/g, "").toUpperCase() !==
      fallback.externalReference.replace(/\s+/g, "").toUpperCase()
  ) return null;
  const externalReference = fallback?.externalReference ?? detailReference;
  const proposal = nullable(valueFor(details, "Description", "Proposal")) ?? fallback?.proposal ?? null;
  if (!detailReference || !externalReference || !proposal) return null;

  const search = fallback?.rawPayload.search ?? {};
  const address = nullable(valueFor(details, "Location Address", "Location", "Address")) ?? fallback?.address ?? null;
  return {
    externalReference,
    address,
    postcode: address ? extractPostcode(address) || null : null,
    latitude: null,
    longitude: null,
    proposal,
    applicationType: nullable(valueFor(details, "Application Type")) ?? fallback?.applicationType ?? null,
    stage: nullable(valueFor(details, "Status", "Status Decision")) ?? fallback?.stage ?? null,
    submittedAt: isoDate(valueFor(details, "Application Received Date", "Date Received", "Received Date")) ?? fallback?.submittedAt ?? null,
    validatedAt: isoDate(valueFor(details, "Application Valid Date", "Application Validated Date", "Date Validated", "Validated Date")) ?? fallback?.validatedAt ?? null,
    decisionAt: isoDate(valueFor(details, "Decision Date", "Date Decision")) ?? fallback?.decisionAt ?? null,
    decision: nullable(valueFor(details, "Decision")) ?? fallback?.decision ?? null,
    applicantName: nullable(valueFor(details, "Applicant Name")),
    agentName: nullable(valueFor(details, "Agent Name")),
    agentContact: nullable(valueFor(details, "Agent Address", "Agent Email", "Agent Phone")),
    sourceUrl: input.sourceUrl,
    rawPayload: { search, details }
  };
}

function requestHeaderValues(headers?: HeadersInit) {
  if (!headers) return [];
  try {
    return Array.from(new Headers(headers).values()).filter(Boolean);
  } catch {
    return [];
  }
}

function redactionFragments(values: string[]) {
  const fragments = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    fragments.add(value);
    const authorization = value.match(/^(?:basic|bearer)\s+(.+)$/i)?.[1];
    if (authorization) fragments.add(authorization);
    for (const segment of value.split(/;\s*/)) {
      const cookieValue = segment.match(/^[A-Za-z0-9_.-]+=([^;]*)$/)?.[1];
      if (cookieValue) fragments.add(cookieValue);
    }
  }
  return [...fragments].sort((a, b) => b.length - a.length);
}

function diagnosticText(value: unknown, redactedValues: string[]) {
  let text = String(value).replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  for (const redactedValue of redactionFragments(redactedValues)) {
    text = text.split(redactedValue).join("[REDACTED]");
  }
  return text
    .replace(/\b(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key)\s*[:=][^\r\n]*/gi, "[REDACTED]")
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
    parts.push(`${code ? `${name}[${code}]` : name}${message ? `: ${message}` : ""}`);
    current = record.cause;
  }
  return parts.join("; cause=") || "Unknown transport error";
}

function masterGovTransportError(
  source: PlanningSourceRecord,
  operation: string,
  failure: unknown,
  redactedValues: string[]
) {
  const hostname = new URL(source.endpointUrl).hostname;
  const sensitiveValues = [...requestHeaderValues(source.config.requestHeaders), ...redactedValues];
  return new Error(
    `${source.councilName} MasterGov ${operation} failed ` +
    `(portal=${source.councilSlug}, host=${hostname}): ${transportErrorSummary(failure, sensitiveValues)}`,
    { cause: sanitizedErrorCause(failure, sensitiveValues) }
  );
}

function sanitizedErrorCause(
  failure: unknown,
  redactedValues: string[],
  seen = new Set<unknown>(),
  depth = 0
): Error | undefined {
  if (failure === undefined || failure === null || depth >= 5 || seen.has(failure)) return undefined;
  if (typeof failure !== "object") return new Error(diagnosticText(failure, redactedValues));
  seen.add(failure);
  const record = failure as Record<string, unknown>;
  const nested = sanitizedErrorCause(record.cause, redactedValues, seen, depth + 1);
  const safe = new Error(
    diagnosticText(record.message ?? "Transport error", redactedValues),
    nested ? { cause: nested } : undefined
  ) as Error & { code?: string };
  safe.name = diagnosticText(record.name ?? "Error", redactedValues);
  if (record.code) safe.code = diagnosticText(record.code, redactedValues);
  return safe;
}

function responseBodyClue(body: string, redactedValues: string[]) {
  const clues: string[] = [];
  for (const [label, pattern] of [
    ["title", /<title\b[^>]*>([\s\S]*?)<\/title>/i],
    ["h1", /<h1\b[^>]*>([\s\S]*?)<\/h1>/i]
  ] as const) {
    const match = body.match(pattern);
    if (!match) continue;
    const value = diagnosticText(cleanHtml(match[1]), redactedValues).slice(0, 120);
    if (value) clues.push(`${label}=${value}`);
  }
  return clues.join("; ") || `body=${body.trim() ? "non-empty" : "empty"}`;
}

async function masterGovHttpRejectionError(
  source: PlanningSourceRecord,
  operation: string,
  requestUrl: string,
  response: Response,
  redactedValues: string[]
) {
  let body = "";
  let bodyFailure: unknown;
  try {
    body = await response.text();
  } catch (failure) {
    bodyFailure = failure;
  }

  let hostname = new URL(source.endpointUrl).hostname;
  try {
    hostname = new URL(response.url || requestUrl).hostname;
  } catch {
    // The configured portal hostname remains the safe fallback.
  }
  const contentType = diagnosticText(response.headers.get("content-type") ?? "unknown", redactedValues);
  const statusText = diagnosticText(response.statusText || "unknown", redactedValues);
  const clue = bodyFailure
    ? `body=unreadable (${transportErrorSummary(bodyFailure, redactedValues)})`
    : responseBodyClue(body, redactedValues);
  return new Error(
    `${source.councilName} MasterGov ${operation} rejected ` +
    `(portal=${source.councilSlug}, host=${hostname}, status=${response.status}, ` +
    `content-type=${contentType}, status-text=${statusText}, clue=${clue})`,
    bodyFailure ? { cause: sanitizedErrorCause(bodyFailure, redactedValues) } : undefined
  );
}

function setCookieHeaders(response: Response) {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const values = headers.getSetCookie?.() ?? [];
  if (values.length) return values;
  const combined = response.headers.get("set-cookie");
  return combined ? combined.split(/,(?=\s*[^;,=]+=[^;,]*)/) : [];
}

class MasterGovCookieJar {
  private readonly cookies = new Map<string, string>();
  private readonly historicalSensitiveValues = new Set<string>();

  add(response: Response) {
    for (const setCookie of setCookieHeaders(response)) {
      const pair = setCookie.split(";", 1)[0]?.trim();
      const separator = pair?.indexOf("=") ?? -1;
      if (!pair || separator <= 0) continue;
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      if (value) {
        this.cookies.set(name, value);
        this.historicalSensitiveValues.add(pair);
        this.historicalSensitiveValues.add(value);
      }
      else this.cookies.delete(name);
    }
  }

  header() {
    return Array.from(this.cookies, ([name, value]) => `${name}=${value}`).join("; ");
  }

  sensitiveValues() {
    const header = this.header();
    return [...this.historicalSensitiveValues, ...(header ? [header] : [])];
  }
}

function formAttribute(attributes: string, name: string) {
  const pattern = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:["']([^"']*)["']|([^\\s>]+))`, "i");
  const match = attributes.match(pattern);
  return match ? decodeHtml(match[1] ?? match[2] ?? "") : null;
}

function disclaimerForm(html: string, pageUrl: string) {
  for (const match of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const action = formAttribute(match[1], "action");
    if (action === null) continue;
    const actionUrl = new URL(action, pageUrl);
    if (!/\/Disclaimer\/Accept\/?$/i.test(actionUrl.pathname)) continue;
    if (actionUrl.origin !== new URL(pageUrl).origin) {
      throw new Error("MasterGov disclaimer form action is cross-origin");
    }
    const method = (formAttribute(match[1], "method") ?? "get").toLowerCase();
    if (method !== "post") throw new Error(`MasterGov disclaimer form uses unsupported method ${method.toUpperCase()}`);

    const fields = new URLSearchParams();
    const sensitiveValues: string[] = [];
    for (const input of match[2].matchAll(/<input\b([^>]*)>/gi)) {
      const type = (formAttribute(input[1], "type") ?? "text").toLowerCase();
      const name = formAttribute(input[1], "name");
      if (type !== "hidden" || !name) continue;
      const value = formAttribute(input[1], "value") ?? "";
      fields.append(name, value);
      if (value) sensitiveValues.push(value);
    }
    return { actionUrl: actionUrl.toString(), fields, sensitiveValues };
  }
  return null;
}

function formatMasterGovDate(date: Date) {
  return `${String(date.getUTCMonth() + 1).padStart(2, "0")}/${String(date.getUTCDate()).padStart(2, "0")}/${date.getUTCFullYear()} 00:00:00`;
}

function basePortalUrl(endpointUrl: string) {
  return endpointUrl.endsWith("/") ? endpointUrl : `${endpointUrl}/`;
}

function isRedirect(response: Response) {
  return [301, 302, 303, 307, 308].includes(response.status);
}

export type MasterGovFetchOptions = {
  now?: Date;
  lookbackDays?: number;
  maxPages?: number;
  requestTimeoutMs?: number;
  detailConcurrency?: number;
  enrichDetails?: boolean;
};

function boundedPositiveInteger(value: unknown, fallback: number, maximum: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(1, Math.min(Math.trunc(numeric), maximum));
}

export async function fetchMasterGovApplications(
  source: PlanningSourceRecord,
  options: MasterGovFetchOptions = {}
): Promise<NormalisedPlanningApplication[]> {
  const baseUrl = basePortalUrl(source.endpointUrl);
  const portalOrigin = new URL(baseUrl).origin;
  const now = options.now ?? new Date();
  const lookbackDays = boundedPositiveInteger(options.lookbackDays ?? source.config.lookbackDays, 7, 31);
  const maxPages = boundedPositiveInteger(options.maxPages ?? source.config.maxPages, 10, 25);
  const requestTimeoutMs = boundedPositiveInteger(options.requestTimeoutMs, 15_000, 30_000);
  const detailConcurrency = boundedPositiveInteger(options.detailConcurrency, 4, 5);
  const enrichDetails = options.enrichDetails ?? source.config.enrichDetails ?? true;
  const start = new Date(now.getTime() - lookbackDays * 86_400_000);
  const searchUrl = new URL("Search/Standard", baseUrl);
  searchUrl.search = new URLSearchParams({
    AcknowledgeLetterDateFrom: formatMasterGovDate(start),
    AcknowledgeLetterDateTo: formatMasterGovDate(now)
  }).toString();

  const commonHeaders = {
    "user-agent": "ProjectSignal/0.3 planning source scanner",
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "en-GB,en;q=0.9",
    ...(source.config.requestHeaders ?? {})
  };
  const jar = new MasterGovCookieJar();
  const persistentSecrets: string[] = [];

  const sensitiveValues = (extra: string[] = []) => [
    ...requestHeaderValues(commonHeaders),
    ...jar.sensitiveValues(),
    ...persistentSecrets,
    ...extra
  ];

  const request = async (operation: string, url: string, init: RequestInit = {}, extraSecrets: string[] = []) => {
    const headers = new Headers(commonHeaders);
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    const cookie = jar.header();
    if (cookie) headers.set("cookie", cookie);
    try {
      const response = await fetch(url, {
        ...init,
        headers,
        redirect: "manual",
        signal: init.signal ?? AbortSignal.timeout(requestTimeoutMs)
      });
      jar.add(response);
      return response;
    } catch (failure) {
      throw masterGovTransportError(source, `${operation} request`, failure, sensitiveValues(extraSecrets));
    }
  };

  const readText = async (operation: string, response: Response, extraSecrets: string[] = []) => {
    try {
      return await response.text();
    } catch (failure) {
      throw masterGovTransportError(source, `${operation} response`, failure, sensitiveValues(extraSecrets));
    }
  };

  const resolvePortalUrl = (location: string, currentUrl: string) => {
    const resolved = new URL(location, currentUrl);
    if (resolved.origin !== portalOrigin) throw new Error("MasterGov redirect is cross-origin");
    return resolved.toString();
  };

  const followGetRedirects = async (
    operation: string,
    initialUrl: string,
    initialResponse: Response,
    extraSecrets: string[] = []
  ) => {
    let currentUrl = initialUrl;
    let response = initialResponse;
    for (let redirects = 0; isRedirect(response); redirects += 1) {
      if (redirects >= 8) throw new Error(`${source.councilName} MasterGov ${operation} exceeded redirect limit`);
      const location = response.headers.get("location");
      if (!location) throw new Error(`${source.councilName} MasterGov ${operation} redirect omitted Location`);
      const nextUrl = resolvePortalUrl(location, currentUrl);
      response = await request(operation, nextUrl, { headers: { referer: currentUrl }, cache: "no-store" }, extraSecrets);
      currentUrl = nextUrl;
    }
    if (!response.ok) {
      throw await masterGovHttpRejectionError(
        source,
        operation,
        currentUrl,
        response,
        sensitiveValues(extraSecrets)
      );
    }
    return { response, url: currentUrl };
  };

  const initialUrl = searchUrl.toString();
  const initialResponse = await request("open-date-search", initialUrl, { cache: "no-store" });
  let current = await followGetRedirects("open-date-search", initialUrl, initialResponse);
  let resultsHtml = await readText("read-date-search", current.response);
  const form = disclaimerForm(resultsHtml, current.url);

  if (form) {
    persistentSecrets.push(...form.sensitiveValues);
    const accepted = await request("accept-disclaimer", form.actionUrl, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        referer: current.url
      },
      body: form.fields,
      cache: "no-store"
    }, form.sensitiveValues);
    if ([307, 308].includes(accepted.status)) {
      throw new Error(
        `${source.councilName} MasterGov accept-disclaimer returned unsupported POST redirect ${accepted.status} ` +
        `(portal=${source.councilSlug}, host=${new URL(baseUrl).hostname})`
      );
    }
    current = await followGetRedirects("load-date-search", form.actionUrl, accepted, form.sensitiveValues);
    resultsHtml = await readText("read-date-search", current.response, form.sensitiveValues);
  }

  const firstPage = parseMasterGovSearchResultsHtml(resultsHtml, baseUrl);
  if (!firstPage.recognized) {
    throw new Error(
      `${source.councilName} MasterGov search response did not contain recognizable search results ` +
      `(portal=${source.councilSlug}, host=${new URL(baseUrl).hostname})`
    );
  }
  if ((firstPage.resultCount ?? 0) > 0 && firstPage.applications.length === 0) {
    throw new Error(
      `${source.councilName} MasterGov search response reported ${firstPage.resultCount} results but yielded no parseable applications ` +
      `(portal=${source.councilSlug}, host=${new URL(baseUrl).hostname})`
    );
  }
  if (firstPage.resultCount !== null && firstPage.pageUrls.length > Math.max(0, maxPages - 1)) {
    throw new Error(
      `${source.councilName} MasterGov page cap cannot prove complete advertised total ${firstPage.resultCount} ` +
      `(portal=${source.councilSlug}, host=${new URL(baseUrl).hostname})`
    );
  }

  const byReference = new Map<string, MasterGovSearchApplication>();
  for (const application of firstPage.applications) byReference.set(application.externalReference, application);
  for (const pageUrl of firstPage.pageUrls.slice(0, Math.max(0, maxPages - 1))) {
    const pageResponse = await request("load-results-page", pageUrl, {
      headers: {
        "x-requested-with": "XMLHttpRequest",
        referer: current.url
      },
      cache: "no-store"
    });
    if (!pageResponse.ok) {
      throw await masterGovHttpRejectionError(
        source,
        "load-results-page",
        pageUrl,
        pageResponse,
        sensitiveValues()
      );
    }
    const pageHtml = await readText("read-results-page", pageResponse);
    const parsedPage = parseMasterGovSearchResultsHtml(pageHtml, baseUrl);
    if (!parsedPage.recognized) {
      throw new Error(
        `${source.councilName} MasterGov results page did not contain recognizable search results ` +
        `(portal=${source.councilSlug}, host=${new URL(baseUrl).hostname})`
      );
    }
    if ((parsedPage.resultCount ?? 0) > 0 && parsedPage.applications.length === 0) {
      throw new Error(
        `${source.councilName} MasterGov results page reported ${parsedPage.resultCount} results but yielded no parseable applications ` +
        `(portal=${source.councilSlug}, host=${new URL(baseUrl).hostname})`
      );
    }
    for (const application of parsedPage.applications) {
      if (!byReference.has(application.externalReference)) byReference.set(application.externalReference, application);
    }
  }

  const rows = [...byReference.values()];
  if (firstPage.resultCount !== null && rows.length !== firstPage.resultCount) {
    throw new Error(
      `${source.councilName} MasterGov total mismatch: advertised ${firstPage.resultCount}, retrieved ${rows.length} ` +
      `(portal=${source.councilSlug}, host=${new URL(baseUrl).hostname})`
    );
  }
  if (!enrichDetails) return rows;
  const enriched = new Array<NormalisedPlanningApplication>(rows.length);
  let nextIndex = 0;
  const partialApplication = (application: MasterGovSearchApplication, failure: unknown) => ({
    ...application,
    rawPayload: {
      ...application.rawPayload,
      enrichmentError: diagnosticText(
        failure instanceof Error ? failure.message : failure,
        sensitiveValues()
      )
    }
  });

  const enrichWorker = async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= rows.length) return;
      const application = rows[index];
      try {
        const detailResponse = await request("load-detail", application.sourceUrl!, {
          headers: { referer: current.url },
          cache: "no-store"
        });
        if (!detailResponse.ok) {
          throw await masterGovHttpRejectionError(
            source,
            "load-detail",
            application.sourceUrl!,
            detailResponse,
            sensitiveValues()
          );
        }
        const detailHtml = await readText("read-detail", detailResponse);
        const parsed = parseMasterGovApplicationHtml({
          detailHtml,
          sourceUrl: application.sourceUrl!,
          fallback: application
        });
        if (!parsed) {
          throw new Error(
            `${source.councilName} MasterGov load-detail returned unrecognizable detail HTML ` +
            `(portal=${source.councilSlug}, host=${new URL(baseUrl).hostname})`
          );
        }
        enriched[index] = parsed;
      } catch (failure) {
        enriched[index] = partialApplication(application, failure);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(detailConcurrency, rows.length) }, () => enrichWorker())
  );
  return enriched;
}
