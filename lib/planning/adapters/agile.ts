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

const IDENTITY_ORIGIN = "https://identity.agileapplications.co.uk";
const DEFAULT_LOOKBACK_DAYS = 7;
const MAX_LOOKBACK_DAYS = 31;
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

function numeric(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isoDate(value: unknown) {
  const input = text(value);
  const match = input?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function normalizedReference(value: string) {
  return value.replace(/\s+/g, "").toUpperCase();
}

function boundedInteger(value: unknown, fallback: number, maximum: number, label: string) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`Agile ${label} must be between 1 and ${maximum}`);
  }
  return parsed;
}

function portalDetails(endpoint: string) {
  let url: URL;
  try { url = new URL(endpoint); } catch { throw new Error("Agile endpoint must be a valid HTTPS URL"); }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Agile endpoint must be a valid HTTPS URL without credentials");
  }
  if (url.hostname.toLowerCase() !== "planning.agileapplications.co.uk") {
    throw new Error("Agile portal host is not supported");
  }
  const clientKey = url.pathname.split("/").filter(Boolean)[0];
  if (!clientKey || !/^[a-z0-9-]+$/i.test(clientKey)) throw new Error("Agile endpoint is missing a valid public client key");
  const portalBase = new URL(`/${clientKey}`, url.origin).toString().replace(/\/$/, "");
  return { clientKey, portalBase };
}

function allowedAgileUrl(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Agile API configuration is not a valid URL"); }
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || !(hostname === "agileapplications.co.uk" || hostname.endsWith(".agileapplications.co.uk"))) {
    throw new Error(`unsupported Agile API host: ${hostname || "unknown"}`);
  }
  return url;
}

function requestHeaderValues(headers?: HeadersInit) {
  if (!headers) return [];
  try { return Array.from(new Headers(headers).values()).filter(Boolean); } catch { return []; }
}

function fragments(values: string[]) {
  const result = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    result.add(value);
    const auth = value.match(/^(?:basic|bearer)\s+(.+)$/i)?.[1];
    if (auth) result.add(auth);
  }
  return [...result].sort((a, b) => b.length - a.length);
}

function diagnosticText(value: unknown, redacted: string[]) {
  let output = String(value ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  for (const secret of fragments(redacted)) output = output.split(secret).join("[REDACTED]");
  return output
    .replace(/\b(?:authorization|cookie|set-cookie|x-client|x-api-key|api-key)\s*[:=][^\r\n]*/gi, "[REDACTED]")
    .slice(0, 300);
}

function transportSummary(failure: unknown, redacted: string[]) {
  const output: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = failure;
  while (current != null && output.length < 5 && !seen.has(current)) {
    seen.add(current);
    if (typeof current !== "object") { output.push(diagnosticText(current, redacted)); break; }
    const item = current as JsonRecord;
    const name = diagnosticText(item.name ?? "Error", redacted);
    const code = item.code ? `[${diagnosticText(item.code, redacted)}]` : "";
    const message = item.message ? `: ${diagnosticText(item.message, redacted)}` : "";
    output.push(`${name}${code}${message}`);
    current = item.cause;
  }
  return output.join("; cause=") || "Unknown transport error";
}

function safeCause(failure: unknown, redacted: string[], depth = 0, seen = new Set<unknown>()): Error | undefined {
  if (failure == null || depth >= 5 || seen.has(failure)) return undefined;
  if (typeof failure !== "object") return new Error(diagnosticText(failure, redacted));
  seen.add(failure);
  const item = failure as JsonRecord;
  const nested = safeCause(item.cause, redacted, depth + 1, seen);
  const safe = new Error(diagnosticText(item.message ?? "Transport error", redacted), nested ? { cause: nested } : undefined) as Error & { code?: string };
  safe.name = diagnosticText(item.name ?? "Error", redacted);
  if (item.code) safe.code = diagnosticText(item.code, redacted);
  return safe;
}

function transportError(source: PlanningSourceRecord, operation: string, url: string, failure: unknown, redacted: string[]) {
  const values = [...requestHeaderValues(source.config.requestHeaders), ...redacted];
  return new Error(
    `${source.councilName} Agile ${operation} request failed (portal=${source.councilSlug}, host=${new URL(url).hostname}): ${transportSummary(failure, values)}`,
    { cause: safeCause(failure, values) }
  );
}

function httpError(source: PlanningSourceRecord, operation: string, url: string, response: Response, redacted: string[]) {
  let hostname = new URL(url).hostname;
  try { hostname = new URL(response.url || url).hostname; } catch { /* safe fallback */ }
  return new Error(
    `${source.councilName} Agile ${operation} rejected (portal=${source.councilSlug}, host=${hostname}, status=${response.status}, content-type=${diagnosticText(response.headers.get("content-type") ?? "unknown", redacted)}, body=not-read)`
  );
}

async function safeFetch(
  source: PlanningSourceRecord,
  operation: string,
  initialUrl: string,
  init: RequestInit,
  timeoutMs: number,
  redacted: string[]
) {
  let url = initialUrl;
  const requestOrigin = new URL(initialUrl).origin;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    let response: Response;
    try {
      response = await fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
    } catch (failure) {
      throw transportError(source, operation, url, failure, redacted);
    }
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      if (!response.ok) throw httpError(source, operation, url, response, redacted);
      return response;
    }
    if (redirects === MAX_REDIRECTS) throw new Error(`${source.councilName} Agile ${operation} exceeded ${MAX_REDIRECTS} redirects`);
    const location = response.headers.get("location");
    if (!location) throw new Error(`${source.councilName} Agile ${operation} redirect is missing a location`);
    const next = allowedAgileUrl(new URL(location, url).toString());
    if (next.origin !== requestOrigin) {
      throw new Error(`${source.councilName} Agile ${operation} cross-origin redirect rejected`);
    }
    url = next.toString();
  }
  throw new Error("Unreachable Agile redirect state");
}

async function readJson(source: PlanningSourceRecord, operation: string, response: Response, redacted: string[]) {
  try { return await response.json() as unknown; }
  catch {
    let hostname = new URL(source.endpointUrl).hostname;
    try { hostname = new URL(response.url || source.endpointUrl).hostname; } catch { /* safe fallback */ }
    throw new Error(
      `${source.councilName} Agile response contained malformed JSON ` +
      `(operation=${operation}, portal=${source.councilSlug}, host=${hostname}, ` +
      `content-type=${diagnosticText(response.headers.get("content-type") ?? "unknown", redacted)})`
    );
  }
}

function configuredString(value: unknown, keys: string[]) {
  const direct = text(value);
  if (direct) return direct;
  const item = record(value);
  if (!item) return null;
  for (const key of keys) {
    const found = text(item[key]);
    if (found) return found;
  }
  const nested = record(item.data);
  if (nested) {
    for (const key of keys) {
      const found = text(nested[key]);
      if (found) return found;
    }
  }
  return null;
}

function safeSearch(item: JsonRecord) {
  return {
    id: numeric(item.id ?? item.applicationId),
    reference: text(item.reference ?? item.applicationReference),
    address: text(item.location ?? item.address),
    proposal: text(item.proposal ?? item.description),
    applicationType: text(item.applicationType),
    status: text(item.status),
    registrationDate: isoDate(item.registrationDate),
    validDate: isoDate(item.validDate ?? item.validationDate),
    decisionDate: isoDate(item.decisionDate),
    decision: text(item.decisionText ?? item.decision),
    applicantName: text(item.applicantName ?? item.applicantSurname),
    agentName: text(item.agentName)
  };
}

function baseApplication(item: JsonRecord, sourceUrl: string): NormalisedPlanningApplication | null {
  const search = safeSearch(item);
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
    submittedAt: search.registrationDate,
    validatedAt: search.validDate,
    decisionAt: search.decisionDate,
    decision: search.decision,
    applicantName: search.applicantName,
    agentName: search.agentName,
    agentContact: null,
    sourceUrl,
    rawPayload: { search }
  };
}

function mergeDetail(base: NormalisedPlanningApplication, item: JsonRecord) {
  const reference = text(item.reference ?? item.applicationReference);
  if (!reference || normalizedReference(reference) !== normalizedReference(base.externalReference)) {
    throw new DetailReferenceMismatchError(`Agile detail reference mismatch for ${base.externalReference}`);
  }
  const address = text(item.location ?? item.address) ?? base.address;
  const safeDetails = {
    reference,
    address,
    proposal: text(item.fullProposal ?? item.proposal ?? item.description),
    applicationType: text(item.applicationType),
    status: text(item.status),
    receivedDate: isoDate(item.receivedDate),
    registrationDate: isoDate(item.registrationDate),
    validDate: isoDate(item.validDate ?? item.validationDate),
    decisionDate: isoDate(item.decisionDate),
    decision: text(item.decisionText ?? item.decision),
    applicantName: text(item.applicantName ?? item.applicantSurname),
    agentName: text(item.agentName)
  };
  const agentContact = text(item.agentEmail ?? item.agentTelephone ?? item.agentPhone);
  return {
    ...base,
    address,
    postcode: address ? extractPostcode(address) || null : null,
    proposal: safeDetails.proposal ?? base.proposal,
    applicationType: safeDetails.applicationType ?? base.applicationType,
    stage: safeDetails.status ?? base.stage,
    submittedAt: safeDetails.receivedDate ?? safeDetails.registrationDate ?? base.submittedAt,
    validatedAt: safeDetails.validDate ?? base.validatedAt,
    decisionAt: safeDetails.decisionDate ?? base.decisionAt,
    decision: safeDetails.decision ?? base.decision,
    applicantName: safeDetails.applicantName ?? base.applicantName,
    agentName: safeDetails.agentName ?? base.agentName,
    agentContact,
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

export async function fetchAgileApplications(source: PlanningSourceRecord, options: FetchOptions = {}) {
  const portal = portalDetails(source.endpointUrl);
  const now = options.now ?? new Date();
  const lookbackDays = boundedInteger(options.lookbackDays ?? source.config.lookbackDays, DEFAULT_LOOKBACK_DAYS, MAX_LOOKBACK_DAYS, "lookbackDays");
  boundedInteger(options.maxPages ?? source.config.maxPages, 10, 25, "maxPages");
  const timeoutMs = boundedInteger(options.requestTimeoutMs, DEFAULT_TIMEOUT_MS, 120_000, "requestTimeoutMs");
  const concurrency = boundedInteger(options.detailConcurrency, DEFAULT_DETAIL_CONCURRENCY, MAX_DETAIL_CONCURRENCY, "detailConcurrency");
  const enrichDetails = options.enrichDetails ?? source.config.enrichDetails ?? true;
  const configuredSecrets = requestHeaderValues(source.config.requestHeaders);

  const clientUrl = new URL("/api/client/get", IDENTITY_ORIGIN);
  clientUrl.searchParams.set("url", portal.clientKey);
  const clientResponse = await safeFetch(source, "resolve-client", clientUrl.toString(), {
    headers: new Headers({ accept: "application/json" })
  }, timeoutMs, configuredSecrets);
  const clientJson = await readJson(source, "resolve-client", clientResponse, configuredSecrets);
  const clientId = configuredString(clientJson, ["value", "client", "clientId", "id", "code"]);
  if (!clientId) throw new Error(`${source.councilName} Agile client bootstrap returned malformed JSON`);
  const redacted = [...configuredSecrets, clientId];
  const platformHeaders = new Headers({
    accept: "application/json",
    "x-client": clientId,
    "x-product": "CITIZENPORTAL",
    "x-service": "PA"
  });

  const configUrl = new URL("/api/configuration/API_URL", IDENTITY_ORIGIN).toString();
  const configResponse = await safeFetch(source, "resolve-api", configUrl, { headers: platformHeaders }, timeoutMs, redacted);
  const configJson = await readJson(source, "resolve-api", configResponse, redacted);
  const apiValue = configuredString(configJson, ["value", "configurationValue", "url", "apiUrl"]);
  if (!apiValue) throw new Error(`${source.councilName} Agile API bootstrap returned malformed JSON`);
  const api = allowedAgileUrl(apiValue);
  const apiBase = api.toString().replace(/\/$/, "");
  const toDay = now.toISOString().slice(0, 10);
  const fromDay = new Date(now.getTime() - lookbackDays * 86_400_000).toISOString().slice(0, 10);
  const searchUrl = new URL(`${apiBase}/api/application/search`);
  searchUrl.searchParams.set("validDateFrom", `${fromDay}T00:00:00.000Z`);
  searchUrl.searchParams.set("validDateTo", `${toDay}T23:59:59.999Z`);
  const searchResponse = await safeFetch(source, "search", searchUrl.toString(), { headers: platformHeaders }, timeoutMs, redacted);
  const searchJson = record(await readJson(source, "search", searchResponse, redacted));
  const total = numeric(searchJson?.total);
  const results = Array.isArray(searchJson?.results) ? searchJson.results.map(record).filter((item): item is JsonRecord => Boolean(item)) : null;
  if (!searchJson || total == null || !Number.isInteger(total) || total < 0 || !results) {
    throw new Error(`${source.councilName} Agile search returned malformed JSON`);
  }
  if (total !== results.length) throw new Error(`${source.councilName} Agile total mismatch: advertised ${total}, retrieved ${results.length}`);

  const applications: NormalisedPlanningApplication[] = [];
  const seen = new Set<string>();
  for (const item of results) {
    const id = numeric(item.id ?? item.applicationId);
    if (id == null) throw new Error(`${source.councilName} Agile search result is missing an internal navigation id`);
    const base = baseApplication(item, `${portal.portalBase}/application-details/${encodeURIComponent(String(id))}`);
    if (!base) throw new Error(`${source.councilName} Agile search result is missing a visible planning reference or proposal`);
    const key = normalizedReference(base.externalReference);
    if (seen.has(key)) throw new Error(`${source.councilName} Agile duplicate planning reference ${base.externalReference}`);
    seen.add(key);
    applications.push(base);
  }
  if (seen.size !== total) throw new Error(`${source.councilName} Agile completeness validation failed`);
  if (!enrichDetails) return applications;

  return mapConcurrent(applications, concurrency, async (base) => {
    const id = new URL(base.sourceUrl!).pathname.split("/").at(-1)!;
    const detailUrl = new URL(`${apiBase}/api/application/${encodeURIComponent(id)}`).toString();
    try {
      const response = await safeFetch(source, "load-detail", detailUrl, { headers: platformHeaders }, timeoutMs, redacted);
      const parsed = record(await readJson(source, "load-detail", response, redacted));
      if (!parsed) throw new Error(`${source.councilName} Agile detail returned malformed JSON`);
      return mergeDetail(base, parsed);
    } catch (failure) {
      if (failure instanceof DetailReferenceMismatchError) throw failure;
      const message = diagnosticText(failure instanceof Error ? failure.message : failure, redacted);
      return { ...base, rawPayload: { ...(base.rawPayload as object), enrichmentError: message } };
    }
  });
}
