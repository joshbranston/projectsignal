-- Customer-specific opportunity management. This migration intentionally keeps
-- legacy lead_status values for compatibility while new writes use canonical CRM stages.

alter type public.lead_status add value if not exists 'reviewing' after 'new';
alter type public.lead_status add value if not exists 'follow_up' after 'quoted';
alter type public.lead_status add value if not exists 'lost' after 'won';
alter type public.lead_status add value if not exists 'not_relevant' after 'won';

alter table public.customer_leads
  add column if not exists first_viewed_at timestamptz,
  add column if not exists last_viewed_at timestamptz,
  add column if not exists contacted_at timestamptz,
  add column if not exists quoted_at timestamptz,
  add column if not exists won_at timestamptz,
  add column if not exists lost_at timestamptz,
  add column if not exists not_relevant_at timestamptz,
  add column if not exists follow_up_at timestamptz,
  add column if not exists quote_value_gbp numeric(12, 2),
  add column if not exists won_value_gbp numeric(12, 2),
  add column if not exists lost_reason text,
  add column if not exists not_relevant_reason text;

alter table public.customer_leads
  drop constraint if exists customer_leads_quote_value_nonnegative,
  add constraint customer_leads_quote_value_nonnegative
    check (quote_value_gbp is null or quote_value_gbp between 0 and 100000000),
  drop constraint if exists customer_leads_won_value_nonnegative,
  add constraint customer_leads_won_value_nonnegative
    check (won_value_gbp is null or won_value_gbp between 0 and 100000000),
  drop constraint if exists customer_leads_lost_reason_check,
  add constraint customer_leads_lost_reason_check check (
    lost_reason is null or lost_reason in (
      'No response', 'Price', 'Competitor', 'Project cancelled',
      'Too late', 'Not suitable', 'Other'
    )
  ),
  drop constraint if exists customer_leads_not_relevant_reason_check,
  add constraint customer_leads_not_relevant_reason_check check (
    not_relevant_reason is null or not_relevant_reason in (
      'Wrong type of work', 'Too small', 'Too large', 'Wrong area',
      'Commercial', 'Already completed', 'No real opportunity', 'Other'
    )
  );

create table if not exists public.opportunity_notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  opportunity_id uuid not null references public.customer_leads(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_customer_leads_company_status_updated
  on public.customer_leads(company_id, status, updated_at desc);
create index if not exists idx_customer_leads_company_follow_up
  on public.customer_leads(company_id, follow_up_at)
  where follow_up_at is not null;
create index if not exists idx_customer_leads_company_planning_application
  on public.customer_leads(company_id, planning_application_id);
create index if not exists idx_opportunity_notes_opportunity_created
  on public.opportunity_notes(opportunity_id, created_at desc);
create index if not exists idx_opportunity_notes_company
  on public.opportunity_notes(company_id);
create index if not exists idx_opportunity_notes_created_by
  on public.opportunity_notes(created_by);
create index if not exists idx_lead_events_opportunity_created
  on public.lead_events(customer_lead_id, created_at desc);

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create or replace function private.record_customer_opportunity_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.lead_events(
    customer_lead_id, company_id, user_id, event_type, from_status, to_status, metadata, created_at
  ) values (
    new.id, new.company_id, null, 'opportunity_created', null, new.status, '{}'::jsonb,
    coalesce(new.matched_at, new.created_at, now())
  );
  return new;
end;
$$;

revoke all on function private.record_customer_opportunity_created() from public, anon, authenticated;

drop trigger if exists record_customer_opportunity_created on public.customer_leads;
create trigger record_customer_opportunity_created
after insert on public.customer_leads
for each row execute function private.record_customer_opportunity_created();

insert into public.lead_events(
  customer_lead_id, company_id, user_id, event_type, from_status, to_status, metadata, created_at
)
select cl.id, cl.company_id, null, 'opportunity_created', null, cl.status, '{}'::jsonb,
       coalesce(cl.matched_at, cl.created_at, now())
from public.customer_leads cl
where not exists (
  select 1
  from public.lead_events le
  where le.customer_lead_id = cl.id
    and le.event_type = 'opportunity_created'
);

alter table public.opportunity_notes enable row level security;
revoke all on table
  public.customer_leads,
  public.lead_events,
  public.opportunity_notes,
  public.planning_applications,
  public.planning_authority_counties,
  public.company_counties,
  public.councils
from anon, authenticated;
grant select on table
  public.customer_leads,
  public.lead_events,
  public.opportunity_notes,
  public.planning_applications,
  public.planning_authority_counties,
  public.company_counties,
  public.councils
to authenticated;

create or replace function private.can_manage_customer_opportunity(
  p_opportunity_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
    and p_user_id = auth.uid()
    and exists (
    select 1
    from public.customer_leads cl
    join public.company_members cm
      on cm.company_id = cl.company_id
     and cm.user_id = p_user_id
    join public.subscriptions s
      on s.company_id = cl.company_id
     and s.status = 'active'
    join public.planning_applications pa
      on pa.id = cl.planning_application_id
    where cl.id = p_opportunity_id
      and exists (
        select 1
        from public.planning_authority_counties pac
        join public.company_counties cc
          on cc.company_id = cl.company_id
         and cc.county_id = pac.county_id
         and cc.status = 'active'
         and (cc.starts_at is null or cc.starts_at <= now())
         and (cc.ends_at is null or cc.ends_at > now())
        where pac.council_id = pa.council_id
      )
  );
$$;

revoke all on function private.can_manage_customer_opportunity(uuid, uuid) from public;
revoke all on function private.can_manage_customer_opportunity(uuid, uuid) from anon;
grant execute on function private.can_manage_customer_opportunity(uuid, uuid) to authenticated;

drop policy if exists customer_leads_select_member on public.customer_leads;
drop policy if exists "Members can read entitled customer opportunities" on public.customer_leads;
create policy "Members can read entitled customer opportunities"
  on public.customer_leads for select
  to authenticated
  using (private.can_manage_customer_opportunity(id, auth.uid()));

drop policy if exists lead_events_select_member on public.lead_events;
drop policy if exists "Members can read entitled opportunity activities" on public.lead_events;
create policy "Members can read entitled opportunity activities"
  on public.lead_events for select
  to authenticated
  using (private.can_manage_customer_opportunity(customer_lead_id, auth.uid()));

drop policy if exists "Members can read planning applications for their opportunities" on public.planning_applications;
create policy "Members can read planning applications for their opportunities"
  on public.planning_applications for select
  to authenticated
  using (
    exists (
      select 1
      from public.customer_leads cl
      where cl.planning_application_id = planning_applications.id
        and private.can_manage_customer_opportunity(cl.id, auth.uid())
    )
  );

drop policy if exists "Authenticated users can read active councils" on public.councils;
create policy "Authenticated users can read active councils"
  on public.councils for select
  to authenticated
  using (active = true);

drop policy if exists "Members can read entitled opportunity notes" on public.opportunity_notes;
create policy "Members can read entitled opportunity notes"
  on public.opportunity_notes for select
  to authenticated
  using (private.can_manage_customer_opportunity(opportunity_id, auth.uid()));

create or replace function public.update_customer_opportunity(
  p_opportunity_id uuid,
  p_stage text,
  p_follow_up_at timestamptz default null,
  p_quote_value_gbp numeric default null,
  p_won_value_gbp numeric default null,
  p_lost_reason text default null,
  p_not_relevant_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_company_id uuid;
  v_from_status public.lead_status;
  v_to_status public.lead_status;
  v_previous_follow_up timestamptz;
  v_previous_quote numeric;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_stage not in ('new', 'reviewing', 'contacted', 'quoted', 'follow_up', 'won', 'lost', 'not_relevant') then
    raise exception 'Invalid opportunity stage';
  end if;
  if p_quote_value_gbp is not null and (p_quote_value_gbp < 0 or p_quote_value_gbp > 100000000) then
    raise exception 'Quote value must be between zero and 100000000';
  end if;
  if p_won_value_gbp is not null and (p_won_value_gbp < 0 or p_won_value_gbp > 100000000) then
    raise exception 'Won value must be between zero and 100000000';
  end if;
  if p_lost_reason is not null and p_lost_reason not in ('No response', 'Price', 'Competitor', 'Project cancelled', 'Too late', 'Not suitable', 'Other') then
    raise exception 'Invalid lost reason';
  end if;
  if p_not_relevant_reason is not null and p_not_relevant_reason not in ('Wrong type of work', 'Too small', 'Too large', 'Wrong area', 'Commercial', 'Already completed', 'No real opportunity', 'Other') then
    raise exception 'Invalid not relevant reason';
  end if;
  if not private.can_manage_customer_opportunity(p_opportunity_id, v_user_id) then
    raise exception 'Opportunity is unavailable or outside the active entitlement';
  end if;

  select company_id, status, follow_up_at, quote_value_gbp
    into v_company_id, v_from_status, v_previous_follow_up, v_previous_quote
  from public.customer_leads
  where id = p_opportunity_id
  for update;

  v_to_status := p_stage::public.lead_status;

  update public.customer_leads
  set status = v_to_status,
      first_viewed_at = case when p_stage <> 'new' then coalesce(first_viewed_at, now()) else first_viewed_at end,
      last_viewed_at = case when p_stage <> 'new' then now() else last_viewed_at end,
      follow_up_at = p_follow_up_at,
      quote_value_gbp = p_quote_value_gbp,
      won_value_gbp = case when p_stage = 'won' then coalesce(p_won_value_gbp, won_value_gbp, p_quote_value_gbp) else null end,
      contacted_at = case when p_stage in ('contacted', 'quoted', 'follow_up', 'won', 'lost') then coalesce(contacted_at, now()) else contacted_at end,
      quoted_at = case when p_stage in ('quoted', 'won') or p_quote_value_gbp is not null then coalesce(quoted_at, now()) else quoted_at end,
      won_at = case when p_stage = 'won' then coalesce(won_at, now()) else null end,
      lost_at = case when p_stage = 'lost' then coalesce(lost_at, now()) else null end,
      not_relevant_at = case when p_stage = 'not_relevant' then coalesce(not_relevant_at, now()) else null end,
      lost_reason = case when p_stage = 'lost' then p_lost_reason else null end,
      not_relevant_reason = case when p_stage = 'not_relevant' then p_not_relevant_reason else null end,
      updated_at = now()
  where id = p_opportunity_id;

  if v_from_status is distinct from v_to_status then
    insert into public.lead_events(customer_lead_id, company_id, user_id, event_type, from_status, to_status, metadata)
    values (p_opportunity_id, v_company_id, v_user_id, 'stage_changed', v_from_status, v_to_status, '{}'::jsonb);
  end if;
  if v_previous_follow_up is distinct from p_follow_up_at then
    insert into public.lead_events(customer_lead_id, company_id, user_id, event_type, from_status, to_status, metadata)
    values (p_opportunity_id, v_company_id, v_user_id, 'follow_up_changed', v_to_status, v_to_status,
      jsonb_build_object('follow_up_at', p_follow_up_at));
  end if;
  if v_previous_quote is distinct from p_quote_value_gbp then
    insert into public.lead_events(customer_lead_id, company_id, user_id, event_type, from_status, to_status, metadata)
    values (p_opportunity_id, v_company_id, v_user_id, 'quote_changed', v_to_status, v_to_status,
      jsonb_build_object('quote_value_gbp', p_quote_value_gbp));
  end if;

  return p_opportunity_id;
end;
$$;

create or replace function public.mark_customer_opportunity_viewed(p_opportunity_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null or not private.can_manage_customer_opportunity(p_opportunity_id, v_user_id) then
    raise exception 'Opportunity is unavailable or outside the active entitlement';
  end if;
  update public.customer_leads
  set first_viewed_at = coalesce(first_viewed_at, now()), last_viewed_at = now(), updated_at = now()
  where id = p_opportunity_id;
  return p_opportunity_id;
end;
$$;

create or replace function public.add_customer_opportunity_note(
  p_opportunity_id uuid,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_company_id uuid;
  v_note_id uuid;
  v_body text := btrim(coalesce(p_body, ''));
begin
  if char_length(v_body) < 1 or char_length(v_body) > 4000 then
    raise exception 'Note must contain between 1 and 4000 characters';
  end if;
  if v_user_id is null or not private.can_manage_customer_opportunity(p_opportunity_id, v_user_id) then
    raise exception 'Opportunity is unavailable or outside the active entitlement';
  end if;
  select company_id into v_company_id from public.customer_leads where id = p_opportunity_id;
  insert into public.opportunity_notes(company_id, opportunity_id, body, created_by)
  values (v_company_id, p_opportunity_id, v_body, v_user_id)
  returning id into v_note_id;
  insert into public.lead_events(customer_lead_id, company_id, user_id, event_type, metadata)
  values (p_opportunity_id, v_company_id, v_user_id, 'note_added', jsonb_build_object('note_id', v_note_id));
  return v_note_id;
end;
$$;

create or replace function public.update_customer_opportunity_note(
  p_note_id uuid,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_opportunity_id uuid;
  v_company_id uuid;
  v_body text := btrim(coalesce(p_body, ''));
begin
  if char_length(v_body) < 1 or char_length(v_body) > 4000 then
    raise exception 'Note must contain between 1 and 4000 characters';
  end if;
  select opportunity_id, company_id into v_opportunity_id, v_company_id from public.opportunity_notes where id = p_note_id;
  if v_opportunity_id is null or v_user_id is null or not private.can_manage_customer_opportunity(v_opportunity_id, v_user_id) then
    raise exception 'Note is unavailable or outside the active entitlement';
  end if;
  update public.opportunity_notes set body = v_body, updated_at = now() where id = p_note_id;
  insert into public.lead_events(customer_lead_id, company_id, user_id, event_type, metadata)
  values (v_opportunity_id, v_company_id, v_user_id, 'note_updated', jsonb_build_object('note_id', p_note_id));
  return p_note_id;
end;
$$;

create or replace function public.delete_customer_opportunity_note(p_note_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_opportunity_id uuid;
  v_company_id uuid;
begin
  select opportunity_id, company_id into v_opportunity_id, v_company_id from public.opportunity_notes where id = p_note_id;
  if v_opportunity_id is null or v_user_id is null or not private.can_manage_customer_opportunity(v_opportunity_id, v_user_id) then
    raise exception 'Note is unavailable or outside the active entitlement';
  end if;
  delete from public.opportunity_notes where id = p_note_id;
  insert into public.lead_events(customer_lead_id, company_id, user_id, event_type, metadata)
  values (v_opportunity_id, v_company_id, v_user_id, 'note_deleted', jsonb_build_object('note_id', p_note_id));
  return p_note_id;
end;
$$;

revoke all on function public.update_customer_opportunity(uuid, text, timestamptz, numeric, numeric, text, text) from public;
revoke all on function public.mark_customer_opportunity_viewed(uuid) from public;
revoke all on function public.add_customer_opportunity_note(uuid, text) from public;
revoke all on function public.update_customer_opportunity_note(uuid, text) from public;
revoke all on function public.delete_customer_opportunity_note(uuid) from public;
revoke all on function public.update_customer_opportunity(uuid, text, timestamptz, numeric, numeric, text, text) from anon;
revoke all on function public.mark_customer_opportunity_viewed(uuid) from anon;
revoke all on function public.add_customer_opportunity_note(uuid, text) from anon;
revoke all on function public.update_customer_opportunity_note(uuid, text) from anon;
revoke all on function public.delete_customer_opportunity_note(uuid) from anon;

-- The legacy status-only RPC checks membership but not the active subscription
-- and county entitlement enforced by the CRM RPCs. Disable it as a customer path.
do $$
begin
  if to_regprocedure('public.set_customer_lead_status(uuid,public.lead_status)') is not null then
    execute 'revoke all on function public.set_customer_lead_status(uuid, public.lead_status) from public, anon, authenticated';
  end if;
end;
$$;

grant execute on function public.update_customer_opportunity(uuid, text, timestamptz, numeric, numeric, text, text) to authenticated;
grant execute on function public.mark_customer_opportunity_viewed(uuid) to authenticated;
grant execute on function public.add_customer_opportunity_note(uuid, text) to authenticated;
grant execute on function public.update_customer_opportunity_note(uuid, text) to authenticated;
grant execute on function public.delete_customer_opportunity_note(uuid) to authenticated;
