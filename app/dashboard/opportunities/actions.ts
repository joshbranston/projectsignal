"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  addOpportunityNote,
  deleteOpportunityNote,
  updateOpportunity,
  updateOpportunityNote,
  type OpportunityRpcClient
} from "@/lib/crm/service";

function value(formData: FormData, name: string) {
  return String(formData.get(name) ?? "");
}

function safeReturnId(value: string) {
  return /^[0-9a-f-]{36}$/i.test(value) ? value : null;
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : "The change could not be saved";
  if (/required|valid|characters|zero or greater|supported maximum|reason|outside the active entitlement|unavailable/i.test(message)) {
    return message.slice(0, 180);
  }
  return "The change could not be saved. Please try again.";
}

function destination(opportunityId: string, key: "saved" | "error", message: string) {
  const valid = safeReturnId(opportunityId);
  const base = valid ? `/dashboard/opportunities/${valid}` : "/dashboard/opportunities";
  return `${base}?${key}=${encodeURIComponent(message)}`;
}

export async function updateOpportunityAction(formData: FormData) {
  const opportunityId = value(formData, "opportunity_id");
  let failure: string | null = null;
  try {
    const supabase = await createClient();
    await updateOpportunity(supabase as unknown as OpportunityRpcClient, {
      opportunityId,
      stage: value(formData, "stage"),
      followUpAt: value(formData, "follow_up_at"),
      quoteValueGbp: value(formData, "quote_value_gbp"),
      wonValueGbp: value(formData, "won_value_gbp"),
      lostReason: value(formData, "lost_reason"),
      notRelevantReason: value(formData, "not_relevant_reason")
    });
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/opportunities");
    revalidatePath(`/dashboard/opportunities/${opportunityId}`);
  } catch (error) {
    failure = safeError(error);
  }
  redirect(destination(opportunityId, failure ? "error" : "saved", failure ?? "Opportunity updated"));
}

export async function addOpportunityNoteAction(formData: FormData) {
  const opportunityId = value(formData, "opportunity_id");
  let failure: string | null = null;
  try {
    const supabase = await createClient();
    await addOpportunityNote(supabase as unknown as OpportunityRpcClient, {
      opportunityId,
      body: value(formData, "body")
    });
    revalidatePath(`/dashboard/opportunities/${opportunityId}`);
  } catch (error) {
    failure = safeError(error);
  }
  redirect(destination(opportunityId, failure ? "error" : "saved", failure ?? "Note added"));
}

export async function updateOpportunityNoteAction(formData: FormData) {
  const opportunityId = value(formData, "opportunity_id");
  let failure: string | null = null;
  try {
    const supabase = await createClient();
    await updateOpportunityNote(supabase as unknown as OpportunityRpcClient, {
      noteId: value(formData, "note_id"),
      body: value(formData, "body")
    });
    revalidatePath(`/dashboard/opportunities/${opportunityId}`);
  } catch (error) {
    failure = safeError(error);
  }
  redirect(destination(opportunityId, failure ? "error" : "saved", failure ?? "Note updated"));
}

export async function deleteOpportunityNoteAction(formData: FormData) {
  const opportunityId = value(formData, "opportunity_id");
  let failure: string | null = null;
  try {
    const supabase = await createClient();
    await deleteOpportunityNote(supabase as unknown as OpportunityRpcClient, {
      noteId: value(formData, "note_id")
    });
    revalidatePath(`/dashboard/opportunities/${opportunityId}`);
  } catch (error) {
    failure = safeError(error);
  }
  redirect(destination(opportunityId, failure ? "error" : "saved", failure ?? "Note deleted"));
}
