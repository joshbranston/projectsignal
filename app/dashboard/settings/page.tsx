import { redirect } from "next/navigation";
import { getCompanyContext } from "@/lib/auth";

function date(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "long" }).format(parsed);
}

function priorityThreshold(value?: number | string | null) {
  const score = Number(value ?? 0);
  if (score >= 8.5) return "HOT only";
  if (score >= 7) return "HIGH and HOT";
  return "MEDIUM, HIGH and HOT";
}

function countyFromEntitlement(entitlement: any) {
  const value = entitlement?.county;
  return Array.isArray(value) ? value[0] : value;
}

export default async function SettingsPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const { company, subscription, territory, companyCounties, billingPlan } = await getCompanyContext();
  if (!company) redirect("/onboarding");

  const countyLimit = Number(billingPlan?.county_limit ?? 3);
  const counties = (companyCounties ?? []).map((entry: any) => ({
    ...entry,
    county: countyFromEntitlement(entry)
  }));

  return (
    <>
      <div className="topbar">
        <div>
          <div className="eyebrow">Account</div>
          <h2 style={{ marginTop: 5 }}>Territory & billing</h2>
        </div>
      </div>

      {query.billing === "unavailable" && (
        <div className="notice error" style={{ marginBottom: 16 }}>Billing management is temporarily unavailable. Please try again.</div>
      )}

      <div className="grid3 settings-grid">
        <div className="panel">
          <h3>Subscription territory</h3>
          {counties.length ? (
            <>
              <p className="muted">{counties.length} of {countyLimit} included counties</p>
              <div className="territory-chips" style={{ margin: "14px 0" }}>
                {counties.map((entry: any) => (
                  <span className="territory-chip" key={entry.id}>
                    {entry.county?.name ?? "County"} · {entry.status}
                  </span>
                ))}
              </div>
              <div className="notice">
                Your active counties are locked for the billing period. Replacements/removals will be scheduled for renewal. Adding territory above your plan allowance will require a paid subscription change.
              </div>
            </>
          ) : (
            <>
              <p className="muted">Legacy territory</p>
              <strong>{territory?.centre_postcode ?? "—"}</strong>
              <p className="muted">Radius</p>
              <strong>{territory?.radius_miles ?? "—"} miles</strong>
              <div className="notice" style={{ marginTop: 16 }}>
                This account predates county territories. A one-time county setup will be added before county matching replaces the legacy radius.
              </div>
            </>
          )}
          <p className="muted">Opportunity feed</p>
          <strong>{priorityThreshold(territory?.minimum_score)}</strong>
        </div>

        <div className="panel">
          <h3>ProjectSignal Pro</h3>
          <p className="muted">Subscription status</p>
          <strong>{subscription?.status ?? "Not configured"}</strong>
          <p className="muted">Price</p>
          <strong>£79/month · up to {countyLimit} counties</strong>
          {subscription?.current_period_ends_at && (
            <>
              <p className="muted">{subscription.cancel_at_period_end ? "Access until" : "Next billing date"}</p>
              <strong>{date(subscription.current_period_ends_at)}</strong>
            </>
          )}
          {subscription?.cancel_at_period_end && (
            <div className="notice" style={{ marginTop: 16 }}>Your subscription is set to cancel at the end of this billing period. Access remains active until the date shown above.</div>
          )}
          {!billingPlan?.additional_county_price_id && (
            <p className="muted small-text">Additional counties are not yet available for self-service purchase.</p>
          )}
          {subscription?.provider_customer_id ? (
            <form action="/api/billing/portal" method="post" style={{ marginTop: 20 }}>
              <button className="btn secondary">Manage billing</button>
            </form>
          ) : (
            <form action="/api/checkout" method="post" style={{ marginTop: 20 }}>
              <button className="btn">Activate subscription</button>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
