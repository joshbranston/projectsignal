import { extractPostcode } from "../../scoring.ts";
import type { NormalisedPlanningApplication, PlanningSourceRecord } from "../types.ts";

type FetchOptions = {
  now?: Date;
  lookbackDays?: number;
  maxPages?: number;
  requestTimeoutMs?: number;
  detailConcurrency?: number;
  enrichDetails?: boolean;
};

type JsonRecord = Record<string, unknown>;

const DEFAULT_LOOKBACK_DAYS = 7;
const MAX_LOOKBACK_DAYS = 31;
const DEFAULT_MAX_PAGES = 10;
const MAX_PAGES = 25;
const DEFAULT_PAGE_SIZE = 10;
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_DETAIL_CONCURRENCY = 4;
const MAX_DETAIL_CONCURRENCY = 5;
const MAX_REDIRECTS = 5;

class DetailReferenceMismatchError extends Error {}

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isoDate(value: unknown) {
  const input = text(value);
  if (!input) return null;
  const match = input.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function normalizeReference(value: string) {
  return value.replace(/\s+/g, "").toUpperCase();
}

function boundedInteger(value: unknown, fallback: number, maximum: number, label: string) {
  const numeric = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > maximum) {
    throw new Error(`StatMap ${label} must be between 1 and ${maximum}`);
  }
  return numeric;
}

function portalUrls(endpoint: string) {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("StatMap endpoint must be a valid HTTPS URL");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("StatMap endpoint must be a valid HTTPS URL without credentials");
  }
  const match = url.pathname.match(/^(.*?\/horizoNext)(?:\/publicportal)?\/?$/i);
  if (!match) throw new Error("StatMap endpoint must identify a HorizoNext public portal");
  const appPath = match[1].replace(/\/$/, "");
  return {
    origin: url.origin,
    searchUrl: new URL(`${appPath}/api/publicportal/planningApplications/pageRequest`, url.origin).toString(),
    detailApiUrl: (id: string) => new URL(`${appPath}/api/publicportal/planningApplications/${encodeURIComponent(id)}`, url.origin).toString(),
    detailPageUrl: (id: string) => new URL(`${appPath}/publicportal/planningapplications/${encodeURIComponent(id)}`, url.origin).toString()
  };
}

function requestHeaderValues(headers?: HeadersInit) {
  if (!headers) return [];
  try { return Array.from(new Headers(headers).values()).filter(Boolean); } catch { return []; }
}

function redactionFragments(values: string[]) {
  const fragments = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    fragments.add(value);
    const auth = value.match(/^(?:basic|bearer)\s+(.+)$/i)?.[1];
    if (auth) fragments.add(auth);
  }
  return [...fragments].sort((left, right) => right.length - left.length);
}

function diagnosticText(value: unknown, redacted: string[]) {
  let output = String(value ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  for (const secret of redactionFragments(redacted)) output = output.split(secret).join("[REDACTED]");
  return output
    .replace(/\b(?:authorization|cookie|set-cookie|x-api-key|api-key)\s*[:=][^\r\n]*/gi, "[REDACTED]")
    .slice(0, 300);
}

function transportSummary(failure: unknown, redacted: string[]) {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = failure;
  while (current != null && parts.length < 5 && !seen.has(current)) {
    seen.add(current);
    if (typeof current !== "object") {
      parts.push(diagnosticText(current, redacted));
      break;
    }
    const item = current as JsonRecord;
    const name = diagnosticText(item.name ?? "Error", redacted);
    const code = item.code ? `[${diagnosticText(item.code, redacted)}]` : "";
    const message = item.message ? `: ${diagnosticText(item.message, redacted)}` : "";
    parts.push(`${name}${code}${message}`);
    current = item.cause;
  }
  return parts.join("; cause=") || "Unknown transport error";
}

function sanitizedCause(failure: unknown, redacted: string[], depth = 0, seen = new Set<unknown>()): Error | undefined {
  if (failure == null || depth >= 5 || seen.has(failure)) return undefined;
  if (typeof failure !== "object") return new Error(diagnosticText(failure, redacted));
  seen.add(failure);
  const item = failure as JsonRecord;
  const nested = sanitizedCause(item.cause, redacted, depth + 1, seen);
  const safe = new Error(diagnosticText(item.message ?? "Transport error", redacted), nested ? { cause: nested } : undefined) as Error & { code?: string };
  safe.name = diagnosticText(item.name ?? "Error", redacted);
  if (item.code) safe.code = diagnosticText(item.code, redacted);
  return safe;
}

function transportError(source: PlanningSourceRecord, operation: string, hostname: string, failure: unknown, redacted: string[]) {
  const values = [...requestHeaderValues(source.config.requestHeaders), ...redacted];
  return new Error(
    `${source.councilName} StatMap ${operation} request failed (portal=${source.councilSlug}, host=${hostname}): ${transportSummary(failure, values)}`,
    { cause: sanitizedCause(failure, values) }
  );
}

function rejectionError(source: PlanningSourceRecord, operation: string, requestUrl: string, response: Response, redacted: string[]) {
  let hostname = new URL(requestUrl).hostname;
  try { hostname = new URL(response.url || requestUrl).hostname; } catch { /* keep request host */ }
  const contentType = diagnosticText(response.headers.get("content-type") ?? "unknown", redacted);
  return new Error(
    `${source.councilName} StatMap ${operation} rejected (portal=${source.councilSlug}, host=${hostname}, status=${response.status}, content-type=${contentType}, body=${response.headers.get("content-length") === "0" ? "empty" : "not-read"})`
  );
}

async function safeFetch(
  source: PlanningSourceRecord,
  operation: string,
  initialUrl: string,
  init: RequestInit,
  origin: string,
  timeoutMs: number,
  redacted: string[] = []
) {
  let url = initialUrl;
  let request = { ...init };
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    let response: Response;
    try {
      response = await fetch(url, { ...request, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
    } catch (failure) {
      throw transportError(source, operation, new URL(url).hostname, failure, redacted);
    }
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      if (!response.ok) throw rejectionError(source, operation, url, response, redacted);
      return response;
    }
    if (redirects === MAX_REDIRECTS) throw new Error(`${source.councilName} StatMap ${operation} exceeded ${MAX_REDIRECTS} redirects`);
    const location = response.headers.get("location");
    if (!location) throw new Error(`${source.councilName} StatMap ${operation} redirect is missing a location`);
    const next = new URL(location, url);
    if (next.origin !== origin) throw new Error(`${source.councilName} StatMap ${operation} cross-origin redirect rejected`);
    if ([301, 302, 303].includes(response.status) && String(request.method ?? "GET").toUpperCase() !== "GET") {
      const headers = new Headers(request.headers);
      headers.delete("content-type");
      request = { ...request, method: "GET", body: undefined, headers };
    }
    url = next.toString();
  }
  throw new Error("Unreachable StatMap redirect state");
}

async function jsonResponse(source: PlanningSourceRecord, operation: string, response: Response, redacted: string[]) {
  try {
    return await response.json() as unknown;
  } catch {
    let hostname = new URL(source.endpointUrl).hostname;
    try { hostname = new URL(response.url || source.endpointUrl).hostname; } catch { /* safe fallback */ }
    throw new Error(
      `${source.councilName} StatMap response contained malformed JSON ` +
      `(operation=${operation}, portal=${source.councilSlug}, host=${hostname}, ` +
      `content-type=${diagnosticText(response.headers.get("content-type") ?? "unknown", redacted)})`
    );
  }
}

function safeSearchPayload(item: JsonRecord) {
  const type = record(item.applicationTypeId_relatedRecord);
  return {
    id: numberValue(item.id),
    reference: text(item.name),
    address: text(item.address),
    proposal: text(item.proposal),
    status: text(item.status),
    receivedDate: isoDate(item.receivedDate),
    decision: text(item.decision),
    decisionDate: isoDate(item.decisionDate),
    applicationType: text(type?.name)
  };
}

function baseApplication(item: JsonRecord, sourceUrl: string): NormalisedPlanningApplication | null {
  const search = safeSearchPayload(item);
  if (search.id == null || !search.reference || !search.proposal) return null;
  return {
    externalReference: search.reference,
    address: search.address,
    postcode: search.address ? extractPostcode(search.address) || null : null,
    latitude: null,
    longitude: null,
    proposal: search.proposal,
    applicationType: search.applicationType,
    stage: search.status,
    submittedAt: search.receivedDate,
    validatedAt: null,
    decisionAt: search.decisionDate,
    decision: search.decision,
    applicantName: null,
    agentName: null,
    agentContact: null,
    sourceUrl,
    rawPayload: { search }
  };
}

function detailParty(value: unknown) {
  const item = record(value);
  return item ? text(item.name ?? item.fullName ?? item.companyName) : text(value);
}

function mergeDetail(base: NormalisedPlanningApplication, item: JsonRecord) {
  const detailReference = text(item.name ?? item.reference ?? item.applicationReference);
  if (!detailReference || normalizeReference(detailReference) !== normalizeReference(base.externalReference)) {
    throw new DetailReferenceMismatchError(`StatMap detail reference mismatch for ${base.externalReference}`);
  }
  const address = text(item.address ?? item.location) ?? base.address;
  const type = record(item.applicationTypeId_relatedRecord);
  const safeDetails = {
    reference: detailReference,
    address,
    proposal: text(item.proposal),
    applicationType: text(type?.name ?? item.applicationType),
    status: text(item.status ?? item.applicationStatus),
    receivedDate: isoDate(item.receivedDate),
    registeredDate: isoDate(item.registeredDate),
    validDate: isoDate(item.validDate ?? item.validatedDate),
    decisionDate: isoDate(item.decisionDate),
    decision: text(item.decision),
    applicantName: detailParty(item.applicant),
    agentName: detailParty(item.agent)
  };
  return {
    ...base,
    address,
    postcode: address ? extractPostcode(address) || null : null,
    proposal: safeDetails.proposal ?? base.proposal,
    applicationType: safeDetails.applicationType ?? base.applicationType,
    stage: safeDetails.status ?? base.stage,
    submittedAt: safeDetails.receivedDate ?? safeDetails.registeredDate ?? base.submittedAt,
    validatedAt: safeDetails.validDate ?? base.validatedAt,
    decisionAt: safeDetails.decisionDate ?? base.decisionAt,
    decision: safeDetails.decision ?? base.decision,
    applicantName: safeDetails.applicantName,
    agentName: safeDetails.agentName,
    agentContact: null,
    rawPayload: { ...(base.rawPayload as object), details: safeDetails }
  } satisfies NormalisedPlanningApplication;
}

async function mapConcurrent<T, R>(values: T[], concurrency: number, worker: (value: T) => Promise<R>) {
  const output = new Array<R>(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (next < values.length) {
      const index = next++;
      output[index] = await worker(values[index]);
    }
  }));
  return output;
}

export async function fetchStatMapApplications(source: PlanningSourceRecord, options: FetchOptions = {}) {
  const urls = portalUrls(source.endpointUrl);
  const now = options.now ?? new Date();
  const lookbackDays = boundedInteger(options.lookbackDays ?? source.config.lookbackDays, DEFAULT_LOOKBACK_DAYS, MAX_LOOKBACK_DAYS, "lookbackDays");
  const maxPages = boundedInteger(options.maxPages ?? source.config.maxPages, DEFAULT_MAX_PAGES, MAX_PAGES, "maxPages");
  const pageSize = boundedInteger(source.config.pageSize, DEFAULT_PAGE_SIZE, 100, "pageSize");
  const timeoutMs = boundedInteger(options.requestTimeoutMs, DEFAULT_TIMEOUT_MS, 120_000, "requestTimeoutMs");
  const concurrency = boundedInteger(options.detailConcurrency, DEFAULT_DETAIL_CONCURRENCY, MAX_DETAIL_CONCURRENCY, "detailConcurrency");
  const enrichDetails = options.enrichDetails ?? source.config.enrichDetails ?? true;
  const toDay = now.toISOString().slice(0, 10);
  const fromDay = new Date(now.getTime() - lookbackDays * 86_400_000).toISOString().slice(0, 10);
  const from = `${fromDay}T00:00:00.000Z`;
  const to = `${toDay}T23:59:59.999Z`;
  const headers = new Headers({ accept: "application/json", "content-type": "application/json", ...source.config.requestHeaders });
  const rows: JsonRecord[] = [];
  let advertisedTotal: number | null = null;

  for (let page = 0; page < maxPages; page += 1) {
    const payload = {
      filter: { parts: [{ filterItems: [
        { columnName: "validatedDateFrom", value: from, operator: "=" },
        { columnName: "validatedDateTo", value: to, operator: "=" }
      ] }] },
      offset: page * pageSize,
      order: { id: "asc" },
      select: "",
      pageSize
    };
    const response = await safeFetch(source, "search", urls.searchUrl, {
      method: "POST", headers, body: JSON.stringify(payload)
    }, urls.origin, timeoutMs);
    const parsed = record(await jsonResponse(source, "search", response, []));
    const total = numberValue(parsed?.total);
    const records = Array.isArray(parsed?.records) ? parsed.records.map(record).filter((item): item is JsonRecord => Boolean(item)) : null;
    if (!parsed || total == null || total < 0 || !Number.isInteger(total) || !records) {
      throw new Error(`${source.councilName} StatMap search returned malformed pagination JSON`);
    }
    if (advertisedTotal === null) {
      advertisedTotal = total;
      if (total > maxPages * pageSize) throw new Error(`${source.councilName} StatMap page cap cannot prove complete advertised total ${total}`);
    } else if (total !== advertisedTotal) {
      throw new Error(`${source.councilName} StatMap advertised total changed during pagination`);
    }
    if (!records.length && rows.length < advertisedTotal) {
      throw new Error(`${source.councilName} StatMap reached an empty page before the advertised total was complete`);
    }
    rows.push(...records);
    if (rows.length >= advertisedTotal) break;
  }

  const total = advertisedTotal ?? 0;
  if (rows.length !== total) throw new Error(`${source.councilName} StatMap total mismatch: advertised ${total}, retrieved ${rows.length}`);
  const applications: NormalisedPlanningApplication[] = [];
  const seen = new Set<string>();
  for (const item of rows) {
    const id = numberValue(item.id);
    if (id == null) throw new Error(`${source.councilName} StatMap search result is missing an internal navigation id`);
    const base = baseApplication(item, urls.detailPageUrl(String(id)));
    if (!base) throw new Error(`${source.councilName} StatMap search result is missing a visible planning reference or proposal`);
    const key = normalizeReference(base.externalReference);
    if (seen.has(key)) throw new Error(`${source.councilName} StatMap duplicate planning reference ${base.externalReference}`);
    seen.add(key);
    applications.push(base);
  }
  if (seen.size !== total) throw new Error(`${source.councilName} StatMap completeness validation failed`);
  if (!enrichDetails) return applications;

  return mapConcurrent(applications, concurrency, async (base) => {
    const id = new URL(base.sourceUrl!).pathname.split("/").at(-1)!;
    try {
      const response = await safeFetch(source, "load-detail", urls.detailApiUrl(id), { headers: new Headers({ accept: "application/json", ...source.config.requestHeaders }) }, urls.origin, timeoutMs);
      const detail = record(await jsonResponse(source, "load-detail", response, []));
      if (!detail) throw new Error(`${source.councilName} StatMap detail returned malformed JSON`);
      return mergeDetail(base, detail);
    } catch (failure) {
      if (failure instanceof DetailReferenceMismatchError) throw failure;
      const message = diagnosticText(failure instanceof Error ? failure.message : failure, requestHeaderValues(source.config.requestHeaders));
      return { ...base, rawPayload: { ...(base.rawPayload as object), enrichmentError: message } };
    }
  });
}
