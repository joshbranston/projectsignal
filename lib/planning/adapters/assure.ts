import { load, type Cheerio, type CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";
import { extractPostcode } from "../../scoring.ts";
import type { NormalisedPlanningApplication, PlanningSourceRecord } from "../types.ts";

const ASSURE_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

type AssureSearchApplication = NormalisedPlanningApplication & {
  rawPayload: { search: Record<string, string> };
};

export type AssureSearchResults = {
  applications: AssureSearchApplication[];
  resultCount: number | null;
  recognized: boolean;
  paginationUrl: string | null;
  pageIndexes: string[];
  currentPageIndex: string | null;
};

export type AssureWeeklySearchRequest = {
  weeklyViewUrl: string;
  searchUrl: string;
  body: URLSearchParams;
  sensitiveValues: string[];
  formHtml: string;
};

function nullable(value: string | null | undefined) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text || /^(?:not available|blank field|n\/?a|null|none|-+)$/i.test(text)) return null;
  return text;
}

function isoDate(value: string | null | undefined) {
  const text = nullable(value);
  if (!text) return null;
  const numeric = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
  if (numeric) {
    return `${numeric[3]}-${numeric[2].padStart(2, "0")}-${numeric[1].padStart(2, "0")}`;
  }
  const named = text.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (!named) return null;
  const month = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december"
  ].indexOf(named[2].toLowerCase());
  return month < 0
    ? null
    : `${named[3]}-${String(month + 1).padStart(2, "0")}-${named[1].padStart(2, "0")}`;
}

function sameOriginUrl(value: string | null | undefined, baseUrl: string) {
  if (!value) return null;
  try {
    const base = new URL(baseUrl);
    const resolved = new URL(value, base);
    return resolved.origin === base.origin ? resolved.toString() : null;
  } catch {
    return null;
  }
}

function requiredSameOriginUrl(
  value: string | null | undefined,
  baseUrl: string,
  description: string
) {
  const url = sameOriginUrl(value, baseUrl);
  if (!url) throw new Error(`ASSURE ${description} is missing or cross-origin`);
  return url;
}

function setNamedControl(
  $: CheerioAPI,
  form: Cheerio<AnyNode>,
  name: string,
  value: string
) {
  const controls = form.find(`[name="${name}"]`);
  if (!controls.length) throw new Error(`ASSURE form did not provide ${name}`);
  const first = controls.first();
  if (first.is("select")) {
    first.find("option").removeAttr("selected");
    const option = first.find("option").filter((_, element) => $(element).attr("value") === value).first();
    if (!option.length) throw new Error(`ASSURE form did not provide ${name}=${value}`);
    option.attr("selected", "selected");
    return;
  }
  if (first.is("textarea")) {
    first.text(value);
    return;
  }
  const type = (first.attr("type") ?? "text").toLowerCase();
  if (type === "radio" || type === "checkbox") {
    controls.removeAttr("checked");
    const selected = controls.filter((_, element) => $(element).attr("value") === value).first();
    if (!selected.length) throw new Error(`ASSURE form did not provide ${name}=${value}`);
    selected.attr("checked", "checked");
    return;
  }
  first.attr("value", value);
}

function serializeSuccessfulControls($: CheerioAPI, form: Cheerio<AnyNode>) {
  const body = new URLSearchParams();
  form.find("input, select, textarea, button").each((_, element) => {
    const control = $(element);
    const name = control.attr("name");
    const ancestors = control.parents().toArray();
    const disabledByFieldset = control.parents("fieldset[disabled]").toArray().some((fieldset) => {
      const firstLegend = $(fieldset).children("legend").first();
      return !firstLegend.length || !ancestors.includes(firstLegend[0]);
    });
    if (
      !name ||
      control.attr("disabled") !== undefined ||
      disabledByFieldset ||
      control.is("button")
    ) return;

    if (control.is("input")) {
      const type = (control.attr("type") ?? "text").toLowerCase();
      if (["button", "submit", "reset", "file", "image"].includes(type)) return;
      if (["checkbox", "radio"].includes(type) && control.attr("checked") === undefined) return;
      body.append(
        name,
        control.attr("value") ?? (["checkbox", "radio"].includes(type) ? "on" : "")
      );
      return;
    }

    if (control.is("textarea")) {
      body.append(name, control.text().replace(/\r\n|\r|\n/g, "\r\n"));
      return;
    }

    const enabledOptions = control.find("option").filter((_, option) => {
      const item = $(option);
      return item.attr("disabled") === undefined && item.parent("optgroup[disabled]").length === 0;
    });
    let selected = enabledOptions.filter((_, option) => $(option).attr("selected") !== undefined);
    if (!selected.length && control.attr("multiple") === undefined) selected = enabledOptions.first();
    selected.each((_, option) => body.append(name, $(option).attr("value") ?? $(option).text()));
  });
  return body;
}

export function buildAssureWeeklySearchRequest(input: {
  searchHtml: string;
  weeklyHtml: string;
  pageUrl: string;
  fromDate: string;
  toDate: string;
  status: string;
}): AssureWeeklySearchRequest {
  const $ = load(input.searchHtml);
  const form = $("#frmOnlinePlanningSearch").first();
  if (!form.length) throw new Error("ASSURE search page did not provide frmOnlinePlanningSearch");

  const weeklyViewUrl = new URL(
    requiredSameOriginUrl(
      form.find("[name='urlOnlinePlanningWeeklyMonthlySearchView']").first().attr("value"),
      input.pageUrl,
      "weekly-view URL"
    )
  );
  weeklyViewUrl.searchParams.set("isWeeklySearch", "true");
  weeklyViewUrl.searchParams.set("searchFor", "PlanningApplications");
  const searchUrl = requiredSameOriginUrl(
    form.find("[name='urlOnlinePlanningWeeklyMonthlyGoSearch']").first().attr("value"),
    input.pageUrl,
    "weekly-search URL"
  );

  const criteria = form
    .find("#divOnlinePlanningSearchView, #divOnlinePlanningSearchCriteria")
    .first();
  if (!criteria.length) throw new Error("ASSURE search form did not provide its weekly-view container");
  criteria.html(input.weeklyHtml);
  setNamedControl($, form, "SearchFor", "PlanningApplications");
  setNamedControl($, form, "IsWeeklyListSearch", "true");
  setNamedControl($, form, "IsMonthlyListSearch", "false");
  setNamedControl($, form, "SelectedWeek", "0");
  setNamedControl($, form, "WeeklyFromDate", input.fromDate);
  setNamedControl($, form, "WeeklyToDate", input.toDate);
  setNamedControl($, form, "WeeklyListStatus", input.status);

  const body = serializeSuccessfulControls($, form);
  const sensitiveValues = form
    .find("input[type='hidden']")
    .map((_, element) => $(element).attr("value") ?? "")
    .get()
    .filter(Boolean);
  return {
    weeklyViewUrl: weeklyViewUrl.toString(),
    searchUrl,
    body,
    sensitiveValues,
    formHtml: $.html(form)
  };
}

function setCookieHeaders(response: Response) {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const values = headers.getSetCookie?.() ?? [];
  if (values.length) return values.flatMap((value) => value.split(/,(?=\s*[^;,=]+=[^;,]*)/));
  const combined = response.headers.get("set-cookie");
  return combined ? combined.split(/,(?=\s*[^;,=]+=[^;,]*)/) : [];
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
    parts.push(`${code ? `${name}[${code}]` : name}${message ? `: ${message}` : ""}`);
    current = record.cause;
  }
  return parts.join("; cause=") || "Unknown transport error";
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

function assureTransportError(
  source: PlanningSourceRecord,
  operation: string,
  failure: unknown,
  redactedValues: string[]
) {
  const hostname = new URL(source.endpointUrl).hostname;
  return new Error(
    `${source.councilName} ASSURE ${operation} failed ` +
      `(portal=${source.councilSlug}, host=${hostname}): ${transportErrorSummary(failure, redactedValues)}`,
    { cause: sanitizedErrorCause(failure, redactedValues) }
  );
}

function responseBodyClue(body: string, redactedValues: string[]) {
  const $ = load(body);
  const clues: string[] = [];
  for (const [label, selector] of [["title", "title"], ["h1", "h1"]] as const) {
    const value = diagnosticText($(selector).first().text(), redactedValues).slice(0, 120);
    if (value) clues.push(`${label}=${value}`);
  }
  return clues.join("; ") || `body=${body.trim() ? "non-empty" : "empty"}`;
}

function responseContentTypeClue(value: string | null) {
  const mime = value?.split(";", 1)[0]?.trim().toLowerCase();
  if (!mime) return "unknown";
  return ["text/html", "text/plain", "application/json", "application/xml", "text/xml"]
    .includes(mime)
    ? mime
    : "other";
}

async function assureHttpRejectionError(
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
  const clue = bodyFailure
    ? `body=unreadable (${transportErrorSummary(bodyFailure, redactedValues)})`
    : responseBodyClue(body, redactedValues);
  return new Error(
    `${source.councilName} ASSURE ${operation} rejected ` +
      `(portal=${source.councilSlug}, host=${hostname}, status=${response.status}, ` +
      `content-type=${responseContentTypeClue(response.headers.get("content-type"))}, ` +
      `status-text=${diagnosticText(response.statusText || "unknown", redactedValues)}, clue=${clue})`,
    bodyFailure ? { cause: sanitizedErrorCause(bodyFailure, redactedValues) } : undefined
  );
}

class AssureCookieJar {
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

function formatUkDate(date: Date) {
  return `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${date.getUTCFullYear()}`;
}

function boundedPositiveInteger(value: unknown, fallback: number, maximum: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(1, Math.min(Math.trunc(numeric), maximum));
}

function weeklyViewUrl(searchHtml: string, pageUrl: string) {
  const $ = load(searchHtml);
  const form = $("#frmOnlinePlanningSearch").first();
  if (!form.length) throw new Error("ASSURE search page did not provide frmOnlinePlanningSearch");
  const url = new URL(requiredSameOriginUrl(
    form.find("[name='urlOnlinePlanningWeeklyMonthlySearchView']").first().attr("value"),
    pageUrl,
    "weekly-view URL"
  ));
  url.searchParams.set("isWeeklySearch", "true");
  url.searchParams.set("searchFor", "PlanningApplications");
  return url.toString();
}

function buildPaginationBody(formHtml: string, resultsHtml: string, pageIndex: string) {
  const $ = load(formHtml);
  const form = $("#frmOnlinePlanningSearch").first();
  if (!form.length) throw new Error("ASSURE pagination state did not provide its search form");
  const results = form.find("#divWeeklyMonthlySearchResultsForSorting, #divOnlinePlanningSearchResults").first();
  if (!results.length) throw new Error("ASSURE pagination state did not provide its results container");
  results.html(resultsHtml);
  const pageName = form.find("[name='PagingParameters.CurrentPageIndex']").length
    ? "PagingParameters.CurrentPageIndex"
    : "PagingParameters_CurrentPageIndex";
  setNamedControl($, form, pageName, pageIndex);
  setNamedControl($, form, "IsPaginationClicked", "true");
  return serializeSuccessfulControls($, form);
}

export type AssureFetchOptions = {
  now?: Date;
  lookbackDays?: number;
  maxPages?: number;
  requestTimeoutMs?: number;
  detailConcurrency?: number;
  enrichDetails?: boolean;
};

export async function fetchAssureApplications(
  source: PlanningSourceRecord,
  options: AssureFetchOptions = {}
): Promise<NormalisedPlanningApplication[]> {
  const portalOrigin = new URL(source.endpointUrl).origin;
  const now = options.now ?? new Date();
  const lookbackDays = boundedPositiveInteger(
    options.lookbackDays ?? source.config.lookbackDays,
    7,
    31
  );
  const maxPages = boundedPositiveInteger(options.maxPages ?? source.config.maxPages, 10, 25);
  const requestTimeoutMs = boundedPositiveInteger(options.requestTimeoutMs, 15_000, 30_000);
  const detailConcurrency = boundedPositiveInteger(options.detailConcurrency, 4, 5);
  const enrichDetails = options.enrichDetails ?? source.config.enrichDetails ?? true;
  const fromDate = formatUkDate(new Date(now.getTime() - lookbackDays * 86_400_000));
  const toDate = formatUkDate(now);
  const commonHeaders = {
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "en-GB,en;q=0.9",
    ...(source.config.requestHeaders ?? {}),
    "user-agent": ASSURE_USER_AGENT
  };
  const jar = new AssureCookieJar();
  const persistentSecrets: string[] = [];
  const sensitiveValues = (extra: string[] = []) => [
    ...requestHeaderValues(commonHeaders),
    ...jar.sensitiveValues(),
    ...persistentSecrets,
    ...extra
  ];

  const request = async (
    operation: string,
    url: string,
    init: RequestInit = {},
    extraSecrets: string[] = []
  ) => {
    const resolved = new URL(url, source.endpointUrl);
    if (resolved.origin !== portalOrigin) throw new Error("ASSURE request URL is cross-origin");
    const headers = new Headers(commonHeaders);
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    const cookie = jar.header();
    if (cookie) headers.set("cookie", cookie);
    try {
      const response = await fetch(resolved, {
        ...init,
        headers,
        redirect: "manual",
        signal: init.signal ?? AbortSignal.timeout(requestTimeoutMs)
      });
      jar.add(response);
      return response;
    } catch (failure) {
      throw assureTransportError(source, `${operation} request`, failure, sensitiveValues(extraSecrets));
    }
  };

  const readText = async (
    operation: string,
    response: Response,
    extraSecrets: string[] = []
  ) => {
    try {
      return await response.text();
    } catch (failure) {
      throw assureTransportError(
        source,
        `${operation} response`,
        failure,
        sensitiveValues(extraSecrets)
      );
    }
  };

  const isRedirect = (response: Response) => [301, 302, 303, 307, 308].includes(response.status);
  const followRedirects = async (
    operation: string,
    initialUrl: string,
    initialResponse: Response,
    initialInit: RequestInit,
    extraSecrets: string[] = []
  ) => {
    let currentUrl = initialUrl;
    let response = initialResponse;
    let currentInit = initialInit;
    for (let redirects = 0; isRedirect(response); redirects += 1) {
      if (redirects >= 8) {
        throw new Error(`${source.councilName} ASSURE ${operation} exceeded redirect limit`);
      }
      const location = response.headers.get("location");
      if (!location) {
        throw new Error(`${source.councilName} ASSURE ${operation} redirect omitted Location`);
      }
      const next = new URL(location, currentUrl);
      if (next.origin !== portalOrigin) {
        throw new Error(`${source.councilName} ASSURE redirect is cross-origin`);
      }
      const method = String(currentInit.method ?? "GET").toUpperCase();
      const rewriteToGet =
        (response.status === 303 && method !== "HEAD") ||
        ([301, 302].includes(response.status) && method === "POST");
      const headers = new Headers(currentInit.headers);
      headers.set("referer", currentUrl);
      if (rewriteToGet) {
        headers.delete("content-type");
        headers.delete("origin");
      }
      const nextInit: RequestInit = {
        ...currentInit,
        headers,
        ...(rewriteToGet ? { method: "GET", body: undefined } : {})
      };
      response = await request(operation, next.toString(), nextInit, extraSecrets);
      currentUrl = next.toString();
      currentInit = nextInit;
    }
    return { response, url: currentUrl };
  };

  const openSearchInit = { cache: "no-store" } satisfies RequestInit;
  const openedSearch = await request("open-search-page", source.endpointUrl, openSearchInit);
  const initial = await followRedirects(
    "open-search-page",
    source.endpointUrl,
    openedSearch,
    openSearchInit
  );
  if (!initial.response.ok) {
    throw await assureHttpRejectionError(
      source,
      "open-search-page",
      initial.url,
      initial.response,
      sensitiveValues()
    );
  }
  const searchHtml = await readText("read-search-page", initial.response);
  const searchPageUrl = initial.url;
  let viewUrl: string;
  try {
    viewUrl = weeklyViewUrl(searchHtml, searchPageUrl);
  } catch (failure) {
    throw new Error(
      `${source.councilName} ASSURE search page did not contain a recognizable form ` +
        `(portal=${source.councilSlug}, host=${new URL(searchPageUrl).hostname}, ` +
        `clue=${responseBodyClue(searchHtml, sensitiveValues())})`,
      { cause: sanitizedErrorCause(failure, sensitiveValues()) }
    );
  }
  const weeklyViewInit = {
    headers: { referer: searchPageUrl, "x-requested-with": "XMLHttpRequest" },
    cache: "no-store"
  } satisfies RequestInit;
  const openedView = await request("load-weekly-view", viewUrl, weeklyViewInit);
  const view = await followRedirects(
    "load-weekly-view",
    viewUrl,
    openedView,
    weeklyViewInit
  );
  if (!view.response.ok) {
    throw await assureHttpRejectionError(
      source,
      "load-weekly-view",
      view.url,
      view.response,
      sensitiveValues()
    );
  }
  const weeklyHtml = await readText("read-weekly-view", view.response);
  const prepared = buildAssureWeeklySearchRequest({
    searchHtml,
    weeklyHtml,
    pageUrl: searchPageUrl,
    fromDate,
    toDate,
    status: "ValidatedThisWeek"
  });
  persistentSecrets.push(...prepared.sensitiveValues);
  const searchInit = {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      origin: portalOrigin,
      referer: searchPageUrl,
      "x-requested-with": "XMLHttpRequest"
    },
    body: prepared.body,
    cache: "no-store"
  } satisfies RequestInit;
  const searchResponse = await request(
    "submit-weekly-search",
    prepared.searchUrl,
    searchInit,
    prepared.sensitiveValues
  );
  const submittedSearch = await followRedirects(
    "submit-weekly-search",
    prepared.searchUrl,
    searchResponse,
    searchInit,
    prepared.sensitiveValues
  );
  if (!submittedSearch.response.ok) {
    throw await assureHttpRejectionError(
      source,
      "submit-weekly-search",
      submittedSearch.url,
      submittedSearch.response,
      sensitiveValues(prepared.sensitiveValues)
    );
  }
  const resultsHtml = await readText(
    "read-weekly-search",
    submittedSearch.response,
    prepared.sensitiveValues
  );
  const parsed = parseAssureSearchResultsHtml(resultsHtml, submittedSearch.url);
  if (!parsed.recognized) {
    throw new Error(`${source.councilName} ASSURE search response was not recognizable`);
  }
  if ((parsed.resultCount ?? 0) > 0 && parsed.applications.length === 0) {
    throw new Error(
      `${source.councilName} ASSURE search response reported ${parsed.resultCount} results but yielded no parseable applications`
    );
  }
  if (
    parsed.resultCount !== null &&
    parsed.resultCount > parsed.applications.length &&
    !parsed.paginationUrl
  ) {
    throw new Error(
      `${source.councilName} ASSURE search response reported ${parsed.resultCount} results but ` +
        `page one yielded ${parsed.applications.length} and no usable pagination route`
    );
  }
  const byReference = new Map<string, AssureSearchApplication>();
  for (const application of parsed.applications) byReference.set(application.externalReference, application);
  const seenPageIndexes = new Set<string>([parsed.currentPageIndex ?? "0"]);
  const queuedPageIndexes = parsed.pageIndexes.filter((index) => !seenPageIndexes.has(index));
  let paginationUrl = parsed.paginationUrl;
  let paginationStateHtml = resultsHtml;
  let pagesLoaded = 1;

  while (paginationUrl && queuedPageIndexes.length && pagesLoaded < maxPages) {
    const pageIndex = queuedPageIndexes.shift()!;
    if (seenPageIndexes.has(pageIndex)) continue;
    seenPageIndexes.add(pageIndex);
    const pageInit = {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        origin: portalOrigin,
        referer: searchPageUrl,
        "x-requested-with": "XMLHttpRequest"
      },
      body: buildPaginationBody(prepared.formHtml, paginationStateHtml, pageIndex),
      cache: "no-store"
    } satisfies RequestInit;
    const pageResponse = await request("load-results-page", paginationUrl, pageInit);
    const loadedPage = await followRedirects(
      "load-results-page",
      paginationUrl,
      pageResponse,
      pageInit
    );
    if (!loadedPage.response.ok) {
      throw await assureHttpRejectionError(
        source,
        "load-results-page",
        loadedPage.url,
        loadedPage.response,
        sensitiveValues()
      );
    }
    const pageHtml = await readText("read-results-page", loadedPage.response);
    const page = parseAssureSearchResultsHtml(pageHtml, loadedPage.url);
    if (!page.recognized) throw new Error(`${source.councilName} ASSURE results page was not recognizable`);
    if ((page.resultCount ?? 0) > 0 && page.applications.length === 0) {
      throw new Error(
        `${source.councilName} ASSURE results page reported ${page.resultCount} results but yielded no parseable applications`
      );
    }
    for (const application of page.applications) {
      if (!byReference.has(application.externalReference)) {
        byReference.set(application.externalReference, application);
      }
    }
    for (const index of page.pageIndexes) {
      if (!seenPageIndexes.has(index) && !queuedPageIndexes.includes(index)) queuedPageIndexes.push(index);
    }
    paginationUrl = page.paginationUrl ?? paginationUrl;
    paginationStateHtml = pageHtml;
    pagesLoaded += 1;
  }

  const rows = [...byReference.values()];
  if (!enrichDetails || rows.length === 0) return rows;
  const enriched = new Array<NormalisedPlanningApplication>(rows.length);
  let nextIndex = 0;

  const enrichWorker = async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= rows.length) return;
      const application = rows[index];
      try {
        const detailInit = {
          headers: { referer: searchPageUrl },
          cache: "no-store"
        } satisfies RequestInit;
        const detailResponse = await request("load-detail", application.sourceUrl!, detailInit);
        const loadedDetail = await followRedirects(
          "load-detail",
          application.sourceUrl!,
          detailResponse,
          detailInit
        );
        if (!loadedDetail.response.ok) {
          throw await assureHttpRejectionError(
            source,
            "load-detail",
            loadedDetail.url,
            loadedDetail.response,
            sensitiveValues()
          );
        }
        const detailHtml = await readText("read-detail", loadedDetail.response);
        const parsedDetail = parseAssureApplicationHtml({
          detailHtml,
          sourceUrl: application.sourceUrl!,
          fallback: application
        });
        if (!parsedDetail) {
          throw new Error(`${source.councilName} ASSURE load-detail returned unrecognizable detail HTML`);
        }
        enriched[index] = parsedDetail;
      } catch (failure) {
        enriched[index] = {
          ...application,
          rawPayload: {
            ...application.rawPayload,
            enrichmentError: diagnosticText(
              failure instanceof Error ? failure.message : failure,
              sensitiveValues()
            )
          }
        };
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(detailConcurrency, rows.length) }, () => enrichWorker())
  );
  return enriched;
}

function labelValues($: CheerioAPI, root: Cheerio<AnyNode>) {
  const values: Record<string, string> = {};
  root.find(".govuk-summary-list__row, tr").each((_, element) => {
    const row = $(element);
    const heading = row.find("dt, th").first();
    const cells = row.children("td");
    const label = nullable(heading.length ? heading.text() : cells.eq(0).text());
    const value = nullable(
      heading.length ? row.find("dd, td").first().text() : cells.eq(1).text()
    );
    if (label && value) values[label.replace(/\s*:\s*$/, "")] = value;
  });
  root.find("dt").each((_, element) => {
    const label = nullable($(element).text());
    const value = nullable($(element).next("dd").text());
    if (label && value) values[label.replace(/\s*:\s*$/, "")] = value;
  });
  return values;
}

function resultTableValues($: CheerioAPI, row: Cheerio<AnyNode>) {
  const values: Record<string, string> = {};
  const cells = row.children("td");
  const headings = row.closest("table").find("thead th");
  if (!cells.length || headings.length !== cells.length) return values;
  cells.each((index, element) => {
    const heading = nullable(headings.eq(index).text());
    if (!heading) return;
    const cell = $(element).clone();
    cell.find("a[href='#']").remove();
    values[heading.replace(/\s*:\s*$/, "")] = nullable(cell.text()) ?? "";
  });
  return values;
}

function valueFor(values: Record<string, string>, ...labels: string[]) {
  const normalized = new Map(
    Object.entries(values).map(([key, value]) => [key.toLowerCase(), value])
  );
  for (const label of labels) {
    const value = normalized.get(label.toLowerCase());
    if (value !== undefined) return value;
  }
  return undefined;
}

export function parseAssureApplicationHtml(input: {
  detailHtml: string;
  sourceUrl: string;
  fallback: AssureSearchApplication;
}): NormalisedPlanningApplication | null {
  const $ = load(input.detailHtml);
  const details = labelValues($, $.root());
  const detailReference =
    nullable(valueFor(details, "Application Reference", "Application Number", "Reference")) ??
    nullable($("#spnApplicationId").first().text()) ??
    nullable($("#applicationReference").first().attr("value"));
  if (!detailReference) return null;
  const normalizeReference = (value: string) => value.replace(/\s+/g, "").toUpperCase();
  if (normalizeReference(detailReference) !== normalizeReference(input.fallback.externalReference)) {
    return null;
  }
  const proposal = nullable(valueFor(details, "Description", "Proposal")) ?? input.fallback.proposal;
  if (!proposal) return null;
  const address = nullable(valueFor(details, "Address", "Location")) ?? input.fallback.address;
  return {
    externalReference: input.fallback.externalReference,
    address,
    postcode: address ? extractPostcode(address) || null : null,
    latitude: null,
    longitude: null,
    proposal,
    applicationType:
      nullable(valueFor(details, "Development Type", "Application Type")) ??
      input.fallback.applicationType,
    stage: nullable(valueFor(details, "Status")) ?? input.fallback.stage,
    submittedAt:
      isoDate(valueFor(details, "Date Received", "Received Date", "Application Received Date", "Received")) ??
      input.fallback.submittedAt,
    validatedAt:
      isoDate(valueFor(details, "Date Validated", "Validated Date", "Validated", "Date Registered", "Registered")) ??
      input.fallback.validatedAt,
    decisionAt:
      isoDate(valueFor(details, "Decision Date", "Date Decision")) ?? input.fallback.decisionAt,
    decision: nullable(valueFor(details, "Decision")) ?? input.fallback.decision,
    applicantName: nullable(valueFor(details, "Applicant Name", "Applicant")),
    agentName: nullable(valueFor(details, "Agent Name", "Agent", "Agent/Company")),
    agentContact: nullable(
      valueFor(details, "Agent Address", "Agent Email", "Agent Telephone", "Agent Phone")
    ),
    sourceUrl: input.sourceUrl,
    rawPayload: { search: input.fallback.rawPayload.search, details }
  };
}

export function parseAssureSearchResultsHtml(
  html: string,
  baseUrl: string
): AssureSearchResults {
  const $ = load(html);
  const applications: AssureSearchApplication[] = [];
  const seen = new Set<string>();

  $("[data-redirect-url*='OnlinePlanningOverview'], a[href*='OnlinePlanningOverview']")
    .each((_, element) => {
      const link = $(element);
      const sourceUrl = sameOriginUrl(link.attr("data-redirect-url") ?? link.attr("href"), baseUrl);
      if (!sourceUrl) return;
      const container = link.closest("article, li, tr, .assure-search-result, .govuk-summary-card");
      const root = container.length ? container : link.parent();
      const tableValues = root.is("tr") ? resultTableValues($, root) : {};
      const search = Object.keys(tableValues).length ? tableValues : labelValues($, root);
      const externalReference = nullable(
        valueFor(
          search,
          "Application Reference",
          "Application Number",
          "Reference",
          "Reference No.",
          "Reference No"
        )
      );
      const proposal = nullable(valueFor(search, "Description", "Proposal"));
      if (!externalReference || !proposal || seen.has(externalReference)) return;
      seen.add(externalReference);
      const address = nullable(valueFor(search, "Address", "Location"));
      applications.push({
        externalReference,
        address,
        postcode: address ? extractPostcode(address) || null : null,
        latitude: null,
        longitude: null,
        proposal,
        applicationType: nullable(
          valueFor(search, "Development Type", "Development type", "Application Type")
        ),
        stage: nullable(valueFor(search, "Status")),
        submittedAt: isoDate(valueFor(search, "Date Received", "Received Date")),
        validatedAt: isoDate(
          valueFor(search, "Date Registered", "Registration Date", "Registered Date", "Date Validated")
        ),
        decisionAt: isoDate(valueFor(search, "Decision Date", "Date Decision")),
        decision: nullable(valueFor(search, "Decision")),
        applicantName: null,
        agentName: null,
        agentContact: null,
        sourceUrl,
        rawPayload: { search }
      });
    });

  const text = load(html.replace(/></g, "> <")).root().text().replace(/\s+/g, " ").trim();
  const resultCountMatch =
    text.match(/\bTotal\s+record\(s\)\s*:\s*(\d[\d,]*)\b/i) ??
    text.match(/\b(\d[\d,]*)\s+Results?\b/i);
  const resultCount = resultCountMatch ? Number(resultCountMatch[1].replace(/,/g, "")) : null;
  const pagination = $("#generalSearchPagination").first();
  const paginationUrl = sameOriginUrl(pagination.attr("data-url"), baseUrl);
  const pageIndexes: string[] = [];
  pagination.find("[onclick*='PagingClick']").each((_, element) => {
    const index = $(element).attr("onclick")?.match(/PagingClick\(\s*['\"]?(\d+)/i)?.[1];
    if (index !== undefined && !pageIndexes.includes(index)) pageIndexes.push(index);
  });

  return {
    applications,
    resultCount,
    recognized:
      applications.length > 0 ||
      resultCount !== null ||
      $("#divSearchList, #divWeeklyMonthlySearchResultsForSorting").length > 0,
    paginationUrl,
    pageIndexes,
    currentPageIndex: nullable(
      pagination
        .find("[name='PagingParameters.CurrentPageIndex'], [name='PagingParameters_CurrentPageIndex']")
        .first()
        .attr("value")
    )
  };
}
