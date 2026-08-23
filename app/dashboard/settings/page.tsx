import { redirect } from "next/navigation";
import { getCompanyContext } from "@/lib/auth";

export default async function SettingsPage() {
  const { company, subscription, territory } = await getCompanyContext();
  if (!company) redirect("/onboarding");

  return (
    <>
      <div className="topbar">
        <div>
          <div className="eyebrow">Account</div>
          <h2 style={{marginTop:5}}>Territory & billing</h2>
        </div>
      </div>

      <div className="grid3" style={{gridTemplateColumns:"1fr 1fr"}}>
        <div className="panel">
          <h3>Territory</h3>
          <p className="muted">Base postcode</p>
          <strong>{territory?.centre_postcode ?? "—"}</strong>
          <p className="muted">Radius</p>
          <strong>{territory?.radius_miles ?? "—"} miles</strong>
          <p className="muted">Minimum score</p>
          <strong>{territory?.minimum_score ?? "—"}+</strong>
        </div>
        <div className="panel">
          <h3>ProjectSignal Pro</h3>
          <p className="muted">Subscription status</p>
          <strong>{subscription?.status ?? "Not configured"}</strong>
          <p className="muted">Price</p>
          <strong>£79/month</strong>
          {subscription?.provider_customer_id ? (
            <form action="/api/billing/portal" method="post" style={{marginTop:20}}>
              <button className="btn secondary">Manage billing</button>
            </form>
          ) : (
            <form action="/api/checkout" method="post" style={{marginTop:20}}>
              <button className="btn">Activate subscription</button>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
