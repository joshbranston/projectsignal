"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { geocodePostcode } from "@/lib/postcodes";
import { validateInitialCountySelection } from "@/lib/territory/entitlements";

export async function completeOnboarding(formData: FormData) {
  const supabase = await createClient();

  const companyName = String(formData.get("company_name") ?? "").trim();
  const addressLine1 = String(formData.get("address_line_1") ?? "").trim();
  const addressLine2 = String(formData.get("address_line_2") ?? "").trim();
  const townCity = String(formData.get("town_city") ?? "").trim();
  const postcode = String(formData.get("postcode") ?? "").trim();
  const tradeSlug = String(formData.get("trade_slug") ?? "windows-doors-bifolds");
  const minimumScore = Number(formData.get("minimum_score") ?? 7);
  const minOpportunity = Number(formData.get("min_opportunity_gbp") ?? 5000);
  const requestedCounties = formData.getAll("county_slugs").map((value) => String(value));

  const { data: billingPlan } = await supabase
    .from("billing_plans")
    .select("county_limit")
    .eq("code", "pro")
    .single();

  const countyLimit = Number(billingPlan?.county_limit ?? 3);
  const selection = validateInitialCountySelection(requestedCounties, countyLimit);

  if (!selection.ok) {
    redirect(`/onboarding?error=${encodeURIComponent(selection.error)}`);
  }

  const { data: companyId, error } = await supabase.rpc(
    "create_customer_company_with_counties",
    {
      p_company_name: companyName,
      p_address_line_1: addressLine1,
      p_address_line_2: addressLine2,
      p_town_city: townCity,
      p_postcode: postcode,
      p_county_slugs: selection.countySlugs,
      p_trade_slug: tradeSlug,
      p_radius_miles: 25,
      p_minimum_score: minimumScore,
      p_min_opportunity_gbp: minOpportunity
    }
  );

  if (error || !companyId) {
    redirect(
      `/onboarding?error=${encodeURIComponent(
        error?.message ?? "Unable to create the company"
      )}`
    );
  }

  try {
    const coords = await geocodePostcode(postcode);

    if (coords) {
      const admin = createAdminClient();
      await Promise.all([
        admin
          .from("companies")
          .update({
            latitude: coords.latitude,
            longitude: coords.longitude
          })
          .eq("id", companyId),
        admin
          .from("territories")
          .update({
            centre_latitude: coords.latitude,
            centre_longitude: coords.longitude
          })
          .eq("company_id", companyId)
      ]);
    }
  } catch {
    // Postcode coordinates can be retried later without blocking signup.
  }

  redirect("/dashboard?onboarding=complete");
}
