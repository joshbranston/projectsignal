import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { subscriptionAllowsNewLeads } from "@/lib/territory/entitlements";

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
    return {
      supabase,
      claims,
      membership: null,
      company: null,
      subscription: null,
      territory: null,
      companyCounties: [] as any[],
      billingPlan: null
    };
  }

  const [
    { data: company },
    { data: subscription },
    { data: territory },
    { data: companyCounties },
    { data: billingPlan }
  ] = await Promise.all([
    supabase.from("companies").select("*").eq("id", membership.company_id).single(),
    supabase.from("subscriptions").select("*").eq("company_id", membership.company_id).maybeSingle(),
    supabase.from("territories").select("*").eq("company_id", membership.company_id).eq("active", true).maybeSingle(),
    supabase
      .from("company_counties")
      .select("id,company_id,county_id,status,starts_at,ends_at,locked_until,county:counties(id,slug,name,nation)")
      .eq("company_id", membership.company_id)
      .in("status", ["active", "scheduled", "ending"])
      .order("created_at", { ascending: true }),
    supabase
      .from("billing_plans")
      .select("code,name,county_limit,additional_county_price_id,additional_county_price_gbp_pence")
      .eq("code", "pro")
      .maybeSingle()
  ]);

  return {
    supabase,
    claims,
    membership,
    company,
    subscription,
    territory,
    companyCounties: companyCounties ?? [],
    billingPlan
  };
}

export function subscriptionAllowsLeads(status?: string | null) {
  return subscriptionAllowsNewLeads(status);
}
