alter table public.planning_sources
  add column if not exists consecutive_failures integer not null default 0;

alter table public.planning_sources
  drop constraint if exists planning_sources_consecutive_failures_check;

alter table public.planning_sources
  add constraint planning_sources_consecutive_failures_check
  check (consecutive_failures >= 0 and consecutive_failures <= 1000);

update public.planning_sources ps
set
  name = 'Wigan Open Data planning applications',
  adapter = 'csv',
  endpoint_url = 'https://opendata.wigan.gov.uk/api/download/v1/items/1a3ea7fae81b46b68aa36ed2401f1161/csv?layers=9',
  format = 'csv',
  config = jsonb_build_object(
    'fields', jsonb_build_object(
      'externalReference', 'REFVAL',
      'address', 'ADDRESS',
      'proposal', 'PROPOSAL',
      'decision', 'DECSN'
    )
  ),
  priority = 10,
  scan_every_minutes = 1440,
  active = true,
  next_scan_at = now(),
  consecutive_failures = 0,
  last_error = null,
  updated_at = now()
from public.councils c
where ps.council_id = c.id
  and c.slug = 'wigan';
