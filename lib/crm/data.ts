import { normaliseOpportunityStage } from "./domain.ts";
import type { CustomerOpportunitySummary, OpportunityPriority } from "./opportunities.ts";

const CRM_SCHEMA_ERROR_CODES = new Set(["42703", "42P01", "PGRST204", "PGRST205"]);
const CRM_SCHEMA_MARKERS = /\b(?:opportunity_notes|first_viewed_at|last_viewed_at|contacted_at|quoted_at|won_at|lost_at|not_relevant_at|follow_up_at|quote_value_gbp|won_value_gbp|lost_reason|not_relevant_reason)\b/i;

export function isCrmSchemaUnavailableError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown };
  const code = String(value.code ?? "").toUpperCase();
  if (!CRM_SCHEMA_ERROR_CODES.has(code)) return false;
  const clue = [value.message, value.details, value.hint].map((part) => String(part ?? "")).join(" ");
  return CRM_SCHEMA_MARKERS.test(clue);
}

export const CUSTOMER_OPPORTUNITY_SELECT = `
  id,status,priority,score,address,postcode,proposal,
  estimated_value_min_gbp,estimated_value_max_gbp,why_it_matches,recommended_approach,
  first_viewed_at,last_viewed_at,contacted_at,quoted_at,won_at,lost_at,not_relevant_at,
  follow_up_at,quote_value_gbp,won_value_gbp,lost_reason,not_relevant_reason,matched_at,updated_at,
  planning_application:planning_applications!inner(
    external_reference,application_type,submitted_at,validated_at,decision_at,stage,decision,
    source_url,applicant_name,agent_name,agent_contact,
    council:councils!inner(
      id,name,
      planning_authority_counties(county:counties(id,name,slug))
    )
  )
`;

function one(value: unknown): any {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function nullableText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

function nullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function priority(value: unknown): OpportunityPriority {
  const normalized = String(value ?? "LOW").toUpperCase();
  return ["HOT", "HIGH", "MEDIUM", "LOW"].includes(normalized)
    ? normalized as OpportunityPriority
    : "LOW";
}

export type CustomerOpportunityDetail = CustomerOpportunitySummary & {
  planningStage: string | null;
  submittedAt: string | null;
  decisionAt: string | null;
  decision: string | null;
  sourceUrl: string | null;
  applicantName: string | null;
  agentName: string | null;
  agentContact: string | null;
  whyItMatches: string | null;
  recommendedApproach: string | null;
  lastViewedAt: string | null;
  lostAt: string | null;
  notRelevantAt: string | null;
  lostReason: string | null;
  notRelevantReason: string | null;
  matchedAt: string | null;
  updatedAt: string | null;
};

export function normaliseCustomerOpportunityRow(row: any): CustomerOpportunityDetail {
  const planning = one(row?.planning_application);
  const council = one(planning?.council);
  const id = nullableText(row?.id);
  const externalReference = nullableText(planning?.external_reference);
  if (!id || !externalReference || !council?.name) {
    throw new Error(`Customer opportunity ${id ?? "unknown"} is missing planning application identity`);
  }
  const mappings = Array.isArray(council.planning_authority_counties)
    ? council.planning_authority_counties
    : [];
  const countyNames = Array.from(new Set<string>(mappings
    .map((mapping: any): string | null => nullableText(one(mapping?.county)?.name))
    .filter((name: string | null): name is string => Boolean(name))
  )).sort();

  return {
    id,
    status: normaliseOpportunityStage(row.status),
    priority: priority(row.priority),
    score: nullableNumber(row.score) ?? 0,
    externalReference,
    address: nullableText(row.address),
    postcode: nullableText(row.postcode),
    proposal: nullableText(row.proposal) ?? "Planning opportunity",
    councilName: String(council.name),
    countyNames,
    applicationType: nullableText(planning.application_type),
    validatedAt: nullableText(planning.validated_at),
    firstViewedAt: nullableText(row.first_viewed_at),
    followUpAt: nullableText(row.follow_up_at),
    contactedAt: nullableText(row.contacted_at),
    quotedAt: nullableText(row.quoted_at),
    wonAt: nullableText(row.won_at),
    quoteValueGbp: nullableNumber(row.quote_value_gbp),
    wonValueGbp: nullableNumber(row.won_value_gbp),
    estimatedValueMinGbp: nullableNumber(row.estimated_value_min_gbp),
    estimatedValueMaxGbp: nullableNumber(row.estimated_value_max_gbp),
    planningStage: nullableText(planning.stage),
    submittedAt: nullableText(planning.submitted_at),
    decisionAt: nullableText(planning.decision_at),
    decision: nullableText(planning.decision),
    sourceUrl: nullableText(planning.source_url),
    applicantName: nullableText(planning.applicant_name),
    agentName: nullableText(planning.agent_name),
    agentContact: nullableText(planning.agent_contact),
    whyItMatches: nullableText(row.why_it_matches),
    recommendedApproach: nullableText(row.recommended_approach),
    lastViewedAt: nullableText(row.last_viewed_at),
    lostAt: nullableText(row.lost_at),
    notRelevantAt: nullableText(row.not_relevant_at),
    lostReason: nullableText(row.lost_reason),
    notRelevantReason: nullableText(row.not_relevant_reason),
    matchedAt: nullableText(row.matched_at),
    updatedAt: nullableText(row.updated_at)
  };
}
