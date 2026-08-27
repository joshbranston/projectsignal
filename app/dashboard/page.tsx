import Link from "next/link";
import { redirect } from "next/navigation";
import { getCompanyContext, subscriptionAllowsLeads } from "@/lib/auth";
import {
  CUSTOMER_OPPORTUNITY_SELECT,
  isCrmSchemaUnavailableError,
  normaliseCustomerOpportunityRow
} from "@/lib/crm/data";
import { calculatePipelineMetrics, classifyFollowUp, sortCustomerOpportunities } from "@/lib/crm/opportunities";
import { formatGbp } from "@/lib/crm/presentation";
import { OpportunityCard } from "./opportunities/opportunity-card";

function countyFromEntitlement(entitlement: any) {
  return Array.isArray(entitlement?.county) ? entitlement.county[0] : entitlement?.county;
}

function subscriptionCostToDate(subscription: any, now = new Date()) {
  const monthly = Number(subscription?.price_gbp_pence ?? 0) / 100;
  const started = new Date(subscription?.created_at ?? now);
  if (!monthly || !Number.isFinite(started.getTime())) return 0;
  const months = Math.max(1, (now.getUTCFullYear() - started.getUTCFullYear()) * 12 + now.getUTCMonth() - started.getUTCMonth() + 1);
  return monthly * months;
}

function estimatedRange(lead: any) {
  const minimum = Number(lead?.estimated_value_min_gbp);
  const maximum = Number(lead?.estimated_value_max_gbp);
  if (!Number.isFinite(minimum) && !Number.isFinite(maximum)) return "Value not estimated";
  if (Number.isFinite(minimum) && Number.isFinite(maximum)) return `${formatGbp(minimum)}–${formatGbp(maximum)}`;
  return formatGbp(Number.isFinite(minimum) ? minimum : maximum);
}

function LegacyOpportunityFeed({
  companyName,
  territorySummary,
  query,
  leads
}: {
  companyName: string;
  territorySummary: string;
  query: Record<string, string | string[] | undefined>;
  leads: any[];
}) {
  return (
    <>
      <div className="topbar">
        <div>
          <div className="eyebrow">{companyName}</div>
          <h2>Opportunity feed</h2>
          <div className="muted">{territorySummary}</div>
        </div>
      </div>
      {query.checkout === "success" && (
        <div className="notice success">Welcome to ProjectSignal. Stripe is confirming your subscription and preparing up to 30 days of recent opportunities in your counties.</div>
      )}
      {query.checkout === "cancelled" && (
        <div className="notice">Checkout was cancelled. Your card was not charged and your county choices remain reserved.</div>
      )}
      <div className="notice" role="status">
        The opportunity manager database upgrade is pending. Your existing opportunity feed remains available read-only.
      </div>
      <div className="leads">
        {!leads.length && (
          <div className="panel">
            <h3>No opportunities match yet</h3>
            <p className="muted">We checked the last 30 days and will keep monitoring your counties every day.</p>
          </div>
        )}
        {leads.map((lead) => (
          <article key={lead.id} className="dashboard-lead">
            <div>
              <span className={`pill ${String(lead.priority ?? "LOW").toLowerCase()}`}>
                {lead.priority}
              </span>
              <h3 style={{ marginTop: 9 }}>{lead.title}</h3>
              <div className="muted" style={{ fontSize: 13 }}>
                {lead.address || lead.postcode || "Address unavailable"} · {lead.stage || "Planning application"}
              </div>
              <p>{lead.proposal}</p>
              <strong>{estimatedRange(lead)} opportunity</strong>
              {lead.why_it_matches && <p className="muted" style={{ fontSize: 13 }}><strong>Why:</strong> {lead.why_it_matches}</p>}
              {lead.recommended_approach && <p style={{ fontSize: 13 }}><strong>Next move:</strong> {lead.recommended_approach}</p>}
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

export default async function DashboardPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [query, context] = await Promise.all([searchParams, getCompanyContext()]);
  const { supabase, company, subscription, territory, companyCounties, billingPlan } = context;
  if (!company) redirect("/onboarding");
  const active = subscriptionAllowsLeads(subscription?.status);
  const countyNames = (companyCounties ?? []).map(countyFromEntitlement).map((county: any) => county?.name).filter(Boolean) as string[];
  const countyLimit = Number(billingPlan?.county_limit ?? 3);

  const result = active
    ? await supabase
        .from("customer_leads")
        .select(CUSTOMER_OPPORTUNITY_SELECT)
        .eq("company_id", company.id)
        .order("score", { ascending: false })
        .limit(2000)
    : { data: [], error: null };
  const territorySummary = countyNames.length
    ? `${countyNames.join(" · ")} · ${countyNames.length} of ${countyLimit} counties`
    : territory
      ? `${territory.centre_postcode} · ${territory.radius_miles} mile legacy radius`
      : "Territory not configured";

  if (result.error && isCrmSchemaUnavailableError(result.error)) {
    const { data: legacyLeads, error: legacyError } = await supabase
      .from("customer_leads")
      .select("id,status,priority,score,title,address,postcode,stage,proposal,estimated_value_min_gbp,estimated_value_max_gbp,why_it_matches,recommended_approach,matched_at")
      .eq("company_id", company.id)
      .order("matched_at", { ascending: false })
      .limit(30);
    if (legacyError) throw new Error(`Could not load legacy dashboard opportunities: ${legacyError.message}`);
    return <LegacyOpportunityFeed companyName={company.name} territorySummary={territorySummary} query={query} leads={legacyLeads ?? []} />;
  }
  if (result.error) throw new Error(`Could not load dashboard opportunities: ${result.error.message}`);
  const opportunities = sortCustomerOpportunities((result.data ?? []).map(normaliseCustomerOpportunityRow));
  const metrics = calculatePipelineMetrics(opportunities, subscriptionCostToDate(subscription));
  const followUpsDue = opportunities.filter((item) => ["overdue", "today"].includes(classifyFollowUp(item.followUpAt))).length;
  const newHighValue = opportunities.filter((item) => item.status === "new" && ["HOT", "HIGH"].includes(item.priority)).slice(0, 5);
  const now = new Date();
  const wonThisMonth = opportunities
    .filter((item) => {
      if (item.status !== "won" || !item.wonAt) return false;
      const won = new Date(item.wonAt);
      return won.getUTCFullYear() === now.getUTCFullYear() && won.getUTCMonth() === now.getUTCMonth();
    })
    .reduce((total, item) => total + (item.wonValueGbp ?? 0), 0);

  return (
    <>
      <div className="topbar">
        <div>
          <div className="eyebrow">{company.name}</div>
          <h2>What should I do today?</h2>
          <div className="muted">{territorySummary}</div>
        </div>
        <Link className="btn" href="/dashboard/opportunities">Open opportunity manager</Link>
      </div>

      {query.checkout === "success" && (
        <div className="notice success">Welcome to ProjectSignal. Stripe is confirming your subscription and preparing up to 30 days of recent opportunities in your counties.</div>
      )}
      {query.checkout === "cancelled" && (
        <div className="notice">Checkout was cancelled. Your card was not charged and your county choices remain reserved.</div>
      )}

      {!active ? (
        <div className="panel locked">
          <div className="eyebrow">ProjectSignal Pro</div>
          <h2>Turn on your daily opportunity feed.</h2>
          <p className="muted">Your territory is reserved. Activate ProjectSignal Pro to receive and manage matched opportunities.</p>
          {query.checkout === "success" ? (
            <Link className="btn secondary" href="/dashboard">Refresh subscription status</Link>
          ) : (
            <form action="/api/checkout" method="post"><button className="btn accent">Subscribe for £79/month</button></form>
          )}
        </div>
      ) : (
        <>
          <div className="stats crm-stats">
            <Link className="stat" href="/dashboard/opportunities?stage=new"><span className="muted">New Opportunities</span><strong>{opportunities.filter((item) => item.status === "new").length}</strong></Link>
            <Link className="stat" href="/dashboard/opportunities?followUp=due"><span className="muted">Follow Ups Due</span><strong>{followUpsDue}</strong></Link>
            <Link className="stat" href="/dashboard/opportunities?stage=quoted"><span className="muted">Quoted Pipeline</span><strong>{formatGbp(metrics.quotePipelineGbp)}</strong></Link>
            <Link className="stat" href="/dashboard/opportunities?stage=won"><span className="muted">Won This Month</span><strong>{formatGbp(wonThisMonth)}</strong></Link>
          </div>

          <div className="dashboard-grid">
            <section className="panel">
              <h3>Pipeline</h3>
              <dl className="metric-list">
                <div><dt>Opportunities delivered</dt><dd>{metrics.delivered}</dd></div>
                <div><dt>Reviewed</dt><dd>{metrics.reviewed}</dd></div>
                <div><dt>Contacted</dt><dd>{metrics.contacted}</dd></div>
                <div><dt>Quoted</dt><dd>{metrics.quoted}</dd></div>
                <div><dt>Won</dt><dd>{metrics.won}</dd></div>
              </dl>
            </section>
            <section className="panel">
              <h3>Customer ROI</h3>
              <dl className="metric-list">
                <div><dt>Customer quote pipeline</dt><dd>{formatGbp(metrics.quotePipelineGbp)}</dd></div>
                <div><dt>Confirmed won value</dt><dd>{formatGbp(metrics.wonValueGbp)}</dd></div>
                <div><dt>ROI multiple</dt><dd>{metrics.roiMultiple === null ? "Not available" : `${metrics.roiMultiple}×`}</dd></div>
                <div><dt>Contacted → Quoted</dt><dd>{metrics.contactedToQuotedPercent === null ? "—" : `${metrics.contactedToQuotedPercent}%`}</dd></div>
                <div><dt>Quoted → Won</dt><dd>{metrics.quotedToWonPercent === null ? "—" : `${metrics.quotedToWonPercent}%`}</dd></div>
              </dl>
              <p className="muted small-text">ROI uses confirmed Won value only. Estimated opportunity value is not treated as revenue.</p>
            </section>
          </div>

          <div className="section-heading"><div><h3>New high-value opportunities</h3><p className="muted">Start here, then work through follow-ups.</p></div><Link href="/dashboard/opportunities?stage=new">View all new</Link></div>
          <div className="opportunity-list">
            {!newHighValue.length && <div className="panel"><h3>No new high-value opportunities</h3><p className="muted">You are caught up. Check follow-ups or all opportunities.</p></div>}
            {newHighValue.map((opportunity) => <OpportunityCard key={opportunity.id} opportunity={opportunity} />)}
          </div>
        </>
      )}
    </>
  );
}
