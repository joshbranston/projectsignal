-- Phase D: England-wide PlanIt fallback baseline.
-- Official sources remain primary; these rows only fill coverage gaps.

with missing_planit as (
  select c.id as council_id, c.name as council_name, c.slug as council_slug
  from public.councils c
  where c.country = 'England'
    and c.active = true
    and not exists (
      select 1
      from public.planning_sources ps
      where ps.council_id = c.id
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
    900,
    4320,
    true,
    now(),
    'fallback',
    3
  from missing_planit m
  on conflict (council_id, slug) do nothing
  returning council_id
)
update public.councils c
set coverage_status = 'testing',
    updated_at = now()
where c.id in (select council_id from inserted)
  and c.coverage_status in ('discovery', 'configured');
