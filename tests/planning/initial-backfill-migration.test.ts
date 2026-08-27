import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const COMPANY = "11111111-1111-4111-8111-111111111111";
const TRADE = "22222222-2222-4222-8222-222222222222";
const TERRITORY = "33333333-3333-4333-8333-333333333333";
const COUNTY_A = "44444444-4444-4444-8444-444444444444";
const COUNTY_B = "55555555-5555-4555-8555-555555555555";
const COUNCIL = "66666666-6666-4666-8666-666666666666";
const OTHER_COUNCIL = "77777777-7777-4777-8777-777777777777";

const bootstrap = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create type public.subscription_status as enum ('active','incomplete','past_due','canceled');
  create type public.lead_status as enum ('new','reviewing','contacted','quoted','follow_up','won','lost','not_relevant');
  create table companies(id uuid primary key);
  create table subscriptions(company_id uuid primary key references companies(id), status subscription_status not null);
  create table trades(id uuid primary key);
  create table company_trades(company_id uuid references companies(id), trade_id uuid references trades(id), min_opportunity_gbp integer, primary key(company_id,trade_id));
  create table territories(id uuid primary key, company_id uuid references companies(id), minimum_score numeric not null, active boolean not null, created_at timestamptz not null default now());
  create table counties(id uuid primary key);
  create table company_counties(company_id uuid references companies(id), county_id uuid references counties(id), status text not null, starts_at timestamptz);
  create table councils(id uuid primary key);
  create table planning_authority_counties(council_id uuid references councils(id), county_id uuid references counties(id), primary key(council_id,county_id));
  create table planning_applications(
    id uuid primary key, council_id uuid references councils(id), address text, postcode text, stage text,
    proposal text not null, first_seen_at timestamptz not null
  );
  create table application_trade_opportunities(
    planning_application_id uuid references planning_applications(id), trade_id uuid references trades(id),
    score numeric not null, estimated_value_min_gbp integer, estimated_value_max_gbp integer,
    reason text, recommended_approach text, primary key(planning_application_id,trade_id)
  );
  create table customer_leads(
    id uuid primary key default gen_random_uuid(), company_id uuid references companies(id), territory_id uuid references territories(id),
    planning_application_id uuid references planning_applications(id), trade_id uuid references trades(id), score numeric not null,
    priority text not null, title text not null, address text, postcode text, stage text, proposal text,
    estimated_value_min_gbp integer, estimated_value_max_gbp integer, why_it_matches text, recommended_approach text,
    status lead_status not null default 'new', matched_at timestamptz not null default now(),
    unique(company_id,planning_application_id,trade_id)
  );
  grant all on all tables in schema public to service_role;

  insert into companies values ('${COMPANY}');
  insert into subscriptions values ('${COMPANY}','active');
  insert into trades values ('${TRADE}');
  insert into company_trades values ('${COMPANY}','${TRADE}',5000);
  insert into territories values ('${TERRITORY}','${COMPANY}',7,true,now());
  insert into counties values ('${COUNTY_A}'),('${COUNTY_B}');
  insert into company_counties values ('${COMPANY}','${COUNTY_A}','active',now()),('${COMPANY}','${COUNTY_B}','active',now());
  insert into councils values ('${COUNCIL}'),('${OTHER_COUNCIL}');
  insert into planning_authority_counties values ('${COUNCIL}','${COUNTY_A}'),('${COUNCIL}','${COUNTY_B}'),('${OTHER_COUNCIL}','${COUNTY_B}');
  insert into planning_applications values
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','${COUNCIL}','1 High Street','LE1 1AA','Pending','Two-storey extension',now()-interval '2 days'),
    ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','${COUNCIL}','2 High Street','LE1 1AB','Pending','Small extension',now()-interval '2 days'),
    ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','${COUNCIL}','3 High Street','LE1 1AC','Pending','Old extension',now()-interval '31 days'),
    ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','${OTHER_COUNCIL}','4 High Street','LE1 1AD','Pending','Low value windows',now()-interval '2 days'),
    ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','${COUNCIL}','5 High Street','LE1 1AE','Pending','Approval of Condition 5 - Windows and Doors',now()-interval '2 days');
  insert into application_trade_opportunities values
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','${TRADE}',8,10000,25000,'Strong extension','Contact promptly'),
    ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','${TRADE}',6,10000,15000,'Weak extension','Review'),
    ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','${TRADE}',9,15000,30000,'Old opportunity','Review'),
    ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','${TRADE}',9,2000,5000,'Below value threshold','Review'),
    ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','${TRADE}',9,10000,20000,'Stale administrative score','Review');
`;

test("initial backfill is fixed to 30 days, entitlement-scoped, idempotent, and service-role-only", async () => {
  const db = new PGlite();
  try {
    await db.exec(bootstrap);
    const migration = await readFile(
      new URL("../../supabase/migrations/20260826090000_initial_opportunity_backfill.sql", import.meta.url),
      "utf8"
    );
    await db.exec(migration);

    await db.exec("set role service_role");
    const first = await db.query<{ count: number }>(
      "select public.backfill_initial_company_opportunities($1)::int count",
      [COMPANY]
    );
    const second = await db.query<{ count: number }>(
      "select public.backfill_initial_company_opportunities($1)::int count",
      [COMPANY]
    );
    await db.exec("reset role");

    assert.equal(first.rows[0].count, 1);
    assert.equal(second.rows[0].count, 0);
    const rows = await db.query<{ priority: string; proposal: string }>("select priority,proposal from customer_leads");
    assert.deepEqual(rows.rows, [{ priority: "HIGH", proposal: "Two-storey extension" }]);

    const grants = await db.query<{ authenticated: boolean; service_role: boolean }>(`
      select
        has_function_privilege('authenticated','public.backfill_initial_company_opportunities(uuid)','execute') authenticated,
        has_function_privilege('service_role','public.backfill_initial_company_opportunities(uuid)','execute') service_role
    `);
    assert.deepEqual(grants.rows[0], { authenticated: false, service_role: true });
  } finally {
    await db.close();
  }
});
