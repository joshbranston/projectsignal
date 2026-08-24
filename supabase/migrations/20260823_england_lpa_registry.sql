-- Phase A: authoritative England Local Planning Authority registry identity.
-- Additive only: existing planning source configuration and coverage state are preserved.

alter table public.councils
  add column if not exists planning_data_entity bigint,
  add column if not exists authority_start_date date,
  add column if not exists authority_end_date date;

-- Preserve the UUIDs of councils already configured in ProjectSignal by attaching
-- their stable Planning Data entity IDs before the national registry sync runs.
update public.councils set planning_data_entity = 626034 where slug = 'wigan' and planning_data_entity is null;
update public.councils set planning_data_entity = 626081 where slug = 'erewash' and planning_data_entity is null;
update public.councils set planning_data_entity = 626084 where slug = 'south-derbyshire' and planning_data_entity is null;
update public.councils set planning_data_entity = 626086 where slug = 'charnwood' and planning_data_entity is null;
update public.councils set planning_data_entity = 626088 where slug = 'hinckley-bosworth' and planning_data_entity is null;
update public.councils set planning_data_entity = 626090 where slug = 'north-west-leicestershire' and planning_data_entity is null;
update public.councils set planning_data_entity = 626118 where slug = 'east-staffordshire' and planning_data_entity is null;

create unique index if not exists councils_planning_data_entity_uidx
  on public.councils (planning_data_entity)
  where planning_data_entity is not null;

-- Scanner code already supports a degraded state; make the database constraint agree.
alter table public.councils drop constraint if exists councils_coverage_status_check;
alter table public.councils
  add constraint councils_coverage_status_check
  check (coverage_status = any (array[
    'discovery'::text,
    'configured'::text,
    'testing'::text,
    'live'::text,
    'degraded'::text,
    'paused'::text,
    'unsupported'::text
  ]));

create or replace function public.sync_england_lpa_registry(p_authorities jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  item jsonb;
  v_entity bigint;
  v_name text;
  v_reference text;
  v_slug text;
  v_start_date date;
  v_end_date date;
  v_active boolean;
  v_id uuid;
  v_existing_entity bigint;
  v_inserted integer := 0;
  v_updated integer := 0;
begin
  if jsonb_typeof(p_authorities) <> 'array' then
    raise exception 'Authority payload must be a JSON array';
  end if;

  for item in select value from jsonb_array_elements(p_authorities)
  loop
    v_entity := nullif(item ->> 'entity', '')::bigint;
    v_name := nullif(btrim(item ->> 'name'), '');
    v_reference := nullif(btrim(item ->> 'reference'), '');
    v_slug := nullif(btrim(item ->> 'slug'), '');
    v_start_date := nullif(item ->> 'startDate', '')::date;
    v_end_date := nullif(item ->> 'endDate', '')::date;

    if v_entity is null or v_name is null or v_slug is null then
      raise exception 'Authority payload row is missing entity, name or slug: %', item;
    end if;

    if v_entity < 626001 or v_entity > 626337 then
      raise exception 'Unexpected Planning Data LPA entity: %', v_entity;
    end if;

    v_active := v_end_date is null or v_end_date >= current_date;

    select id, planning_data_entity
      into v_id, v_existing_entity
      from public.councils
     where planning_data_entity = v_entity
        or slug = v_slug
     order by (planning_data_entity = v_entity) desc
     limit 1;

    if v_id is not null then
      if v_existing_entity is not null and v_existing_entity <> v_entity then
        raise exception 'Council slug % is already linked to Planning Data entity %, cannot relink to %',
          v_slug, v_existing_entity, v_entity;
      end if;

      update public.councils
         set planning_data_entity = v_entity,
             authority_code = coalesce(v_reference, authority_code),
             authority_start_date = v_start_date,
             authority_end_date = v_end_date,
             name = v_name,
             country = 'England',
             active = v_active,
             updated_at = now()
       where id = v_id;

      v_updated := v_updated + 1;
    else
      insert into public.councils (
        slug,
        name,
        source_type,
        source_url,
        country,
        authority_code,
        planning_data_entity,
        authority_start_date,
        authority_end_date,
        active,
        coverage_status
      ) values (
        v_slug,
        v_name,
        'registry',
        '',
        'England',
        v_reference,
        v_entity,
        v_start_date,
        v_end_date,
        v_active,
        'discovery'
      );

      v_inserted := v_inserted + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'inserted', v_inserted,
    'updated', v_updated,
    'processed', v_inserted + v_updated
  );
end;
$$;

revoke all on function public.sync_england_lpa_registry(jsonb) from public;
revoke all on function public.sync_england_lpa_registry(jsonb) from anon;
revoke all on function public.sync_england_lpa_registry(jsonb) from authenticated;
grant execute on function public.sync_england_lpa_registry(jsonb) to service_role;

create or replace function public.sync_england_lpa_county_mappings(p_mappings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_expected integer;
  v_inserted integer;
begin
  if jsonb_typeof(p_mappings) <> 'array' then
    raise exception 'Authority county mapping payload must be a JSON array';
  end if;

  v_expected := jsonb_array_length(p_mappings);

  if v_expected < 337 then
    raise exception 'Authority county mapping payload is incomplete: % rows', v_expected;
  end if;

  delete from public.planning_authority_counties pac
  using public.councils c
  where pac.council_id = c.id
    and c.planning_data_entity is not null;

  insert into public.planning_authority_counties (council_id, county_id)
  select distinct
    c.id,
    co.id
  from jsonb_array_elements(p_mappings) as mapping(value)
  join public.councils c
    on c.planning_data_entity = nullif(mapping.value ->> 'planningDataEntity', '')::bigint
  join public.counties co
    on co.slug = mapping.value ->> 'countySlug'
   and co.nation = 'England'
  on conflict (council_id, county_id) do nothing;

  get diagnostics v_inserted = row_count;

  if v_inserted <> v_expected then
    raise exception 'Authority county mapping sync wrote % of % expected rows', v_inserted, v_expected;
  end if;

  return jsonb_build_object('mappingsWritten', v_inserted);
end;
$$;

revoke all on function public.sync_england_lpa_county_mappings(jsonb) from public;
revoke all on function public.sync_england_lpa_county_mappings(jsonb) from anon;
revoke all on function public.sync_england_lpa_county_mappings(jsonb) from authenticated;
grant execute on function public.sync_england_lpa_county_mappings(jsonb) to service_role;
