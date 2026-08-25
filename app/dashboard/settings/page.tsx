import { redirect } from "next/navigation";
import { getCompanyContext } from "@/lib/auth";

function countyFromEntitlement(entitlement: any) {
  const value = entitlement?.county;
  return Array.isArray(value) ? value[0] : value;
}

export default async function SettingsPage() {
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
          <p className="muted">Minimum score</p>
          <strong>{territory?.minimum_score ?? "—"}+</strong>
        </div>

        <div className="panel">
          <h3>ProjectSignal Pro</h3>
          <p className="muted">Subscription status</p>
          <strong>{subscription?.status ?? "Not configured"}</strong>
          <p className="muted">Price</p>
          <strong>£79/month · up to {countyLimit} counties</strong>
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
