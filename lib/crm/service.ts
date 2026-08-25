import {
  parseOpportunityId,
  parseOpportunityMutation,
  parseOpportunityNote,
  parseOpportunityNoteUpdate
} from "./domain.ts";

export type OpportunityRpcResult = {
  data: unknown;
  error: { message?: string } | null;
};

export type OpportunityRpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<OpportunityRpcResult>;
};

function rpcFailure(error: { message?: string } | null) {
  const message = String(error?.message ?? "Opportunity update failed")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim();
  return new Error(message || "Opportunity update failed");
}

export async function updateOpportunity(
  client: OpportunityRpcClient,
  input: Record<string, unknown>
) {
  const mutation = parseOpportunityMutation(input);
  const { data, error } = await client.rpc("update_customer_opportunity", {
    p_opportunity_id: mutation.opportunityId,
    p_stage: mutation.stage,
    p_follow_up_at: mutation.followUpAt,
    p_quote_value_gbp: mutation.quoteValueGbp,
    p_won_value_gbp: mutation.wonValueGbp,
    p_lost_reason: mutation.lostReason,
    p_not_relevant_reason: mutation.notRelevantReason
  });
  if (error) throw rpcFailure(error);
  if (!data) throw new Error("Opportunity update did not return an ID");
  return String(data);
}

export async function addOpportunityNote(
  client: OpportunityRpcClient,
  input: Record<string, unknown>
) {
  const note = parseOpportunityNote(input);
  const { data, error } = await client.rpc("add_customer_opportunity_note", {
    p_opportunity_id: note.opportunityId,
    p_body: note.body
  });
  if (error) throw rpcFailure(error);
  if (!data) throw new Error("Note creation did not return an ID");
  return String(data);
}

export async function updateOpportunityNote(
  client: OpportunityRpcClient,
  input: Record<string, unknown>
) {
  const note = parseOpportunityNoteUpdate(input);
  const { data, error } = await client.rpc("update_customer_opportunity_note", {
    p_note_id: note.noteId,
    p_body: note.body
  });
  if (error) throw rpcFailure(error);
  if (!data) throw new Error("Note update did not return an ID");
  return String(data);
}

export async function deleteOpportunityNote(
  client: OpportunityRpcClient,
  input: Record<string, unknown>
) {
  const noteId = parseOpportunityId(input.noteId);
  const { data, error } = await client.rpc("delete_customer_opportunity_note", {
    p_note_id: noteId
  });
  if (error) throw rpcFailure(error);
  if (!data) throw new Error("Note deletion did not return an ID");
  return String(data);
}

export async function markOpportunityViewed(
  client: OpportunityRpcClient,
  input: Record<string, unknown>
) {
  const opportunityId = parseOpportunityId(input.opportunityId);
  const { data, error } = await client.rpc("mark_customer_opportunity_viewed", {
    p_opportunity_id: opportunityId
  });
  if (error) throw rpcFailure(error);
  if (!data) throw new Error("Opportunity view did not return an ID");
  return String(data);
}
