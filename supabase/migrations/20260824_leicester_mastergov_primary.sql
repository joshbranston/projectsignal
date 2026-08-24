-- Promote Leicester City Council to its official DEF/MasterGov planning feed.
-- PlanIt remains active as fallback and is suppressed while the primary is healthy.

with leicester as (
  select id
  from public.councils
  where slug = 'leicester'
)
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
  consecutive_failures,
  source_role,
  fallback_after_failures
)
select
  id,
  'official-primary',
  'Leicester official MasterGov',
  'custom',
  'https://planning.leicester.gov.uk/',
  'html',
  jsonb_build_object(
    'provider', 'mastergov',
    'lookbackDays', 7,
    'maxPages', 10,
    'enrichDetails', true
  ),
  1,
  1440,
  true,
  now(),
  0,
  'primary',
  3
from leicester
on conflict (council_id, slug) do update
set
  name = excluded.name,
  adapter = excluded.adapter,
  endpoint_url = excluded.endpoint_url,
  format = excluded.format,
  config = excluded.config,
  priority = excluded.priority,
  scan_every_minutes = excluded.scan_every_minutes,
  active = true,
  source_role = 'primary',
  fallback_after_failures = 3;

update public.councils
set
  source_type = 'mastergov',
  source_url = 'https://planning.leicester.gov.uk/',
  planning_register_url = 'https://planning.leicester.gov.uk/',
  coverage_status = 'live',
  active = true,
  last_error = null,
  updated_at = now()
where slug = 'leicester';
