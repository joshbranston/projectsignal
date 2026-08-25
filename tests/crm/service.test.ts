import assert from "node:assert/strict";
import test from "node:test";
import {
  addOpportunityNote,
  deleteOpportunityNote,
  markOpportunityViewed,
  updateOpportunityNote,
  updateOpportunity,
  type OpportunityRpcClient
} from "../../lib/crm/service.ts";

const opportunityId = "11111111-1111-4111-8111-111111111111";

test("opportunity service validates and persists a complete customer mutation", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client: OpportunityRpcClient = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      return { data: opportunityId, error: null };
    }
  };

  const result = await updateOpportunity(client, {
    opportunityId,
    stage: "quoted",
    followUpAt: "2026-08-30T09:00:00Z",
    quoteValueGbp: "6500",
    wonValueGbp: "",
    lostReason: "",
    notRelevantReason: ""
  });

  assert.equal(result, opportunityId);
  assert.deepEqual(calls, [{
    name: "update_customer_opportunity",
    args: {
      p_opportunity_id: opportunityId,
      p_stage: "quoted",
      p_follow_up_at: "2026-08-30T09:00:00.000Z",
      p_quote_value_gbp: 6500,
      p_won_value_gbp: null,
      p_lost_reason: null,
      p_not_relevant_reason: null
    }
  }]);
});

test("opportunity service surfaces authorization or persistence failure and never reports success", async () => {
  const client: OpportunityRpcClient = {
    rpc: async () => ({ data: null, error: { message: "outside the active entitlement" } })
  };

  await assert.rejects(
    updateOpportunity(client, {
      opportunityId,
      stage: "reviewing",
      followUpAt: "",
      quoteValueGbp: "",
      wonValueGbp: "",
      lostReason: "",
      notRelevantReason: ""
    }),
    /outside the active entitlement/
  );
});

test("note service validates content before calling the entitlement-checked RPC", async () => {
  let calls = 0;
  const client: OpportunityRpcClient = {
    rpc: async () => {
      calls += 1;
      return { data: "22222222-2222-4222-8222-222222222222", error: null };
    }
  };

  await assert.rejects(addOpportunityNote(client, { opportunityId, body: " " }), /Note is required/);
  assert.equal(calls, 0);
  assert.equal(
    await addOpportunityNote(client, { opportunityId, body: " Called the agent. " }),
    "22222222-2222-4222-8222-222222222222"
  );
  assert.equal(calls, 1);
});

test("note edit/delete and viewed mutations require valid IDs and surface database rejection", async () => {
  const noteId = "22222222-2222-4222-8222-222222222222";
  const calls: string[] = [];
  const client: OpportunityRpcClient = {
    rpc: async (name) => {
      calls.push(name);
      if (name === "delete_customer_opportunity_note") {
        return { data: null, error: { message: "outside the active entitlement" } };
      }
      return { data: name.includes("note") ? noteId : opportunityId, error: null };
    }
  };

  assert.equal(await updateOpportunityNote(client, { noteId, body: "Updated note" }), noteId);
  await assert.rejects(deleteOpportunityNote(client, { noteId }), /outside the active entitlement/);
  assert.equal(await markOpportunityViewed(client, { opportunityId }), opportunityId);
  await assert.rejects(markOpportunityViewed(client, { opportunityId: "not-an-id" }), /valid UUID/);
  assert.deepEqual(calls, [
    "update_customer_opportunity_note",
    "delete_customer_opportunity_note",
    "mark_customer_opportunity_viewed"
  ]);
});
