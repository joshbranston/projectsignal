export interface NormalisedPlanningApplication {
  externalReference: string;
  address: string | null;
  postcode: string | null;
  latitude: number | null;
  longitude: number | null;
  proposal: string;
  applicationType: string | null;
  stage: string | null;
  submittedAt: string | null;
  validatedAt: string | null;
  decisionAt: string | null;
  decision: string | null;
  applicantName: string | null;
  agentName: string | null;
  agentContact: string | null;
  sourceUrl: string | null;
  rawPayload: unknown;
}

export type PlanningApplicationField =
  | "externalReference"
  | "address"
  | "postcode"
  | "latitude"
  | "longitude"
  | "proposal"
  | "applicationType"
  | "stage"
  | "submittedAt"
  | "validatedAt"
  | "decisionAt"
  | "decision"
  | "applicantName"
  | "agentName"
  | "agentContact"
  | "sourceUrl";

export type PlanningSourceConfig = {
  fields?: Partial<Record<PlanningApplicationField, string>>;
  requestHeaders?: Record<string, string>;
  lookbackDays?: number;
  maxPages?: number;
  searchDateField?: "validated" | "received";
  provider?: string;
  authority?: string;
  pageSize?: number;
};

export interface PlanningSourceRecord {
  id: string;
  councilId: string;
  councilSlug: string;
  councilName: string;
  slug: string;
  adapter: string;
  endpointUrl: string;
  format: string | null;
  config: PlanningSourceConfig;
  priority?: number;
  scanEveryMinutes?: number;
  consecutiveFailures?: number;
  lastScannedAt?: string | null;
  lastSuccessAt?: string | null;
  nextScanAt?: string | null;
}

export type SavedPlanningApplication = {
  id: string;
  council_id: string;
  external_reference: string;
  address: string | null;
  postcode: string | null;
  latitude: number | null;
  longitude: number | null;
  proposal: string;
  application_type?: string | null;
  stage: string | null;
  submitted_at?: string | null;
  validated_at?: string | null;
  decision_at?: string | null;
  decision?: string | null;
  first_seen_at?: string | null;
};
