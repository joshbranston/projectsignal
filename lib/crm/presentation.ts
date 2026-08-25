import { CRM_STAGES, type OpportunityStage } from "./domain.ts";
import type { OpportunityFilters, OpportunityPriority } from "./opportunities.ts";

const STAGE_LABELS: Record<OpportunityStage, string> = {
  new: "New",
  reviewing: "Reviewing",
  contacted: "Contacted",
  quoted: "Quoted",
  follow_up: "Follow Up",
  won: "Won",
  lost: "Lost",
  not_relevant: "Not Relevant"
};

export function stageLabel(stage: OpportunityStage) {
  return STAGE_LABELS[stage];
}

export function formatGbp(value: number | null | undefined) {
  if (value === null || value === undefined) return "Not set";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2
  }).format(value);
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function all(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value : value ? [value] : []).map((item) => item.trim()).filter(Boolean);
}

function text(value: string | string[] | undefined) {
  return first(value)?.trim() || undefined;
}

function nonnegative(value: string | string[] | undefined) {
  const raw = text(value);
  if (!raw) return undefined;
  const number = Number(raw);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

export function parseOpportunityFilters(
  query: Record<string, string | string[] | undefined>
): { filters: OpportunityFilters; page: number } {
  const filters: OpportunityFilters = {};
  const stages = all(query.stage).filter((item): item is OpportunityStage =>
    (CRM_STAGES as readonly string[]).includes(item)
  );
  const priorities = all(query.priority)
    .map((item) => item.toUpperCase())
    .filter((item): item is OpportunityPriority => ["HOT", "HIGH", "MEDIUM", "LOW"].includes(item));
  const date = text(query.date);
  const followUp = text(query.followUp);
  if (stages.length) filters.stages = stages;
  if (priorities.length) filters.priorities = priorities;
  if (["today", "7d", "30d"].includes(date ?? "")) filters.date = date as OpportunityFilters["date"];
  if (text(query.county)) filters.county = text(query.county);
  if (text(query.council)) filters.council = text(query.council);
  if (text(query.applicationType)) filters.applicationType = text(query.applicationType);
  if (nonnegative(query.valueMin) !== undefined) filters.minEstimatedValueGbp = nonnegative(query.valueMin);
  if (nonnegative(query.valueMax) !== undefined) filters.maxEstimatedValueGbp = nonnegative(query.valueMax);
  if (["due", "overdue", "today", "upcoming"].includes(followUp ?? "")) {
    filters.followUp = followUp as OpportunityFilters["followUp"];
  }
  if (text(query.q)) filters.search = text(query.q);
  const requestedPage = Number(first(query.page) ?? 1);
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  return { filters, page };
}
