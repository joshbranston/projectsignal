"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { validateInitialCountySelection } from "@/lib/territory/entitlements";

export async function claimInitialCountyTerritory(formData: FormData) {
  const supabase = await createClient();
  const requestedCounties = formData.getAll("county_slugs").map((value) => String(value));

  const { data: billingPlan } = await supabase
    .from("billing_plans")
    .select("county_limit")
    .eq("code", "pro")
    .single();

  const countyLimit = Number(billingPlan?.county_limit ?? 3);
  const selection = validateInitialCountySelection(requestedCounties, countyLimit);

  if (!selection.ok) {
    redirect(`/dashboard/territory?error=${encodeURIComponent(selection.error)}`);
  }

  const { error } = await supabase.rpc("set_existing_company_initial_counties", {
    p_county_slugs: selection.countySlugs
  });

  if (error) {
    redirect(`/dashboard/territory?error=${encodeURIComponent(error.message)}`);
  }

  redirect("/dashboard/territory?success=1");
}
