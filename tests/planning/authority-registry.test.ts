import assert from "node:assert/strict";
import test from "node:test";

async function loadRegistry() {
  try {
    return await import("../../lib/planning/authority-registry.ts");
  } catch {
    return {} as Record<string, unknown>;
  }
}

test("Planning Data registry URL requests the complete LPA identity fields", async () => {
  const module = await loadRegistry();
  assert.equal(typeof module.buildPlanningDataAuthorityUrl, "function");
  const url = new URL((module.buildPlanningDataAuthorityUrl as () => string)());

  assert.equal(url.origin, "https://www.planning.data.gov.uk");
  assert.equal(url.pathname, "/entity.json");
  assert.equal(url.searchParams.get("dataset"), "local-planning-authority");
  assert.equal(url.searchParams.get("limit"), "500");
  assert.deepEqual(url.searchParams.getAll("field"), [
    "entity",
    "name",
    "reference",
    "start-date",
    "end-date"
  ]);
});

test("normalises a Planning Data authority and preserves existing pilot slugs", async () => {
  const module = await loadRegistry();
  assert.equal(typeof module.normalisePlanningDataAuthority, "function");
  const normalise = module.normalisePlanningDataAuthority as (input: unknown, today?: Date) => any;

  assert.deepEqual(
    normalise(
      {
        entity: 626090,
        name: "North West Leicestershire LPA",
        reference: "E60000090",
        "start-date": "2024-06-30",
        "end-date": ""
      },
      new Date("2026-08-23T00:00:00Z")
    ),
    {
      entity: 626090,
      name: "North West Leicestershire",
      reference: "E60000090",
      slug: "north-west-leicestershire",
      startDate: "2024-06-30",
      endDate: null,
      active: true
    }
  );

  assert.equal(
    normalise({ entity: 626088, name: "Hinckley and Bosworth LPA", reference: "E60000088" }).slug,
    "hinckley-bosworth"
  );
});

test("end-dated authorities remain in the registry but are inactive", async () => {
  const module = await loadRegistry();
  const normalise = module.normalisePlanningDataAuthority as (input: unknown, today?: Date) => any;
  const result = normalise(
    {
      entity: 626058,
      name: "Hambleton LPA",
      reference: "E60000058",
      "end-date": "2023-03-31"
    },
    new Date("2026-08-23T00:00:00Z")
  );
  assert.equal(result.active, false);
  assert.equal(result.endDate, "2023-03-31");
});

test("registry validation rejects partial or duplicate Planning Data responses", async () => {
  const module = await loadRegistry();
  assert.equal(typeof module.validateEnglandAuthorityRegistry, "function");
  const validate = module.validateEnglandAuthorityRegistry as (rows: Array<{ entity: number }>) => void;

  assert.throws(() => validate([{ entity: 626001 }]), /337/);

  const duplicate = Array.from({ length: 337 }, (_, index) => ({ entity: 626001 + index }));
  duplicate[336] = { entity: 626001 };
  assert.throws(() => validate(duplicate), /duplicate|unique/i);
});

test("fetchEnglandAuthorityRegistry requires all 337 authorities", async () => {
  const module = await loadRegistry();
  assert.equal(typeof module.fetchEnglandAuthorityRegistry, "function");
  const fetchRegistry = module.fetchEnglandAuthorityRegistry as (fetchImpl: typeof fetch) => Promise<any[]>;

  const entities = Array.from({ length: 337 }, (_, index) => ({
    entity: 626001 + index,
    name: `Authority ${index + 1} LPA`,
    reference: `E${626001 + index}`,
    "start-date": "2024-01-01",
    "end-date": ""
  }));

  const fakeFetch = (async () =>
    new Response(JSON.stringify({ count: 337, entities }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })) as typeof fetch;

  const rows = await fetchRegistry(fakeFetch);
  assert.equal(rows.length, 337);
  assert.equal(rows[0].entity, 626001);
  assert.equal(rows[336].entity, 626337);
});

test("syncEnglandAuthorityRegistry sends registry and county mappings through service-only RPCs", async () => {
  const module = await loadRegistry();
  assert.equal(typeof module.syncEnglandAuthorityRegistry, "function");
  const sync = module.syncEnglandAuthorityRegistry as (admin: any, fetchImpl: typeof fetch) => Promise<any>;

  const entities = Array.from({ length: 337 }, (_, index) => ({
    entity: 626001 + index,
    name: `Authority ${index + 1} LPA`,
    reference: `E${626001 + index}`,
    "start-date": "2024-01-01",
    "end-date": ""
  }));

  const fakeFetch = (async () =>
    new Response(JSON.stringify({ count: 337, entities }), { status: 200 })) as typeof fetch;

  const calls: Array<{ name: string; args: any }> = [];
  const admin = {
    rpc: async (name: string, args: any) => {
      calls.push({ name, args });
      if (name === "sync_england_lpa_registry") {
        return { data: { inserted: 330, updated: 7, processed: 337 }, error: null };
      }
      if (name === "sync_england_lpa_county_mappings") {
        return { data: { mappingsWritten: args.p_mappings.length }, error: null };
      }
      throw new Error(`Unexpected RPC ${name}`);
    }
  };

  const result = await sync(admin, fakeFetch);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].name, "sync_england_lpa_registry");
  assert.equal(calls[0].args.p_authorities.length, 337);
  assert.equal(calls[1].name, "sync_england_lpa_county_mappings");
  assert.ok(calls[1].args.p_mappings.length > 337);
  assert.equal(result.authoritiesFetched, 337);
  assert.equal(result.authoritiesActive, 337);
  assert.equal(result.mappingsWritten, calls[1].args.p_mappings.length);
});
