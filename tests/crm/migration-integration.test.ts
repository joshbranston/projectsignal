import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const COMPANY_A = "11111111-1111-4111-8111-111111111111";
const COMPANY_B = "22222222-2222-4222-8222-222222222222";
const COUNTY_X = "33333333-3333-4333-8333-333333333333";
const COUNTY_Y = "44444444-4444-4444-8444-444444444444";
const COUNCIL_X = "55555555-5555-4555-8555-555555555555";
const COUNCIL_Y = "66666666-6666-4666-8666-666666666666";
const APPLICATION_X = "77777777-7777-4777-8777-777777777777";
const APPLICATION_Y = "88888888-8888-4888-8888-888888888888";
const OPPORTUNITY_A = "99999999-9999-4999-8999-999999999999";
const OPPORTUNITY_B = "aaaaaaaa-1111-4111-8111-111111111111";
const OPPORTUNITY_OUTSIDE_A = "aaaaaaaa-2222-4222-8222-222222222222";

const bootstrapSql = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;

  create schema auth;
  create table auth.users(id uuid primary key);
  create or replace function auth.uid()
  returns uuid language sql stable set search_path = '' as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;

  create type public.lead_status as enum ('new', 'interested', 'contacted', 'quoted', 'won', 'ignored');
  create type public.subscription_status as enum ('trialing', 'active', 'past_due', 'canceled');

  create table public.companies(id uuid primary key, name text not null);
  create table public.company_members(
    company_id uuid not null references public.companies(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    primary key(company_id, user_id)
  );
  create table public.subscriptions(
    id uuid primary key default gen_random_uuid(),
    company_id uuid not null unique references public.companies(id) on delete cascade,
    status public.subscription_status not null
  );
  create table public.counties(id uuid primary key, name text not null);
  create table public.councils(id uuid primary key, name text not null, active boolean not null default true);
  create table public.company_counties(
    id uuid primary key default gen_random_uuid(),
    company_id uuid not null references public.companies(id) on delete cascade,
    county_id uuid not null references public.counties(id),
    status text not null,
    starts_at timestamptz,
    ends_at timestamptz
  );
  create table public.planning_authority_counties(
    council_id uuid not null references public.councils(id) on delete cascade,
    county_id uuid not null references public.counties(id) on delete cascade,
    primary key(council_id, county_id)
  );
  create table public.planning_applications(
    id uuid primary key,
    council_id uuid not null references public.councils(id) on delete cascade
  );
  create table public.customer_leads(
    id uuid primary key,
    company_id uuid not null references public.companies(id) on delete cascade,
    planning_application_id uuid not null references public.planning_applications(id) on delete cascade,
    status public.lead_status not null default 'new',
    matched_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create table public.lead_events(
    id bigint generated always as identity primary key,
    customer_lead_id uuid not null references public.customer_leads(id) on delete cascade,
    company_id uuid not null references public.companies(id) on delete cascade,
    user_id uuid references auth.users(id) on delete set null,
    event_type text not null,
    from_status public.lead_status,
    to_status public.lead_status,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
  );

  create function public.set_customer_lead_status(p_lead_id uuid, p_status public.lead_status)
  returns public.lead_status language plpgsql security definer set search_path = '' as $$
  begin
    update public.customer_leads set status=p_status where id=p_lead_id;
    return p_status;
  end $$;
  grant execute on function public.set_customer_lead_status(uuid, public.lead_status) to authenticated;

  alter table public.companies enable row level security;
  alter table public.company_members enable row level security;
  alter table public.subscriptions enable row level security;
  alter table public.counties enable row level security;
  alter table public.councils enable row level security;
  alter table public.company_counties enable row level security;
  alter table public.planning_authority_counties enable row level security;
  alter table public.planning_applications enable row level security;
  alter table public.customer_leads enable row level security;
  alter table public.lead_events enable row level security;

  create policy customer_leads_select_member on public.customer_leads for select to authenticated
    using (exists(select 1 from public.company_members cm where cm.company_id=customer_leads.company_id and cm.user_id=auth.uid()));
  create policy lead_events_select_member on public.lead_events for select to authenticated
    using (exists(select 1 from public.company_members cm where cm.company_id=lead_events.company_id and cm.user_id=auth.uid()));

  grant all on all tables in schema public to anon, authenticated, service_role;
  grant usage, select on all sequences in schema public to anon, authenticated, service_role;

  insert into auth.users(id) values ('${USER_A}'), ('${USER_B}');
  insert into public.companies(id,name) values ('${COMPANY_A}','Company A'), ('${COMPANY_B}','Company B');
  insert into public.company_members(company_id,user_id) values ('${COMPANY_A}','${USER_A}'), ('${COMPANY_B}','${USER_B}');
  insert into public.subscriptions(company_id,status) values ('${COMPANY_A}','active'), ('${COMPANY_B}','active');
  insert into public.counties(id,name) values ('${COUNTY_X}','County X'), ('${COUNTY_Y}','County Y');
  insert into public.councils(id,name) values ('${COUNCIL_X}','Council X'), ('${COUNCIL_Y}','Council Y');
  insert into public.company_counties(company_id,county_id,status,starts_at)
    values ('${COMPANY_A}','${COUNTY_X}','active',now()-interval '1 day'), ('${COMPANY_B}','${COUNTY_Y}','active',now()-interval '1 day');
  insert into public.planning_authority_counties(council_id,county_id)
    values ('${COUNCIL_X}','${COUNTY_X}'), ('${COUNCIL_Y}','${COUNTY_Y}');
  insert into public.planning_applications(id,council_id)
    values ('${APPLICATION_X}','${COUNCIL_X}'), ('${APPLICATION_Y}','${COUNCIL_Y}');
  insert into public.customer_leads(id,company_id,planning_application_id,status) values
    ('${OPPORTUNITY_A}','${COMPANY_A}','${APPLICATION_X}','interested'),
    ('${OPPORTUNITY_B}','${COMPANY_B}','${APPLICATION_Y}','new'),
    ('${OPPORTUNITY_OUTSIDE_A}','${COMPANY_A}','${APPLICATION_Y}','new');
  insert into public.lead_events(customer_lead_id,company_id,user_id,event_type,from_status,to_status)
    values ('${OPPORTUNITY_A}','${COMPANY_A}','${USER_A}','stage_changed','new','interested');
`;

let db: PGlite;

async function asRole<T>(role: "anon" | "authenticated", userId: string | null, operation: () => Promise<T>) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
  await db.exec(`set role ${role}`);
  try {
    return await operation();
  } finally {
    await db.exec("reset role");
  }
}

test.before(async () => {
  db = new PGlite();
  await db.exec(bootstrapSql);
  const migration = await readFile(
    new URL("../../supabase/migrations/20260824170000_customer_opportunity_manager.sql", import.meta.url),
    "utf8"
  );
  await db.exec(migration);
});

test.after(async () => {
  await db.close();
});

test("CRM migration backfills a creation activity even when a legacy activity already exists", async () => {
  const result = await db.query<{ count: number }>(`
    select count(*)::int as count
    from public.lead_events
    where customer_lead_id='${OPPORTUNITY_A}' and event_type='opportunity_created'
  `);
  assert.equal(result.rows[0].count, 1);
});

test("CRM migration grants customers read-only table access and keeps mutation behind RPCs", async () => {
  const result = await db.query<{ table_name: string; role_name: string; can_select: boolean; can_insert: boolean; can_update: boolean; can_delete: boolean; can_truncate: boolean }>(`
    select table_name, role_name,
      has_table_privilege(role_name, 'public.' || table_name, 'select') as can_select,
      has_table_privilege(role_name, 'public.' || table_name, 'insert') as can_insert,
      has_table_privilege(role_name, 'public.' || table_name, 'update') as can_update,
      has_table_privilege(role_name, 'public.' || table_name, 'delete') as can_delete,
      has_table_privilege(role_name, 'public.' || table_name, 'truncate') as can_truncate
    from (values
      ('customer_leads'), ('lead_events'), ('opportunity_notes'),
      ('planning_applications'), ('planning_authority_counties'), ('company_counties'), ('councils')
    ) tables(table_name)
    cross join (values ('anon'), ('authenticated')) roles(role_name)
    order by table_name, role_name
  `);
  assert.equal(result.rows.length, 14);
  for (const grant of result.rows) {
    assert.equal(grant.can_select, grant.role_name === "authenticated", `${grant.role_name} select on ${grant.table_name}`);
    assert.equal(grant.can_insert, false, `${grant.role_name} insert on ${grant.table_name}`);
    assert.equal(grant.can_update, false, `${grant.role_name} update on ${grant.table_name}`);
    assert.equal(grant.can_delete, false, `${grant.role_name} delete on ${grant.table_name}`);
    assert.equal(grant.can_truncate, false, `${grant.role_name} truncate on ${grant.table_name}`);
  }
  const legacy = await db.query<{ can_execute: boolean }>(`
    select has_function_privilege(
      'authenticated',
      'public.set_customer_lead_status(uuid, public.lead_status)',
      'execute'
    ) as can_execute
  `);
  assert.equal(legacy.rows[0].can_execute, false, "legacy membership-only mutation RPC must be disabled");
});

test("CRM security helper binds the claimed user to auth.uid and RLS isolates companies and counties", async () => {
  await asRole("authenticated", USER_A, async () => {
    const spoof = await db.query<{ allowed: boolean }>(
      "select private.can_manage_customer_opportunity($1::uuid, $2::uuid) as allowed",
      [OPPORTUNITY_B, USER_B]
    );
    assert.equal(spoof.rows[0].allowed, false);

    const visible = await db.query<{ id: string }>("select id from public.customer_leads order by id");
    assert.deepEqual(visible.rows.map((row) => row.id), [OPPORTUNITY_A]);

    const own = await db.query<{ id: string }>(
      "select public.update_customer_opportunity($1::uuid, 'reviewing') as id",
      [OPPORTUNITY_A]
    );
    assert.equal(own.rows[0].id, OPPORTUNITY_A);
    await assert.rejects(
      db.query("select public.update_customer_opportunity($1::uuid, 'reviewing')", [OPPORTUNITY_B]),
      /outside the active entitlement/
    );
    await assert.rejects(
      db.query("select public.update_customer_opportunity($1::uuid, 'reviewing')", [OPPORTUNITY_OUTSIDE_A]),
      /outside the active entitlement/
    );
  });

  await asRole("authenticated", USER_B, async () => {
    const visible = await db.query<{ id: string }>("select id from public.customer_leads order by id");
    assert.deepEqual(visible.rows.map((row) => row.id), [OPPORTUNITY_B]);
  });

  await asRole("anon", null, async () => {
    await assert.rejects(
      db.query("select public.update_customer_opportunity($1::uuid, 'reviewing')", [OPPORTUNITY_A]),
      /permission denied/
    );
  });
});

test("customer RPCs support the complete CRM workflow while notes remain tenant-isolated", async () => {
  let noteA = "";
  await asRole("authenticated", USER_A, async () => {
    await db.query(
      "select public.update_customer_opportunity($1::uuid, 'contacted', $2::timestamptz, 6250, null)",
      [OPPORTUNITY_A, "2026-08-30T08:30:00Z"]
    );
    const contacted = await db.query<{ status: string; contacted_at: string | null; follow_up_at: string | null; quote_value_gbp: string | null }>(
      "select status,contacted_at,follow_up_at,quote_value_gbp from public.customer_leads where id=$1",
      [OPPORTUNITY_A]
    );
    assert.equal(contacted.rows[0].status, "contacted");
    assert.ok(contacted.rows[0].contacted_at);
    assert.equal(new Date(contacted.rows[0].follow_up_at!).toISOString(), "2026-08-30T08:30:00.000Z");
    assert.equal(contacted.rows[0].quote_value_gbp, "6250.00");

    await db.query(
      "select public.update_customer_opportunity($1::uuid, 'won', null, 6250, 6000)",
      [OPPORTUNITY_A]
    );
    const won = await db.query<{ status: string; won_at: string | null; won_value_gbp: string | null }>(
      "select status,won_at,won_value_gbp from public.customer_leads where id=$1",
      [OPPORTUNITY_A]
    );
    assert.equal(won.rows[0].status, "won");
    assert.ok(won.rows[0].won_at);
    assert.equal(won.rows[0].won_value_gbp, "6000.00");

    await db.query(
      "select public.update_customer_opportunity($1::uuid, 'lost', null, 6250, null, 'Price')",
      [OPPORTUNITY_A]
    );
    const lost = await db.query<{ status: string; lost_at: string | null; lost_reason: string | null; won_at: string | null }>(
      "select status,lost_at,lost_reason,won_at from public.customer_leads where id=$1",
      [OPPORTUNITY_A]
    );
    assert.equal(lost.rows[0].status, "lost");
    assert.ok(lost.rows[0].lost_at);
    assert.equal(lost.rows[0].lost_reason, "Price");
    assert.equal(lost.rows[0].won_at, null);

    await db.query(
      "select public.update_customer_opportunity($1::uuid, 'not_relevant', null, null, null, null, 'Wrong type of work')",
      [OPPORTUNITY_A]
    );
    const notRelevant = await db.query<{ status: string; not_relevant_at: string | null; not_relevant_reason: string | null; lost_at: string | null }>(
      "select status,not_relevant_at,not_relevant_reason,lost_at from public.customer_leads where id=$1",
      [OPPORTUNITY_A]
    );
    assert.equal(notRelevant.rows[0].status, "not_relevant");
    assert.ok(notRelevant.rows[0].not_relevant_at);
    assert.equal(notRelevant.rows[0].not_relevant_reason, "Wrong type of work");
    assert.equal(notRelevant.rows[0].lost_at, null);

    const added = await db.query<{ id: string }>(
      "select public.add_customer_opportunity_note($1::uuid, '  Company A note  ') as id",
      [OPPORTUNITY_A]
    );
    noteA = added.rows[0].id;
    const ownNotes = await db.query<{ body: string }>("select body from public.opportunity_notes order by created_at");
    assert.deepEqual(ownNotes.rows, [{ body: "Company A note" }]);
    await db.query("select public.update_customer_opportunity_note($1::uuid, 'Updated A note')", [noteA]);
    await assert.rejects(
      db.query("select public.add_customer_opportunity_note($1::uuid, 'Cross-tenant note')", [OPPORTUNITY_B]),
      /outside the active entitlement/
    );
    await assert.rejects(
      db.query("select public.add_customer_opportunity_note($1::uuid, $2)", [OPPORTUNITY_A, "x".repeat(4001)]),
      /between 1 and 4000 characters/
    );
    await assert.rejects(
      db.query("select public.update_customer_opportunity($1::uuid, 'quoted', null, -1)", [OPPORTUNITY_A]),
      /between zero and 100000000/
    );
  });

  await asRole("authenticated", USER_B, async () => {
    await db.query("select public.update_customer_opportunity($1::uuid, 'reviewing')", [OPPORTUNITY_B]);
    await db.query("select public.add_customer_opportunity_note($1::uuid, 'Company B note')", [OPPORTUNITY_B]);
    const ownNotes = await db.query<{ body: string }>("select body from public.opportunity_notes order by created_at");
    assert.deepEqual(ownNotes.rows, [{ body: "Company B note" }]);
    await assert.rejects(
      db.query("select public.update_customer_opportunity_note($1::uuid, 'Stolen')", [noteA]),
      /outside the active entitlement/
    );
  });
});

test("leaving Won clears current won revenue and terminal timestamp without erasing quote history", async () => {
  await asRole("authenticated", USER_A, async () => {
    await db.query(
      "select public.update_customer_opportunity($1::uuid, 'won', null, 6000, 5500)",
      [OPPORTUNITY_A]
    );
    await db.query(
      "select public.update_customer_opportunity($1::uuid, 'reviewing', null, 6000, 5500)",
      [OPPORTUNITY_A]
    );
    const result = await db.query<{ won_at: string | null; won_value_gbp: string | null; quoted_at: string | null }>(
      "select won_at, won_value_gbp, quoted_at from public.customer_leads where id=$1",
      [OPPORTUNITY_A]
    );
    assert.equal(result.rows[0].won_at, null);
    assert.equal(result.rows[0].won_value_gbp, null);
    assert.ok(result.rows[0].quoted_at);
  });
});

test("inactive subscription removes read and mutation entitlement immediately", async () => {
  await db.query("update public.subscriptions set status='canceled' where company_id=$1", [COMPANY_A]);
  try {
    await asRole("authenticated", USER_A, async () => {
      const visible = await db.query<{ id: string }>("select id from public.customer_leads");
      assert.deepEqual(visible.rows, []);
      await assert.rejects(
        db.query("select public.update_customer_opportunity($1::uuid, 'reviewing')", [OPPORTUNITY_A]),
        /outside the active entitlement/
      );
    });
  } finally {
    await db.query("update public.subscriptions set status='active' where company_id=$1", [COMPANY_A]);
  }
});
