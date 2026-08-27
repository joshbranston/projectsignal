import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const COMPANY = "11111111-1111-4111-8111-111111111111";

test("activation, lock, and initial backfill roll back together and retry safely", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create table public.company_counties(
        company_id uuid, status text, starts_at timestamptz, locked_until timestamptz, updated_at timestamptz
      );
      create table public.backfill_audit(company_id uuid primary key);
      insert into public.company_counties values ('${COMPANY}','scheduled',null,null,now());

      create function public.activate_initial_company_counties(uuid,timestamptz,timestamptz,text)
      returns integer language plpgsql as $$
      declare n integer;
      begin
        update public.company_counties set status='active', starts_at=$2, locked_until=$3
        where company_id=$1 and status='scheduled';
        get diagnostics n = row_count;
        return n;
      end $$;

      create function public.backfill_initial_company_opportunities(uuid)
      returns integer language plpgsql as $$
      begin
        if current_setting('projectsignal.fail_backfill', true) = 'on' then
          raise exception 'forced backfill failure';
        end if;
        insert into public.backfill_audit values ($1) on conflict do nothing;
        return 1;
      end $$;
    `);
    const migration = await readFile(
      new URL("../../supabase/migrations/20260827123450_atomic_initial_customer_activation.sql", import.meta.url),
      "utf8"
    );
    await db.exec(migration);

    await db.exec("set role service_role; set projectsignal.fail_backfill = 'on'");
    await assert.rejects(
      db.query("select public.activate_initial_customer_access($1,now(),now()+interval '30 days','evt_1')", [COMPANY]),
      /forced backfill failure/
    );
    await db.exec("reset role");
    let county = await db.query<{ status: string }>("select status from company_counties where company_id=$1", [COMPANY]);
    assert.equal(county.rows[0].status, "scheduled", "failed backfill must roll activation back");

    await db.exec("set role service_role; set projectsignal.fail_backfill = 'off'");
    const retry = await db.query<{ result: { activatedCounties: number; backfilledOpportunities: number } }>(
      "select public.activate_initial_customer_access($1,now(),now()+interval '30 days','evt_1') result",
      [COMPANY]
    );
    assert.deepEqual(retry.rows[0].result, { activatedCounties: 1, backfilledOpportunities: 1 });

    const renewal = await db.query<{ result: { activatedCounties: number; backfilledOpportunities: number } }>(
      "select public.activate_initial_customer_access($1,now(),now()+interval '60 days','evt_renewal') result",
      [COMPANY]
    );
    assert.deepEqual(renewal.rows[0].result, { activatedCounties: 0, backfilledOpportunities: 0 });
    await db.exec("reset role");
    county = await db.query<{ status: string; locked: boolean }>(
      "select status, locked_until > now()+interval '50 days' locked from company_counties where company_id=$1",
      [COMPANY]
    );
    assert.deepEqual(county.rows[0], { status: "active", locked: true });

    const privileges = await db.query<{ authenticated: boolean; service_role: boolean }>(`
      select
        has_function_privilege('authenticated','public.activate_initial_customer_access(uuid,timestamptz,timestamptz,text)','execute') authenticated,
        has_function_privilege('service_role','public.activate_initial_customer_access(uuid,timestamptz,timestamptz,text)','execute') service_role
    `);
    assert.deepEqual(privileges.rows[0], { authenticated: false, service_role: true });
  } finally {
    await db.close();
  }
});
