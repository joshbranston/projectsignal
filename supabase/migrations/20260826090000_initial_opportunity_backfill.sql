-- Give a newly activated customer immediate value from recent, already-scored
-- applications. The lookback is deliberately fixed so callers cannot widen it.
create or replace function public.backfill_initial_company_opportunities(
  p_company_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer := 0;
begin
  insert into public.customer_leads (
    company_id,
    territory_id,
    planning_application_id,
    trade_id,
    score,
    priority,
    title,
    address,
    postcode,
    stage,
    proposal,
    estimated_value_min_gbp,
    estimated_value_max_gbp,
    why_it_matches,
    recommended_approach
  )
  select distinct on (pa.id, ct.trade_id)
    p_company_id,
    territory.id,
    pa.id,
    ct.trade_id,
    opportunity.score,
    case
      when opportunity.score >= 8.5 then 'HOT'
      when opportunity.score >= 7 then 'HIGH'
      when opportunity.score >= 5.5 then 'MEDIUM'
      else 'LOW'
    end,
    case
      when opportunity.score >= 8.5 then 'High-value planning opportunity'
      else 'Matched planning opportunity'
    end,
    pa.address,
    pa.postcode,
    pa.stage,
    pa.proposal,
    opportunity.estimated_value_min_gbp,
    opportunity.estimated_value_max_gbp,
    opportunity.reason,
    opportunity.recommended_approach
  from public.subscriptions subscription
  join public.company_trades ct
    on ct.company_id = subscription.company_id
  join public.application_trade_opportunities opportunity
    on opportunity.trade_id = ct.trade_id
  join public.planning_applications pa
    on pa.id = opportunity.planning_application_id
  join public.planning_authority_counties authority_county
    on authority_county.council_id = pa.council_id
  join public.company_counties company_county
    on company_county.company_id = subscription.company_id
   and company_county.county_id = authority_county.county_id
   and company_county.status = 'active'
  cross join lateral (
    select t.id, t.minimum_score
    from public.territories t
    where t.company_id = subscription.company_id
      and t.active = true
    order by t.created_at asc, t.id asc
    limit 1
  ) territory
  where subscription.company_id = p_company_id
    and subscription.status = 'active'
    and pa.first_seen_at >= now() - interval '30 days'
    and opportunity.score >= territory.minimum_score
    and coalesce(opportunity.estimated_value_min_gbp, 0) >= coalesce(ct.min_opportunity_gbp, 0)
    -- Older analyses may predate the launch-quality exclusions in the scoring
    -- engine. Do not let those stale administrative scores into a first feed.
    and pa.proposal !~* '\m(discharge|approval) of conditions?\M|\mdetails pursuant to conditions?\M|\mnon[- ]material amendment\M|\msection 73\M|\mvariation of conditions?\M'
    and pa.proposal !~* '\madvert(isement|ising)\M|\msignage\M|\milluminated (fascia )?sign\M|\mwindow manifestations?\M'
    and pa.proposal !~* '\mtree works?\M|\mcrown lift\M|\msycamore\M|\moak\M|\mtelecom\M|\mantenna\M|\mmast\M'
    and not (
      pa.proposal ~* '\mgarage\M'
      and pa.proposal ~* '\m(replacement garage|erection of (a |an )?(replacement )?garage)\M'
      and pa.proposal !~* '\m(conversion|dwelling|extension|windows?|doors?|glaz(e|ed|ing))\M'
    )
  order by pa.id, ct.trade_id, company_county.starts_at asc nulls last
  on conflict (company_id, planning_application_id, trade_id) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

revoke all on function public.backfill_initial_company_opportunities(uuid)
from public, anon, authenticated;
grant execute on function public.backfill_initial_company_opportunities(uuid)
to service_role;
