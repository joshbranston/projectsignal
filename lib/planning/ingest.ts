import { extractPostcode } from "../scoring.ts";
import type {
  NormalisedPlanningApplication,
  PlanningSourceRecord,
  SavedPlanningApplication
} from "./types.ts";

export function buildPlanningApplicationPayload(
  source: PlanningSourceRecord,
  application: NormalisedPlanningApplication,
  seenAt = new Date().toISOString()
) {
  return {
    council_id: source.councilId,
    planning_source_id: source.id,
    external_reference: application.externalReference,
    address: application.address,
    postcode: application.postcode || (application.address ? extractPostcode(application.address) || null : null),
    latitude: application.latitude,
    longitude: application.longitude,
    proposal: application.proposal,
    application_type: application.applicationType,
    stage: application.stage,
    submitted_at: application.submittedAt,
    validated_at: application.validatedAt,
    decision_at: application.decisionAt,
    decision: application.decision,
    applicant_name: application.applicantName,
    agent_name: application.agentName,
    agent_contact: application.agentContact,
    source_url: application.sourceUrl,
    source_payload: application.rawPayload ?? {},
    last_seen_at: seenAt
  };
}

export async function ingestApplications(
  admin: any,
  source: PlanningSourceRecord,
  applications: NormalisedPlanningApplication[]
): Promise<SavedPlanningApplication[]> {
  if (applications.length === 0) return [];

  const seenAt = new Date().toISOString();
  const payload = applications.map((application) =>
    buildPlanningApplicationPayload(source, application, seenAt)
  );
  const saved: SavedPlanningApplication[] = [];

  for (let index = 0; index < payload.length; index += 500) {
    const { data, error } = await admin
      .from("planning_applications")
      .upsert(payload.slice(index, index + 500), {
        onConflict: "council_id,external_reference"
      })
      .select(
        "id,council_id,external_reference,address,postcode,latitude,longitude,proposal,application_type,stage,submitted_at,validated_at,decision_at,decision,first_seen_at"
      );

    if (error) throw error;
    saved.push(...((data ?? []) as SavedPlanningApplication[]));
  }

  return saved;
}
