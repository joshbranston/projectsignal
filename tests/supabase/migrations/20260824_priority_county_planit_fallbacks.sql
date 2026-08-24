-- Phase C: fallback coverage for ProjectSignal's first three customer counties.
-- Existing primary sources are preserved. PlanIt remains fallback-only.

with target_authorities as (
  select
    c.id as council_id,
    c.name as council_name,
    c.slug as council_slug,
    min(
      case co.slug
        when 'leicestershire' then 1
        when 'staffordshire' then 2
        when 'warwickshire' then 3
        else 9
      end
    ) as county_order
  from public.councils c
  join public.planning_authority_counties pac on pac.council_id = c.id
  join public.counties co on co.id = pac.county_id
  where c.country = 'England'
    and c.active = true
    and co.slug in ('leicestershire', 'staffordshire', 'warwickshire')
  group by c.id, c.name, c.slug
), missing_planit as (
  select
    t.*,
    row_number() over (order by t.county_order, t.council_slug) - 1 as queue_position
  from target_authorities t
  where not exists (
    select 1
    from public.planning_sources ps
    where ps.council_id = t.council_id
      and ps.adapter = 'custom'
      and ps.config ->> 'provider' = 'planit'
  )
), inserted as (
  insert into public.planning_sources (
    council_id,
    slug,
    name,
    adapter,
    endpoint_url,
    format,
    config,
    priority,
    scan_every_minutes,
    active,
    next_scan_at,
    source_role,
    fallback_after_failures
  )
  select
    m.council_id,
    'planit-fallback',
    'PlanIt fallback',
    'custom',
    'https://www.planit.org.uk/api/applics/json',
    'json',
    jsonb_build_object(
      'provider', 'planit',
      'authority', m.council_name,
      'lookbackDays', 7,
      'pageSize', 100,
      'maxPages', 1
    ),
    500 + m.county_order,
    1440,
    true,
    now() + (m.queue_position * interval '10 minutes'),
    'fallback',
    3
  from missing_planit m
  on conflict (council_id, slug) do nothing
  returning council_id
)
update public.councils c
set coverage_status = 'testing',
    updated_at = now()
where c.id in (select council_id from target_authorities)
  and c.coverage_status in ('discovery', 'configured');
