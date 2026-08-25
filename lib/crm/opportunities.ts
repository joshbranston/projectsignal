import { normaliseOpportunityStage, type OpportunityStage } from "./domain.ts";

export type OpportunityPriority = "HOT" | "HIGH" | "MEDIUM" | "LOW";
export type FollowUpState = "none" | "overdue" | "today" | "upcoming";

export type CustomerOpportunitySummary = {
  id: string;
  status: OpportunityStage;
  priority: OpportunityPriority;
  score: number;
  externalReference: string;
  address: string | null;
  postcode: string | null;
  proposal: string;
  councilName: string;
  countyNames: string[];
  applicationType: string | null;
  validatedAt: string | null;
  firstViewedAt: string | null;
  followUpAt: string | null;
  contactedAt: string | null;
  quotedAt: string | null;
  wonAt: string | null;
  quoteValueGbp: number | null;
  wonValueGbp: number | null;
  estimatedValueMinGbp: number | null;
  estimatedValueMaxGbp: number | null;
};

function londonDay(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const find = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${find("year")}-${find("month")}-${find("day")}`;
}

export function classifyFollowUp(value: string | null, now = new Date()): FollowUpState {
  if (!value) return "none";
  const followUp = new Date(value);
  if (!Number.isFinite(followUp.getTime())) return "none";
  const followUpDay = londonDay(followUp)!;
  const today = londonDay(now)!;
  if (followUpDay < today) return "overdue";
  if (followUpDay === today) return "today";
  return "upcoming";
}

function percentage(numerator: number, denominator: number) {
  return denominator ? Math.round((numerator / denominator) * 1000) / 10 : null;
}

export function calculatePipelineMetrics(
  opportunities: CustomerOpportunitySummary[],
  subscriptionCostGbp: number
) {
  const reviewed = opportunities.filter((item) => item.firstViewedAt || item.status !== "new").length;
  const contacted = opportunities.filter((item) =>
    item.contactedAt || ["contacted", "quoted", "follow_up", "won", "lost"].includes(item.status)
  ).length;
  const quoted = opportunities.filter((item) =>
    item.quotedAt || item.quoteValueGbp !== null || ["quoted", "won"].includes(item.status)
  ).length;
  const won = opportunities.filter((item) => item.status === "won").length;
  const quotePipelineGbp = opportunities
    .filter((item) => ["quoted", "follow_up"].includes(item.status))
    .reduce((total, item) => total + (item.quoteValueGbp ?? 0), 0);
  const wonValueGbp = opportunities
    .filter((item) => item.status === "won")
    .reduce((total, item) => total + (item.wonValueGbp ?? 0), 0);
  return {
    delivered: opportunities.length,
    reviewed,
    contacted,
    quoted,
    won,
    quotePipelineGbp,
    wonValueGbp,
    contactedToQuotedPercent: percentage(quoted, contacted),
    quotedToWonPercent: percentage(won, quoted),
    roiMultiple: subscriptionCostGbp > 0
      ? Math.round((wonValueGbp / subscriptionCostGbp) * 100) / 100
      : null
  };
}

export type OpportunityFilters = {
  stages?: OpportunityStage[];
  priorities?: OpportunityPriority[];
  date?: "today" | "7d" | "30d";
  county?: string;
  council?: string;
  applicationType?: string;
  minEstimatedValueGbp?: number;
  maxEstimatedValueGbp?: number;
  followUp?: Exclude<FollowUpState, "none"> | "due";
  search?: string;
};

function withinDateWindow(value: string | null, window: OpportunityFilters["date"], now: Date) {
  if (!window) return true;
  if (!value) return false;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return false;
  const days = window === "today" ? 1 : window === "7d" ? 7 : 30;
  const lower = new Date(now.getTime() - days * 86_400_000);
  return date >= lower && date <= now;
}

export function filterCustomerOpportunities<T extends CustomerOpportunitySummary>(
  opportunities: T[],
  filters: OpportunityFilters,
  now = new Date()
): T[] {
  const terms = (filters.search ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  return opportunities.filter((item) => {
    const stage = normaliseOpportunityStage(item.status);
    if (filters.stages?.length && !filters.stages.includes(stage)) return false;
    if (filters.priorities?.length && !filters.priorities.includes(item.priority)) return false;
    if (filters.county && !item.countyNames.some((name) => name.toLowerCase() === filters.county!.toLowerCase())) return false;
    if (filters.council && item.councilName.toLowerCase() !== filters.council.toLowerCase()) return false;
    if (filters.applicationType && (item.applicationType ?? "").toLowerCase() !== filters.applicationType.toLowerCase()) return false;
    if (!withinDateWindow(item.validatedAt, filters.date, now)) return false;
    if (filters.minEstimatedValueGbp !== undefined && (item.estimatedValueMaxGbp ?? 0) < filters.minEstimatedValueGbp) return false;
    if (filters.maxEstimatedValueGbp !== undefined && (item.estimatedValueMinGbp ?? 0) > filters.maxEstimatedValueGbp) return false;
    const followUp = classifyFollowUp(item.followUpAt, now);
    if (filters.followUp === "due" && !["overdue", "today"].includes(followUp)) return false;
    if (filters.followUp && filters.followUp !== "due" && followUp !== filters.followUp) return false;
    if (terms.length) {
      const haystack = [item.externalReference, item.postcode, item.address, item.proposal]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!terms.every((term) => haystack.includes(term))) return false;
    }
    return true;
  });
}

const CLOSED_STAGES = new Set<OpportunityStage>(["won", "lost", "not_relevant"]);

export function sortCustomerOpportunities<T extends CustomerOpportunitySummary>(opportunities: T[]): T[] {
  return [...opportunities].sort((left, right) => {
    const activeDifference = Number(CLOSED_STAGES.has(left.status)) - Number(CLOSED_STAGES.has(right.status));
    if (activeDifference) return activeDifference;
    if (right.score !== left.score) return right.score - left.score;
    return String(right.validatedAt ?? "").localeCompare(String(left.validatedAt ?? ""));
  });
}
