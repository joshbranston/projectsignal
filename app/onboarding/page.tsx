import { redirect } from "next/navigation";
import { getCompanyContext } from "@/lib/auth";
import { completeOnboarding } from "./actions";

export default async function OnboardingPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { membership } = await getCompanyContext();
  if (membership) redirect("/dashboard");

  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : null;

  return (
    <div className="form-shell" style={{maxWidth:600}}>
      <div className="brand">ProjectSignal</div>
      <div className="panel" style={{marginTop:24}}>
        <div className="eyebrow">Business setup</div>
        <h2 style={{marginTop:8}}>Tell us what a good opportunity looks like.</h2>
        <p className="muted">We&apos;ll use this to decide which planning applications reach you.</p>
        {error && <div className="notice error">{error}</div>}

        <form action={completeOnboarding} className="form" style={{marginTop:20}}>
          <div className="field">
            <label htmlFor="company_name">Business name</label>
            <input id="company_name" name="company_name" placeholder="ABC Windows Ltd" required />
          </div>
          <div className="field">
            <label htmlFor="postcode">Base postcode</label>
            <input id="postcode" name="postcode" placeholder="LE65 1AA" required />
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
          <div className="field">
            <label htmlFor="radius_miles">Search radius</label>
            <select id="radius_miles" name="radius_miles" defaultValue="25">
              <option value="10">10 miles</option>
              <option value="15">15 miles</option>
              <option value="25">25 miles</option>
              <option value="40">40 miles</option>
              <option value="60">60 miles</option>
            </select>
          </div>
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

          <div className="notice">
            Your account is created first. The dashboard then sends you to secure Stripe Checkout for the £79/month ProjectSignal Pro subscription.
          </div>
          <button className="btn block">Create my territory</button>
        </form>
      </div>
    </div>
  );
}
