"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function updateLeadStatus(formData: FormData) {
  const leadId = String(formData.get("lead_id") ?? "");
  const status = String(formData.get("status") ?? "new");

  const allowed = new Set(["new", "interested", "contacted", "quoted", "won", "ignored"]);
  if (!allowed.has(status) || !leadId) return;

  const supabase = await createClient();
  await supabase.rpc("set_customer_lead_status", {
    p_lead_id: leadId,
    p_status: status
  });
  revalidatePath("/dashboard");
}
