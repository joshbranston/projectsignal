import Link from "next/link";
import { redirect } from "next/navigation";
import { getCompanyContext, subscriptionAllowsLeads } from "@/lib/auth";
import {
  CUSTOMER_OPPORTUNITY_SELECT,
  isCrmSchemaUnavailableError,
  normaliseCustomerOpportunityRow,
  type CustomerOpportunityDetail
} from "@/lib/crm/data";
import { CRM_STAGES } from "@/lib/crm/domain";
import { filterCustomerOpportunities, sortCustomerOpportunities } from "@/lib/crm/opportunities";
import { parseOpportunityFilters, stageLabel } from "@/lib/crm/presentation";
import { OpportunityCard } from "./opportunity-card";

const PAGE_SIZE = 20;
const READ_LIMIT = 2000;

function queryWithPage(
  query: Record<string, string | string[] | undefined>,
  page: number
) {
  const params = new URLSearchParams();
  for (const [key, raw] of Object.entries(query)) {
    if (key === "page") continue;
    for (const value of Array.isArray(raw) ? raw : raw ? [raw] : []) params.append(key, value);
  }
  params.set("page", String(page));
  return `?${params.toString()}`;
}

export default async function OpportunitiesPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const { filters, page: requestedPage } = parseOpportunityFilters(query);
  const { supabase, company, subscription } = await getCompanyContext();
  if (!company) redirect("/onboarding");

  if (!subscriptionAllowsLeads(subscription?.status)) {
    return (
      <div className="panel locked">
        <h2>Opportunity manager locked</h2>
        <p className="muted">Activate ProjectSignal Pro to manage opportunities in your subscribed counties.</p>
      </div>
    );
  }

  const { data, error, count } = await supabase
    .from("customer_leads")
    .select(CUSTOMER_OPPORTUNITY_SELECT, { count: "exact" })
    .eq("company_id", company.id)
    .order("score", { ascending: false })
    .limit(READ_LIMIT);
  if (error && isCrmSchemaUnavailableError(error)) {
    return (
      <div className="panel locked" role="status">
        <h2>Opportunity manager upgrade pending</h2>
        <p className="muted">Your existing opportunities remain available from Today while the CRM database upgrade is completed.</p>
        <Link className="btn" href="/dashboard">Return to Today</Link>
      </div>
    );
  }
  if (error) throw new Error(`Could not load opportunities: ${error.message}`);

  const all = (data ?? []).map(normaliseCustomerOpportunityRow);
  const filtered = sortCustomerOpportunities(filterCustomerOpportunities(all, filters));
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(requestedPage, pageCount);
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const counties = [...new Set(all.flatMap((item) => item.countyNames))].sort();
  const councils = [...new Set(all.map((item) => item.councilName))].sort();
  const applicationTypes = [...new Set(all.map((item) => item.applicationType).filter(Boolean) as string[])].sort();

  return (
    <>
      <div className="topbar">
        <div>
          <div className="eyebrow">Customer opportunity manager</div>
          <h2>Opportunities</h2>
          <div className="muted">{filtered.length} matching · {all.length} loaded</div>
        </div>
        <Link href="/dashboard" className="btn secondary">Pipeline overview</Link>
      </div>

      {(count ?? 0) > READ_LIMIT && (
        <div className="notice error" role="alert">This account has more than {READ_LIMIT} opportunities. Refine the view while database-native archive pagination is completed.</div>
      )}

      <nav className="quick-views" aria-label="Opportunity quick views">
        <Link href="/dashboard/opportunities?stage=new">New Opportunities</Link>
        <Link href="/dashboard/opportunities?stage=reviewing">Needs Review</Link>
        <Link href="/dashboard/opportunities?followUp=due">Follow Ups</Link>
        <Link href="/dashboard/opportunities?stage=quoted">Quoted</Link>
        <Link href="/dashboard/opportunities?stage=won">Won</Link>
        <Link href="/dashboard/opportunities?stage=lost">Lost</Link>
        <Link href="/dashboard/opportunities?stage=not_relevant">Not Relevant</Link>
        <Link href="/dashboard/opportunities">All Opportunities</Link>
      </nav>

      <form className="opportunity-filters" method="get" aria-label="Filter opportunities">
        <label>Search<input name="q" defaultValue={filters.search} placeholder="Reference, postcode, address, proposal" /></label>
        <label>Stage<select name="stage" defaultValue={filters.stages?.[0] ?? ""}>
          <option value="">All stages</option>
          {CRM_STAGES.map((stage) => <option key={stage} value={stage}>{stageLabel(stage)}</option>)}
        </select></label>
        <label>Priority<select name="priority" defaultValue={filters.priorities?.[0] ?? ""}>
          <option value="">All priorities</option>
          {(["HOT", "HIGH", "MEDIUM", "LOW"] as const).map((priority) => <option key={priority}>{priority}</option>)}
        </select></label>
        <label>Date<select name="date" defaultValue={filters.date ?? ""}>
          <option value="">Any date</option><option value="today">Today</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option>
        </select></label>
        <label>County<select name="county" defaultValue={filters.county ?? ""}>
          <option value="">All counties</option>{counties.map((county) => <option key={county}>{county}</option>)}
        </select></label>
        <label>Council<select name="council" defaultValue={filters.council ?? ""}>
          <option value="">All councils</option>{councils.map((council) => <option key={council}>{council}</option>)}
        </select></label>
        <label>Application type<select name="applicationType" defaultValue={filters.applicationType ?? ""}>
          <option value="">All types</option>{applicationTypes.map((type) => <option key={type}>{type}</option>)}
        </select></label>
        <label>Follow-up<select name="followUp" defaultValue={filters.followUp ?? ""}>
          <option value="">Any follow-up</option><option value="due">Due</option><option value="overdue">Overdue</option><option value="today">Today</option><option value="upcoming">Upcoming</option>
        </select></label>
        <label>Minimum estimated value<input name="valueMin" type="number" min="0" step="500" defaultValue={filters.minEstimatedValueGbp} /></label>
        <label>Maximum estimated value<input name="valueMax" type="number" min="0" step="500" defaultValue={filters.maxEstimatedValueGbp} /></label>
        <div className="filter-actions"><button className="btn">Apply filters</button><Link className="btn secondary" href="/dashboard/opportunities">Clear</Link></div>
      </form>

      <div className="opportunity-list">
        {!visible.length && (
          <div className="panel">
            <h3>No opportunities match this view</h3>
            <p className="muted">Clear filters or choose another quick view. New entitled planning matches will appear automatically.</p>
          </div>
        )}
        {visible.map((opportunity: CustomerOpportunityDetail) => <OpportunityCard key={opportunity.id} opportunity={opportunity} />)}
      </div>

      {pageCount > 1 && (
        <nav className="pagination" aria-label="Opportunity pages">
          {page > 1 && <Link className="btn secondary" href={queryWithPage(query, page - 1)}>Previous</Link>}
          <span>Page {page} of {pageCount}</span>
          {page < pageCount && <Link className="btn secondary" href={queryWithPage(query, page + 1)}>Next</Link>}
        </nav>
      )}
    </>
  );
}
