-- Phase B: safe national planning source orchestration.
-- Additive metadata, atomic source leases, primary/fallback policy and scheduler bootstrap.

alter table public.planning_sources
  add column if not exists source_role text not null default 'primary',
  add column if not exists fallback_after_failures integer not null default 3,
  add column if not exists lease_token uuid,
  add column if not exists lease_expires_at timestamptz;

alter table public.planning_sources
  drop constraint if exists planning_sources_source_role_check;
alter table public.planning_sources
  add constraint planning_sources_source_role_check
  check (source_role = any (array['primary'::text, 'fallback'::text]));

alter table public.planning_sources
  drop constraint if exists planning_sources_fallback_after_failures_check;
alter table public.planning_sources
  add constraint planning_sources_fallback_after_failures_check
  check (fallback_after_failures between 1 and 100);

create index if not exists planning_sources_due_claim_idx
  on public.planning_sources (active, next_scan_at, priority)
  where active = true;

create index if not exists planning_sources_council_role_idx
  on public.planning_sources (council_id, source_role, active);

-- Existing PlanIt rows are fallbacks. With no primary configured they remain eligible,
-- preserving the currently working North West Leicestershire feed.
update public.planning_sources
set source_role = 'fallback',
    fallback_after_failures = coalesce(fallback_after_failures, 3)
where adapter = 'custom'
  and config ->> 'provider' = 'planit';

create or replace function public.claim_due_planning_sources(
  p_limit integer,
  p_worker_token uuid,
  p_lease_seconds integer default 90,
  p_planit_limit integer default 1
)
returns table (
  id uuid,
  council_id uuid,
  council_slug text,
  council_name text,
  slug text,
  adapter text,
  endpoint_url text,
  format text,
  config jsonb,
  priority integer,
  scan_every_minutes integer,
  consecutive_failures integer,
  last_scanned_at timestamptz,
  last_success_at timestamptz,
  next_scan_at timestamptz,
  source_role text,
  fallback_after_failures integer,
  lease_token uuid,
  lease_expires_at timestamptz
)
language sql
security definer
set search_path = public, pg_temp
as $$
  with eligible as (
    select
      ps.*,
      (ps.adapter = 'custom' and ps.config ->> 'provider' = 'planit') as is_planit
    from public.planning_sources ps
    where ps.active = true
      and (ps.next_scan_at is null or ps.next_scan_at <= now())
      and (ps.lease_expires_at is null or ps.lease_expires_at <= now())
      and (
        ps.source_role = 'primary'
        or (
          ps.source_role = 'fallback'
          and not exists (
            select 1
            from public.planning_sources primary_source
            where primary_source.council_id = ps.council_id
              and primary_source.active = true
              and primary_source.source_role = 'primary'
              and primary_source.consecutive_failures < ps.fallback_after_failures
          )
        )
      )
  ),
  council_ranked as (
    select
      e.*,
      row_number() over (
        partition by e.council_id
        order by
          case when e.source_role = 'primary' then 0 else 1 end,
          e.priority asc,
          e.next_scan_at asc nulls first,
          e.id
      ) as council_rank
    from eligible e
  ),
  one_per_council as (
    select *
    from council_ranked
    where council_rank = 1
  ),
  provider_ranked as (
    select
      o.*,
      row_number() over (
        partition by o.is_planit
        order by o.priority asc, o.next_scan_at asc nulls first, o.id
      ) as provider_rank
    from one_per_council o
  ),
  chosen as (
    select p.id
    from provider_ranked p
    where (not p.is_planit) or p.provider_rank <= greatest(0, least(coalesce(p_planit_limit, 1), 1))
    order by p.priority asc, p.next_scan_at asc nulls first, p.id
    limit greatest(1, least(coalesce(p_limit, 3), 20))
  ),
  locked as (
    select ps.id
    from public.planning_sources ps
    join chosen c on c.id = ps.id
    where ps.active = true
      and (ps.lease_expires_at is null or ps.lease_expires_at <= now())
    for update of ps skip locked
  ),
  claimed as (
    update public.planning_sources ps
       set lease_token = p_worker_token,
           lease_expires_at = now() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 90), 300)))
      from locked l
     where ps.id = l.id
       and (ps.lease_expires_at is null or ps.lease_expires_at <= now())
    returning ps.*
  )
  select
    c.id,
    c.council_id,
    council.slug as council_slug,
    council.name as council_name,
    c.slug,
    c.adapter,
    c.endpoint_url,
    c.format,
    c.config,
    c.priority,
    c.scan_every_minutes,
    c.consecutive_failures,
    c.last_scanned_at,
    c.last_success_at,
    c.next_scan_at,
    c.source_role,
    c.fallback_after_failures,
    c.lease_token,
    c.lease_expires_at
  from claimed c
  join public.councils council on council.id = c.council_id
  order by c.priority asc, c.next_scan_at asc nulls first, c.id;
$$;

revoke all on function public.claim_due_planning_sources(integer, uuid, integer, integer) from public;
revoke all on function public.claim_due_planning_sources(integer, uuid, integer, integer) from anon;
revoke all on function public.claim_due_planning_sources(integer, uuid, integer, integer) from authenticated;
grant execute on function public.claim_due_planning_sources(integer, uuid, integer, integer) to service_role;

create or replace function public.run_projectsignal_planning_scan()
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cron_secret text;
  v_base_url text;
begin
  select decrypted_secret into v_cron_secret
  from vault.decrypted_secrets
  where name = 'projectsignal_cron_secret'
  order by updated_at desc
  limit 1;

  select decrypted_secret into v_base_url
  from vault.decrypted_secrets
  where name = 'projectsignal_base_url'
  order by updated_at desc
  limit 1;

  if coalesce(v_cron_secret, '') = '' or coalesce(v_base_url, '') = '' then
    raise exception 'ProjectSignal scheduler Vault secrets are not configured';
  end if;

  return net.http_get(
    url := rtrim(v_base_url, '/') || '/api/cron/scan-planning?limit=3',
    params := '{}'::jsonb,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_cron_secret,
      'User-Agent', 'ProjectSignal-Supabase-Scheduler/1.0'
    ),
    timeout_milliseconds := 55000
  );
end;
$$;

revoke all on function public.run_projectsignal_planning_scan() from public;
revoke all on function public.run_projectsignal_planning_scan() from anon;
revoke all on function public.run_projectsignal_planning_scan() from authenticated;
grant execute on function public.run_projectsignal_planning_scan() to service_role;

create or replace function public.bootstrap_projectsignal_planning_scheduler(
  p_cron_secret text,
  p_base_url text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_secret_id uuid;
  v_url_id uuid;
  v_existing_job bigint;
  v_job_id bigint;
  v_base_url text := rtrim(btrim(p_base_url), '/');
begin
  if coalesce(btrim(p_cron_secret), '') = '' then
    raise exception 'CRON secret is required';
  end if;
  if v_base_url !~ '^https?://' then
    raise exception 'Base URL must start with http:// or https://';
  end if;

  select id into v_secret_id
  from vault.decrypted_secrets
  where name = 'projectsignal_cron_secret'
  order by updated_at desc
  limit 1;

  if v_secret_id is null then
    v_secret_id := vault.create_secret(
      p_cron_secret,
      'projectsignal_cron_secret',
      'ProjectSignal planning worker bearer secret',
      null
    );
  else
    perform vault.update_secret(
      v_secret_id,
      p_cron_secret,
      'projectsignal_cron_secret',
      'ProjectSignal planning worker bearer secret',
      null
    );
  end if;

  select id into v_url_id
  from vault.decrypted_secrets
  where name = 'projectsignal_base_url'
  order by updated_at desc
  limit 1;

  if v_url_id is null then
    v_url_id := vault.create_secret(
      v_base_url,
      'projectsignal_base_url',
      'ProjectSignal production base URL',
      null
    );
  else
    perform vault.update_secret(
      v_url_id,
      v_base_url,
      'projectsignal_base_url',
      'ProjectSignal production base URL',
      null
    );
  end if;

  select jobid into v_existing_job
  from cron.job
  where jobname = 'projectsignal-planning-scan-10m'
  limit 1;

  if v_existing_job is not null then
    perform cron.unschedule(v_existing_job);
  end if;

  v_job_id := cron.schedule(
    'projectsignal-planning-scan-10m',
    '*/10 * * * *',
    'select public.run_projectsignal_planning_scan();'
  );

  return jsonb_build_object(
    'scheduled', true,
    'cadence', '*/10 * * * *',
    'jobId', v_job_id
  );
end;
$$;

revoke all on function public.bootstrap_projectsignal_planning_scheduler(text, text) from public;
revoke all on function public.bootstrap_projectsignal_planning_scheduler(text, text) from anon;
revoke all on function public.bootstrap_projectsignal_planning_scheduler(text, text) from authenticated;
grant execute on function public.bootstrap_projectsignal_planning_scheduler(text, text) to service_role;
