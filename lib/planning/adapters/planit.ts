import { extractPostcode } from "../../scoring.ts";
import type { NormalisedPlanningApplication, PlanningSourceRecord } from "../types.ts";

type PlanItRecord = Record<string, unknown> & {
  other_fields?: Record<string, unknown> | null;
};

type PlanItResponse = {
  total?: number;
  from?: number;
  to?: number;
  records?: PlanItRecord[];
  error?: string;
};

function text(value: unknown) {
  const result = String(value ?? "").trim();
  if (!result || /^(?:null|none|n\/?a)$/i.test(result)) return null;
  return result;
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function dateOnly(value: unknown) {
  const result = text(value);
  if (!result) return null;
  const match = result.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function otherFields(record: PlanItRecord) {
  return record.other_fields && typeof record.other_fields === "object"
    ? record.other_fields
    : {};
}

export function normalisePlanItRecord(record: PlanItRecord): NormalisedPlanningApplication | null {
  const other = otherFields(record);
  const externalReference = text(record.reference) ?? text(record.uid) ?? text(record.name);
  const proposal = text(record.description);
  if (!externalReference || !proposal) return null;

  const address = text(record.address);
  const postcode = text(record.postcode) ?? (address ? extractPostcode(address) || null : null);

  return {
    externalReference,
    address,
    postcode,
    latitude: numberOrNull(record.location_y ?? other.latitude ?? other.lat),
    longitude: numberOrNull(record.location_x ?? other.longitude ?? other.lng),
    proposal,
    applicationType: text(other.application_type) ?? text(record.app_type),
    stage: text(record.status) ?? text(record.app_state),
    submittedAt: dateOnly(other.date_received) ?? dateOnly(record.start_date),
    validatedAt: dateOnly(other.date_validated),
    decisionAt:
      dateOnly(record.decided_date) ??
      dateOnly(other.decision_date) ??
      dateOnly(other.decision_issued_date) ??
      dateOnly(other.decision_published_date),
    decision: text(record.decision) ?? text(other.decision),
    // Prefer company names rather than individual names from public planning data.
    applicantName: text(other.applicant_company),
    agentName: text(other.agent_company),
    agentContact: null,
    // PlanIt's `url` points back to the planning authority's own application record.
    sourceUrl: text(record.url) ?? text(record.link),
    rawPayload: record
  };
}

function planItUrl(source: PlanningSourceRecord, page: number) {
  const url = new URL(source.endpointUrl);
  const lookbackDays = Math.max(1, Math.min(Number(source.config.lookbackDays ?? 7), 31));
  const pageSize = Math.max(1, Math.min(Number(source.config.pageSize ?? 100), 300));
  const authority = text(source.config.authority) ?? source.councilName;

  url.searchParams.set("auth", authority);
  url.searchParams.set("no_kin", "on");
  url.searchParams.set("recent", String(lookbackDays));
  url.searchParams.set("pg_sz", String(pageSize));
  url.searchParams.set("page", String(page));
  url.searchParams.set("compress", "on");
  return url;
}

export async function fetchPlanItApplications(
  source: PlanningSourceRecord
): Promise<NormalisedPlanningApplication[]> {
  const maxPages = Math.max(1, Math.min(Number(source.config.maxPages ?? 3), 10));
  const pageSize = Math.max(1, Math.min(Number(source.config.pageSize ?? 100), 300));
  const headers = {
    "user-agent": "ProjectSignal/0.3 (+https://projectsignal-tau.vercel.app)",
    accept: "application/json",
    ...(source.config.requestHeaders ?? {})
  };

  const applications: NormalisedPlanningApplication[] = [];
  let total = Number.POSITIVE_INFINITY;

  for (let page = 1; page <= maxPages && applications.length < total; page++) {
    const url = planItUrl(source, page);
    const response = await fetch(url, { headers, cache: "no-store" });

    if (!response.ok) {
      const retryAfter = response.headers.get("retry-after");
      const suffix = retryAfter ? `; retry after ${retryAfter}` : "";
      throw new Error(`${source.councilName} PlanIt API returned ${response.status}${suffix}`);
    }

    const payload = (await response.json()) as PlanItResponse;
    if (payload.error) {
      throw new Error(`${source.councilName} PlanIt API error: ${payload.error}`);
    }

    const records = Array.isArray(payload.records) ? payload.records : [];
    total = Number.isFinite(Number(payload.total)) ? Number(payload.total) : applications.length + records.length;

    for (const record of records) {
      const application = normalisePlanItRecord(record);
      if (application) applications.push(application);
    }

    if (records.length < pageSize) break;
  }

  return applications;
}
