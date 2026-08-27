-- Keep first county activation, billing-period locking and the fixed initial
-- opportunity backfill in one transaction. A failed backfill therefore rolls
-- activation back, allowing Stripe's retry to safely repeat the whole operation.
create or replace function public.activate_initial_customer_access(
  p_company_id uuid,
  p_effective_at timestamptz default now(),
  p_locked_until timestamptz default null,
  p_stripe_event_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_activated integer := 0;
  v_backfilled integer := 0;
begin
  v_activated := public.activate_initial_company_counties(
    p_company_id,
    p_effective_at,
    p_locked_until,
    p_stripe_event_id
  );

  -- Subscription events carry the authoritative current period end. Apply it
  -- on initial checkout ordering and every renewal, not only first activation.
  if p_locked_until is not null then
    update public.company_counties
    set locked_until = p_locked_until,
        updated_at = now()
    where company_id = p_company_id
      and status = 'active';
  end if;

  if v_activated > 0 then
    v_backfilled := public.backfill_initial_company_opportunities(p_company_id);
  end if;

  return jsonb_build_object(
    'activatedCounties', v_activated,
    'backfilledOpportunities', v_backfilled
  );
end;
$$;

revoke all on function public.activate_initial_customer_access(uuid, timestamptz, timestamptz, text)
from public, anon, authenticated;
grant execute on function public.activate_initial_customer_access(uuid, timestamptz, timestamptz, text)
to service_role;
