import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function requireUser() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (error || !claims?.sub) {
    redirect("/login");
  }

  return { supabase, claims };
}

export async function getCompanyContext() {
  const { supabase, claims } = await requireUser();

  const { data: membership } = await supabase
    .from("company_members")
    .select("company_id, role")
    .eq("user_id", claims.sub)
    .maybeSingle();

  if (!membership) {
    return { supabase, claims, membership: null, company: null, subscription: null, territory: null };
  }

  const [{ data: company }, { data: subscription }, { data: territory }] =
    await Promise.all([
      supabase.from("companies").select("*").eq("id", membership.company_id).single(),
      supabase.from("subscriptions").select("*").eq("company_id", membership.company_id).maybeSingle(),
      supabase.from("territories").select("*").eq("company_id", membership.company_id).eq("active", true).maybeSingle()
    ]);

  return { supabase, claims, membership, company, subscription, territory };
}

export function subscriptionAllowsLeads(status?: string | null) {
  return status === "active" || status === "trialing";
}
