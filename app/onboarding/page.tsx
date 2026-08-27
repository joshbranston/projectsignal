import { redirect } from "next/navigation";
import { getCompanyContext } from "@/lib/auth";
import { getEnglandCountyOptions } from "@/lib/territory/queries";
import { CountySelector } from "@/app/components/county-selector";
import { completeOnboarding } from "./actions";

export default async function OnboardingPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { supabase, membership } = await getCompanyContext();
  if (membership) redirect("/dashboard");

  const [{ data: billingPlan }, counties] = await Promise.all([
    supabase
      .from("billing_plans")
      .select("county_limit")
      .eq("code", "pro")
      .single(),
    getEnglandCountyOptions()
  ]);

  const countyLimit = Number(billingPlan?.county_limit ?? 3);
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : null;

  return (
    <div className="form-shell" style={{ maxWidth: 920 }}>
      <div className="brand">ProjectSignal</div>
      <div className="panel" style={{ marginTop: 24 }}>
        <div className="eyebrow">Set up your opportunity feed</div>
        <h2 style={{ marginTop: 8 }}>Tell us about your business and choose your counties.</h2>
        <p className="muted">
          ProjectSignal Pro includes up to {countyLimit} England counties. Your selected counties become locked subscription territory once payment activates.
        </p>
        {error && <div className="notice error">{error}</div>}

        <form action={completeOnboarding} className="form" style={{ marginTop: 20 }}>
          <div className="grid3 onboarding-address-grid">
            <div className="field">
              <label htmlFor="company_name">Business name</label>
              <input id="company_name" name="company_name" placeholder="ABC Windows Ltd" required />
            </div>
            <div className="field">
              <label htmlFor="address_line_1">Business address</label>
              <input id="address_line_1" name="address_line_1" placeholder="12 Market Street" required />
            </div>
            <div className="field">
              <label htmlFor="address_line_2">Address line 2</label>
              <input id="address_line_2" name="address_line_2" placeholder="Optional" />
            </div>
            <div className="field">
              <label htmlFor="town_city">Town / city</label>
              <input id="town_city" name="town_city" placeholder="Ashby-de-la-Zouch" required />
            </div>
            <div className="field">
              <label htmlFor="postcode">Business postcode</label>
              <input id="postcode" name="postcode" placeholder="LE65 2JF" required />
            </div>
            <div className="field">
              <label>Work type</label>
              <div className="read-only-field">Windows, doors, bifolds, conservatories and residential glazing</div>
            </div>
          </div>

          <CountySelector counties={counties} countyLimit={countyLimit} />

          <div className="notice">
            You will see every qualifying MEDIUM, HIGH and HOT opportunity in these counties. Your choices are reserved now and become active after Stripe confirms your £79/month subscription. County switching is locked during each billing period.
          </div>
          <button className="btn block">Save my business and counties</button>
        </form>
      </div>
    </div>
  );
}
