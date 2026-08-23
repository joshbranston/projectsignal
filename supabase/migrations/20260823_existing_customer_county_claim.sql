-- One-time migration path for customers created before county entitlements existed.

create or replace function public.set_existing_company_initial_counties(
  p_county_slugs text[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_company_id uuid;
  v_plan_limit integer;
  v_selected_count integer;
  v_valid_count integer;
  v_period_end timestamptz;
  v_count integer := 0;
  v_county record;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select cm.company_id
  into v_company_id
  from public.company_members cm
  where cm.user_id = v_user_id
  order by case cm.role when 'owner' then 0 when 'admin' then 1 else 2 end
  limit 1;

  if v_company_id is null then
    raise exception 'Company membership is required';
  end if;

  if exists (
    select 1
    from public.company_counties cc
    where cc.company_id = v_company_id
  ) then
    raise exception 'Initial county territory has already been selected';
  end if;

  select bp.county_limit, s.current_period_ends_at
  into v_plan_limit, v_period_end
  from public.subscriptions s
  join public.billing_plans bp on bp.code = s.plan_code
  where s.company_id = v_company_id
    and s.status = 'active'
    and bp.active = true;

  if v_plan_limit is null or v_plan_limit < 1 then
    raise exception 'An active ProjectSignal subscription is required';
  end if;

  select count(distinct lower(trim(value)))
  into v_selected_count
  from unnest(coalesce(p_county_slugs, array[]::text[])) as selected(value)
  where nullif(trim(value), '') is not null;

  if v_selected_count < 1 then
    raise exception 'Select at least one county';
  end if;

  if v_selected_count > v_plan_limit then
    raise exception 'Your plan includes up to % counties', v_plan_limit;
  end if;

  select count(*)
  into v_valid_count
  from public.counties co
  where co.active = true
    and co.nation = 'England'
    and co.slug in (
      select distinct lower(trim(value))
      from unnest(p_county_slugs) as selected(value)
      where nullif(trim(value), '') is not null
    );

  if v_valid_count <> v_selected_count then
    raise exception 'One or more selected counties are invalid';
  end if;

  for v_county in
    select co.id, co.slug
    from public.counties co
    where co.active = true
      and co.nation = 'England'
      and co.slug in (
        select distinct lower(trim(value))
        from unnest(p_county_slugs) as selected(value)
        where nullif(trim(value), '') is not null
      )
  loop
    insert into public.company_counties (
      company_id,
      county_id,
      status,
      starts_at,
      locked_until
    ) values (
      v_company_id,
      v_county.id,
      'active',
      now(),
      v_period_end
    );

    insert into public.territory_change_events (
      company_id,
      county_id,
      action,
      effective_at,
      previous_state,
      new_state
    ) values (
      v_company_id,
      v_county.id,
      'county_activated',
      now(),
      jsonb_build_object('territory_model', 'legacy_radius'),
      jsonb_build_object(
        'territory_model', 'county',
        'status', 'active',
        'county_slug', v_county.slug,
        'locked_until', v_period_end
      )
    );

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.set_existing_company_initial_counties(text[]) from public;
grant execute on function public.set_existing_company_initial_counties(text[]) to authenticated;
