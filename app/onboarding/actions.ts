"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { geocodePostcode } from "@/lib/postcodes";

export async function completeOnboarding(formData: FormData) {
  const supabase = await createClient();

  const companyName = String(formData.get("company_name") ?? "").trim();
  const postcode = String(formData.get("postcode") ?? "").trim();
  const tradeSlug = String(formData.get("trade_slug") ?? "windows-doors-bifolds");
  const radiusMiles = Number(formData.get("radius_miles") ?? 25);
  const minimumScore = Number(formData.get("minimum_score") ?? 7);
  const minOpportunity = Number(formData.get("min_opportunity_gbp") ?? 5000);

  const { data: companyId, error } = await supabase.rpc("create_customer_company", {
    p_company_name: companyName,
    p_postcode: postcode,
    p_trade_slug: tradeSlug,
    p_radius_miles: radiusMiles,
    p_minimum_score: minimumScore,
    p_min_opportunity_gbp: minOpportunity
  });

  if (error || !companyId) {
    redirect(`/onboarding?error=${encodeURIComponent(error?.message ?? "Unable to create the company")}`);
  }

  try {
    const coords = await geocodePostcode(postcode);
    if (coords) {
      await supabase
        .from("territories")
        .update({
          centre_latitude: coords.latitude,
          centre_longitude: coords.longitude
        })
        .eq("company_id", companyId);
    }
  } catch {
    // The scanner can retry territory geocoding later.
  }

  redirect("/dashboard?onboarding=complete");
}
