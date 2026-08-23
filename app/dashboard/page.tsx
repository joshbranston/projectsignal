import { redirect } from "next/navigation";
import { getCompanyContext, subscriptionAllowsLeads } from "@/lib/auth";
import { updateLeadStatus } from "./actions";

function money(min?: number | null, max?: number | null) {
  if (!min && !max) return "Value not estimated";
  const fmt = (n: number) =>
    n >= 1000 ? `£${Math.round(n / 1000)}k` : `£${n.toLocaleString("en-GB")}`;
  if (min && max) return `${fmt(min)}–${fmt(max)}`;
  return fmt((min || max)!);
}

function countyFromEntitlement(entitlement: any) {
  const value = entitlement?.county;
  return Array.isArray(value) ? value[0] : value;
}

export default async function DashboardPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const {
    supabase,
    company,
    subscription,
    territory,
    companyCounties,
    billingPlan
  } = await getCompanyContext();
  if (!company) redirect("/onboarding");

  const active = subscriptionAllowsLeads(subscription?.status);
  const { data: leadsData } = active
    ? await supabase
        .from("customer_leads")
        .select("*")
        .eq("company_id", company.id)
        .order("matched_at", { ascending: false })
        .limit(30)
    : { data: [] as any[] };

  const leads: any[] = leadsData ?? [];
  const countyNames = (companyCounties ?? [])
    .map((entry: any) => countyFromEntitlement(entry)?.name)
    .filter(Boolean) as string[];
  const countyLimit = Number(billingPlan?.county_limit ?? 3);

  const newCount = leads.filter((l: any) => l.status === "new").length;
  const contacted = leads.filter((l: any) => ["contacted", "quoted", "won"].includes(l.status)).length;
  const won = leads.filter((l: any) => l.status === "won").length;

  const params = await searchParams;
  const territorySummary = countyNames.length
    ? `${countyNames.join(" · ")} · ${countyNames.length} of ${countyLimit} counties`
    : territory
      ? `${territory.centre_postcode} · ${territory.radius_miles} mile legacy radius`
      : "Territory not configured";

  return (
    <>
      <div className="topbar">
        <div>
          <div className="eyebrow">{company.name}</div>
          <h2 style={{ marginTop: 5 }}>Opportunity feed</h2>
          <div className="muted">{territorySummary}</div>
        </div>
        <span className={`pill ${active ? "medium" : "hot"}`}>
          {active ? "PRO ACTIVE" : "SUBSCRIPTION REQUIRED"}
        </span>
      </div>

      {params.checkout === "success" && (
        <div className="notice" style={{ marginBottom: 16 }}>
          Payment received. Stripe is confirming the subscription and activating your county territory automatically.
        </div>
      )}

      {!active ? (
        <div className="panel locked">
          <div className="eyebrow">ProjectSignal Pro</div>
          <h2 style={{ marginTop: 8 }}>Turn on your daily opportunity feed.</h2>
          {countyNames.length > 0 && (
            <div className="territory-chips" style={{ justifyContent: "center", margin: "16px 0" }}>
              {countyNames.map((name) => <span key={name} className="territory-chip">{name}</span>)}
            </div>
          )}
          <p className="muted" style={{ maxWidth: 600, margin: "0 auto 22px" }}>
            Your territory is reserved. Activate ProjectSignal Pro for £79/month to lock these counties into your subscription and unlock matched opportunities.
          </p>
          <form action="/api/checkout" method="post">
            <button className="btn accent">Subscribe for £79/month</button>
          </form>
        </div>
      ) : (
        <>
          <div className="stats">
            <div className="stat"><span className="muted">New</span><strong>{newCount}</strong></div>
            <div className="stat"><span className="muted">In pipeline</span><strong>{contacted}</strong></div>
            <div className="stat"><span className="muted">Won</span><strong>{won}</strong></div>
            <div className="stat"><span className="muted">Minimum score</span><strong>{territory?.minimum_score ?? 7}+</strong></div>
          </div>

          <div className="leads">
            {!leads.length && (
              <div className="panel">
                <h3>No matched opportunities yet</h3>
                <p className="muted">
                  Your account is active. The planning scanner will add projects here when they match your subscribed counties, trade and score settings.
                </p>
              </div>
            )}

            {leads.map((lead: any) => (
              <article key={lead.id} className="dashboard-lead">
                <div>
                  <span className={`pill ${String(lead.priority).toLowerCase()}`}>{lead.score}/10 · {lead.priority}</span>
                  <h3 style={{ marginTop: 9 }}>{lead.title}</h3>
                  <div className="muted" style={{ fontSize: 13 }}>{lead.address || lead.postcode} · {lead.stage || "Planning application"}</div>
                  <p>{lead.proposal}</p>
                  <strong>{money(lead.estimated_value_min_gbp, lead.estimated_value_max_gbp)} opportunity</strong>
                  {lead.why_it_matches && <p className="muted" style={{ fontSize: 13 }}><strong>Why:</strong> {lead.why_it_matches}</p>}
                  {lead.recommended_approach && <p style={{ fontSize: 13 }}><strong>Next move:</strong> {lead.recommended_approach}</p>}
                </div>
                <div>
                  <div className="muted" style={{ fontSize: 12, marginBottom: 7 }}>Status: {lead.status}</div>
                  <div className="actions">
                    {["interested", "contacted", "quoted", "won", "ignored"].map((status) => (
                      <form action={updateLeadStatus} key={status}>
                        <input type="hidden" name="lead_id" value={lead.id} />
                        <input type="hidden" name="status" value={status} />
                        <button>{status[0].toUpperCase() + status.slice(1)}</button>
                      </form>
                    ))}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </>
  );
}
