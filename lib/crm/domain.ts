export const CRM_STAGES = [
  "new",
  "reviewing",
  "contacted",
  "quoted",
  "follow_up",
  "won",
  "lost",
  "not_relevant"
] as const;

export type OpportunityStage = (typeof CRM_STAGES)[number];

export const LOST_REASONS = [
  "No response",
  "Price",
  "Competitor",
  "Project cancelled",
  "Too late",
  "Not suitable",
  "Other"
] as const;

export const NOT_RELEVANT_REASONS = [
  "Wrong type of work",
  "Too small",
  "Too large",
  "Wrong area",
  "Commercial",
  "Already completed",
  "No real opportunity",
  "Other"
] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requiredUuid(value: unknown) {
  const id = String(value ?? "").trim();
  if (!UUID.test(id)) throw new Error("Opportunity ID must be a valid UUID");
  return id;
}

export function parseOpportunityId(value: unknown) {
  return requiredUuid(value);
}

export function normaliseOpportunityStage(value: unknown): OpportunityStage {
  const stage = String(value ?? "").trim().toLowerCase();
  if (stage === "interested") return "reviewing";
  if (stage === "ignored") return "not_relevant";
  if ((CRM_STAGES as readonly string[]).includes(stage)) return stage as OpportunityStage;
  throw new Error("Invalid opportunity stage");
}

function nullableMoney(value: unknown, label: string) {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} must be zero or greater`);
  if (number > 100_000_000) throw new Error(`${label} exceeds the supported maximum`);
  return Math.round(number * 100) / 100;
}

function nullableDate(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new Error("Follow-up must be a valid date");
  return date.toISOString();
}

function nullableReason<T extends readonly string[]>(value: unknown, allowed: T, label: string) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const reason = String(value).trim();
  if (!allowed.includes(reason)) throw new Error(`Invalid ${label} reason`);
  return reason as T[number];
}

export type OpportunityMutation = {
  opportunityId: string;
  stage: OpportunityStage;
  followUpAt: string | null;
  quoteValueGbp: number | null;
  wonValueGbp: number | null;
  lostReason: (typeof LOST_REASONS)[number] | null;
  notRelevantReason: (typeof NOT_RELEVANT_REASONS)[number] | null;
};

export function parseOpportunityMutation(input: Record<string, unknown>): OpportunityMutation {
  return {
    opportunityId: requiredUuid(input.opportunityId),
    stage: normaliseOpportunityStage(input.stage),
    followUpAt: nullableDate(input.followUpAt),
    quoteValueGbp: nullableMoney(input.quoteValueGbp, "Quote value"),
    wonValueGbp: nullableMoney(input.wonValueGbp, "Won value"),
    lostReason: nullableReason(input.lostReason, LOST_REASONS, "lost"),
    notRelevantReason: nullableReason(input.notRelevantReason, NOT_RELEVANT_REASONS, "not relevant")
  };
}

export function parseOpportunityNote(input: Record<string, unknown>) {
  const body = String(input.body ?? "").trim();
  if (!body) throw new Error("Note is required");
  if (body.length > 4000) throw new Error("Note must be 4000 characters or fewer");
  return { opportunityId: requiredUuid(input.opportunityId), body };
}

export function parseOpportunityNoteUpdate(input: Record<string, unknown>) {
  const note = parseOpportunityNote({ opportunityId: input.noteId, body: input.body });
  return { noteId: note.opportunityId, body: note.body };
}
