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
        <div className="eyebrow">Business setup</div>
        <h2 style={{ marginTop: 8 }}>Choose the territory you want ProjectSignal to watch.</h2>
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
              <label htmlFor="trade_slug">Trade</label>
              <select id="trade_slug" name="trade_slug" defaultValue="windows-doors-bifolds">
                <option value="windows-doors-bifolds">Windows, doors & bifolds</option>
                <option value="builders">Builders</option>
                <option value="roofing">Roofing</option>
                <option value="solar">Solar & battery</option>
                <option value="landscaping">Landscaping</option>
                <option value="architects">Architects</option>
              </select>
            </div>
          </div>

          <CountySelector counties={counties} countyLimit={countyLimit} />

          <div className="grid3 onboarding-preferences-grid">
            <div className="field">
              <label htmlFor="minimum_score">Minimum ProjectSignal score</label>
              <select id="minimum_score" name="minimum_score" defaultValue="7">
                <option value="6">6+ — more opportunities</option>
                <option value="7">7+ — recommended</option>
                <option value="8">8+ — strongest only</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="min_opportunity_gbp">Minimum estimated opportunity</label>
              <select id="min_opportunity_gbp" name="min_opportunity_gbp" defaultValue="5000">
                <option value="0">Any value</option>
                <option value="2500">£2,500+</option>
                <option value="5000">£5,000+</option>
                <option value="10000">£10,000+</option>
                <option value="25000">£25,000+</option>
              </select>
            </div>
          </div>

          <div className="notice">
            Your county choices are reserved during setup and become active after Stripe confirms your £79/month ProjectSignal Pro subscription. Free county swapping is not available during the billing period.
          </div>
          <button className="btn block">Create my ProjectSignal territory</button>
        </form>
      </div>
    </div>
  );
}
