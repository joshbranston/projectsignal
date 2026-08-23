-- ProjectSignal Phase A: England county entitlement foundation.
-- Additive migration: preserves the existing radius territory model during rollout.

alter table public.companies
  add column if not exists address_line_1 text,
  add column if not exists address_line_2 text,
  add column if not exists town_city text,
  add column if not exists county_text text,
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;

alter table public.billing_plans
  add column if not exists county_limit integer not null default 0,
  add column if not exists additional_county_price_id text,
  add column if not exists additional_county_price_gbp_pence integer;

update public.billing_plans
set county_limit = 3
where code = 'pro';

alter table public.billing_plans
  drop constraint if exists billing_plans_county_limit_check;

alter table public.billing_plans
  add constraint billing_plans_county_limit_check
  check (county_limit >= 0 and county_limit <= 100);

alter table public.billing_plans
  drop constraint if exists billing_plans_additional_county_price_gbp_pence_check;

alter table public.billing_plans
  add constraint billing_plans_additional_county_price_gbp_pence_check
  check (
    additional_county_price_gbp_pence is null
    or additional_county_price_gbp_pence >= 0
  );

create table if not exists public.counties (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  nation text not null,
  geometry jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint counties_nation_check check (nation in ('England', 'Wales', 'Scotland', 'Northern Ireland'))
);

create table if not exists public.planning_authority_counties (
  council_id uuid not null references public.councils(id) on delete cascade,
  county_id uuid not null references public.counties(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (council_id, county_id)
);

create table if not exists public.company_counties (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  county_id uuid not null references public.counties(id) on delete restrict,
  status text not null default 'scheduled',
  starts_at timestamptz,
  ends_at timestamptz,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_counties_status_check check (status in ('active', 'scheduled', 'ending', 'expired')),
  constraint company_counties_dates_check check (ends_at is null or starts_at is null or ends_at >= starts_at)
);

create unique index if not exists company_counties_one_current_entitlement
  on public.company_counties(company_id, county_id)
  where status in ('active', 'scheduled', 'ending');

create index if not exists idx_company_counties_company_status
  on public.company_counties(company_id, status, starts_at);

create index if not exists idx_company_counties_county_status
  on public.company_counties(county_id, status, starts_at);

create table if not exists public.territory_change_events (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  county_id uuid not null references public.counties(id) on delete restrict,
  action text not null,
  requested_at timestamptz not null default now(),
  effective_at timestamptz,
  stripe_event_id text,
  previous_state jsonb not null default '{}'::jsonb,
  new_state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint territory_change_events_action_check check (
    action in (
      'county_added',
      'county_removal_scheduled',
      'county_replacement_scheduled',
      'county_activated',
      'county_expired'
    )
  )
);

create index if not exists idx_territory_change_events_company_created
  on public.territory_change_events(company_id, created_at desc);

alter table public.counties enable row level security;
alter table public.planning_authority_counties enable row level security;
alter table public.company_counties enable row level security;
alter table public.territory_change_events enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'counties' and policyname = 'Authenticated users can read counties'
  ) then
    create policy "Authenticated users can read counties"
      on public.counties for select
      to authenticated
      using (active = true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'planning_authority_counties' and policyname = 'Authenticated users can read authority county mapping'
  ) then
    create policy "Authenticated users can read authority county mapping"
      on public.planning_authority_counties for select
      to authenticated
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'company_counties' and policyname = 'Members can read company counties'
  ) then
    create policy "Members can read company counties"
      on public.company_counties for select
      to authenticated
      using (
        exists (
          select 1
          from public.company_members cm
          where cm.company_id = company_counties.company_id
            and cm.user_id = auth.uid()
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'territory_change_events' and policyname = 'Members can read territory change events'
  ) then
    create policy "Members can read territory change events"
      on public.territory_change_events for select
      to authenticated
      using (
        exists (
          select 1
          from public.company_members cm
          where cm.company_id = territory_change_events.company_id
            and cm.user_id = auth.uid()
        )
      );
  end if;
end
$$;

-- Keep updated_at consistent with the existing ProjectSignal tables.
drop trigger if exists set_counties_updated_at on public.counties;
create trigger set_counties_updated_at
before update on public.counties
for each row execute function public.set_updated_at();

drop trigger if exists set_company_counties_updated_at on public.company_counties;
create trigger set_company_counties_updated_at
before update on public.company_counties
for each row execute function public.set_updated_at();

-- England ceremonial counties. Slugs are stable application identifiers.
insert into public.counties (slug, name, nation)
values
  ('bedfordshire', 'Bedfordshire', 'England'),
  ('berkshire', 'Berkshire', 'England'),
  ('bristol', 'Bristol', 'England'),
  ('buckinghamshire', 'Buckinghamshire', 'England'),
  ('cambridgeshire', 'Cambridgeshire', 'England'),
  ('cheshire', 'Cheshire', 'England'),
  ('city-of-london', 'City of London', 'England'),
  ('cornwall', 'Cornwall', 'England'),
  ('cumbria', 'Cumbria', 'England'),
  ('derbyshire', 'Derbyshire', 'England'),
  ('devon', 'Devon', 'England'),
  ('dorset', 'Dorset', 'England'),
  ('durham', 'Durham', 'England'),
  ('east-riding-of-yorkshire', 'East Riding of Yorkshire', 'England'),
  ('east-sussex', 'East Sussex', 'England'),
  ('essex', 'Essex', 'England'),
  ('gloucestershire', 'Gloucestershire', 'England'),
  ('greater-london', 'Greater London', 'England'),
  ('greater-manchester', 'Greater Manchester', 'England'),
  ('hampshire', 'Hampshire', 'England'),
  ('herefordshire', 'Herefordshire', 'England'),
  ('hertfordshire', 'Hertfordshire', 'England'),
  ('isle-of-wight', 'Isle of Wight', 'England'),
  ('kent', 'Kent', 'England'),
  ('lancashire', 'Lancashire', 'England'),
  ('leicestershire', 'Leicestershire', 'England'),
  ('lincolnshire', 'Lincolnshire', 'England'),
  ('merseyside', 'Merseyside', 'England'),
  ('norfolk', 'Norfolk', 'England'),
  ('north-yorkshire', 'North Yorkshire', 'England'),
  ('northamptonshire', 'Northamptonshire', 'England'),
  ('northumberland', 'Northumberland', 'England'),
  ('nottinghamshire', 'Nottinghamshire', 'England'),
  ('oxfordshire', 'Oxfordshire', 'England'),
  ('rutland', 'Rutland', 'England'),
  ('shropshire', 'Shropshire', 'England'),
  ('somerset', 'Somerset', 'England'),
  ('south-yorkshire', 'South Yorkshire', 'England'),
  ('staffordshire', 'Staffordshire', 'England'),
  ('suffolk', 'Suffolk', 'England'),
  ('surrey', 'Surrey', 'England'),
  ('tyne-and-wear', 'Tyne and Wear', 'England'),
  ('warwickshire', 'Warwickshire', 'England'),
  ('west-midlands', 'West Midlands', 'England'),
  ('west-sussex', 'West Sussex', 'England'),
  ('west-yorkshire', 'West Yorkshire', 'England'),
  ('wiltshire', 'Wiltshire', 'England'),
  ('worcestershire', 'Worcestershire', 'England')
on conflict (slug) do update
set name = excluded.name,
    nation = excluded.nation,
    active = true;

-- Initial authority-to-county mappings used by the LE65 pilot and Wigan regression source.
insert into public.planning_authority_counties (council_id, county_id)
select c.id, co.id
from public.councils c
join public.counties co on co.slug = case c.slug
  when 'north-west-leicestershire' then 'leicestershire'
  when 'hinckley-bosworth' then 'leicestershire'
  when 'charnwood' then 'leicestershire'
  when 'south-derbyshire' then 'derbyshire'
  when 'erewash' then 'derbyshire'
  when 'east-staffordshire' then 'staffordshire'
  when 'wigan' then 'greater-manchester'
end
where c.slug in (
  'north-west-leicestershire',
  'hinckley-bosworth',
  'charnwood',
  'south-derbyshire',
  'erewash',
  'east-staffordshire',
  'wigan'
)
on conflict (council_id, county_id) do nothing;

create or replace function public.create_customer_company_with_counties(
  p_company_name text,
  p_address_line_1 text,
  p_address_line_2 text,
  p_town_city text,
  p_postcode text,
  p_county_slugs text[],
  p_trade_slug text default 'windows-doors-bifolds',
  p_radius_miles numeric default 25,
  p_minimum_score numeric default 7,
  p_min_opportunity_gbp integer default 5000
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_company_id uuid;
  v_trade_id uuid;
  v_email text;
  v_plan_limit integer;
  v_selected_count integer;
  v_valid_count integer;
  v_county record;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if nullif(trim(p_company_name), '') is null then
    raise exception 'Company name is required';
  end if;

  if nullif(trim(p_postcode), '') is null then
    raise exception 'Postcode is required';
  end if;

  if p_radius_miles < 1 or p_radius_miles > 150 then
    raise exception 'Radius must be between 1 and 150 miles';
  end if;

  if p_minimum_score < 0 or p_minimum_score > 10 then
    raise exception 'Minimum score must be between 0 and 10';
  end if;

  if exists (
    select 1
    from public.company_members
    where user_id = v_user_id
  ) then
    raise exception 'User already belongs to a company';
  end if;

  select bp.county_limit
  into v_plan_limit
  from public.billing_plans bp
  where bp.code = 'pro'
    and bp.active = true;

  if v_plan_limit is null or v_plan_limit < 1 then
    raise exception 'ProjectSignal Pro county allowance is not configured';
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

  select t.id
  into v_trade_id
  from public.trades t
  where t.slug = p_trade_slug
    and t.active = true;

  if v_trade_id is null then
    raise exception 'Invalid trade';
  end if;

  select u.email
  into v_email
  from auth.users u
  where u.id = v_user_id;

  insert into public.companies (
    name,
    address_line_1,
    address_line_2,
    town_city,
    postcode,
    billing_email,
    onboarding_completed
  )
  values (
    trim(p_company_name),
    nullif(trim(p_address_line_1), ''),
    nullif(trim(p_address_line_2), ''),
    nullif(trim(p_town_city), ''),
    upper(trim(p_postcode)),
    v_email,
    true
  )
  returning id into v_company_id;

  insert into public.company_members (company_id, user_id, role)
  values (v_company_id, v_user_id, 'owner');

  insert into public.company_trades (
    company_id,
    trade_id,
    is_primary,
    min_opportunity_gbp
  )
  values (
    v_company_id,
    v_trade_id,
    true,
    greatest(coalesce(p_min_opportunity_gbp, 0), 0)
  );

  -- Keep the legacy radius row during the county migration period.
  insert into public.territories (
    company_id,
    centre_postcode,
    radius_miles,
    minimum_score
  )
  values (
    v_company_id,
    upper(trim(p_postcode)),
    p_radius_miles,
    p_minimum_score
  );

  insert into public.subscriptions (
    company_id,
    plan_code,
    status,
    price_gbp_pence,
    trial_ends_at
  )
  values (
    v_company_id,
    'pro',
    'incomplete',
    7900,
    null
  );

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
      starts_at
    )
    values (
      v_company_id,
      v_county.id,
      'scheduled',
      null
    );

    insert into public.territory_change_events (
      company_id,
      county_id,
      action,
      effective_at,
      new_state
    )
    values (
      v_company_id,
      v_county.id,
      'county_added',
      null,
      jsonb_build_object('status', 'scheduled', 'county_slug', v_county.slug)
    );
  end loop;

  return v_company_id;
end;
$$;

revoke all on function public.create_customer_company_with_counties(
  text, text, text, text, text, text[], text, numeric, numeric, integer
) from public;
grant execute on function public.create_customer_company_with_counties(
  text, text, text, text, text, text[], text, numeric, numeric, integer
) to authenticated;

create or replace function public.activate_initial_company_counties(
  p_company_id uuid,
  p_effective_at timestamptz default now(),
  p_locked_until timestamptz default null,
  p_stripe_event_id text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  v_row record;
begin
  for v_row in
    update public.company_counties cc
    set status = 'active',
        starts_at = coalesce(cc.starts_at, p_effective_at),
        locked_until = coalesce(p_locked_until, cc.locked_until),
        updated_at = now()
    where cc.company_id = p_company_id
      and cc.status = 'scheduled'
      and cc.starts_at is null
    returning cc.county_id
  loop
    v_count := v_count + 1;

    insert into public.territory_change_events (
      company_id,
      county_id,
      action,
      requested_at,
      effective_at,
      stripe_event_id,
      previous_state,
      new_state
    )
    values (
      p_company_id,
      v_row.county_id,
      'county_activated',
      p_effective_at,
      p_effective_at,
      p_stripe_event_id,
      jsonb_build_object('status', 'scheduled'),
      jsonb_build_object('status', 'active', 'starts_at', p_effective_at, 'locked_until', p_locked_until)
    );
  end loop;

  return v_count;
end;
$$;

revoke all on function public.activate_initial_company_counties(uuid, timestamptz, timestamptz, text)
from public, anon, authenticated;
grant execute on function public.activate_initial_company_counties(uuid, timestamptz, timestamptz, text)
to service_role;
