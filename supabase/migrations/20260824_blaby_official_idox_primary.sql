-- Promote Blaby District Council to its official Idox Public Access planning feed.
-- PlanIt remains active as a fallback and is suppressed while this primary is healthy.

with blaby as (
  select id
  from public.councils
  where slug = 'blaby'
)
insert into public.planning_sources (
  council_id,
  slug,
  name,
  adapter,
  endpoint_url,
  format,
  config,
  licence_name,
  licence_url,
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
  'Blaby official Idox Public Access',
  'idox_public_access',
  'https://pa.blaby.gov.uk/online-applications/',
  'html',
  jsonb_build_object(
    'lookbackDays', 7,
    'maxPages', 1,
    'searchDateField', 'validated'
  ),
  'Council public planning register',
  'https://www.blaby.gov.uk/planning-and-building/planning-applications/search-for-applications/',
  1,
  1440,
  true,
  now(),
  0,
  'primary',
  3
from blaby
on conflict (council_id, slug) do update
set
  name = excluded.name,
  adapter = excluded.adapter,
  endpoint_url = excluded.endpoint_url,
  format = excluded.format,
  config = excluded.config,
  licence_name = excluded.licence_name,
  licence_url = excluded.licence_url,
  priority = excluded.priority,
  scan_every_minutes = excluded.scan_every_minutes,
  active = true,
  source_role = 'primary',
  fallback_after_failures = 3;

update public.councils
set
  source_type = 'idox_public_access',
  source_url = 'https://pa.blaby.gov.uk/online-applications/',
  planning_register_url = 'https://www.blaby.gov.uk/planning-and-building/planning-applications/search-for-applications/',
  coverage_status = 'live',
  active = true,
  last_error = null,
  updated_at = now()
where slug = 'blaby';
