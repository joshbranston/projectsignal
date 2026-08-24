import assert from "node:assert/strict";
import test from "node:test";

async function loadMapping() {
  try {
    return await import("../../lib/territory/england-authority-counties.ts");
  } catch {
    return {} as Record<string, unknown>;
  }
}

const COUNTY_SLUGS = new Set([
  "bedfordshire", "berkshire", "bristol", "buckinghamshire", "cambridgeshire", "cheshire",
  "city-of-london", "cornwall", "cumbria", "derbyshire", "devon", "dorset", "durham",
  "east-riding-of-yorkshire", "east-sussex", "essex", "gloucestershire", "greater-london",
  "greater-manchester", "hampshire", "herefordshire", "hertfordshire", "isle-of-wight", "kent",
  "lancashire", "leicestershire", "lincolnshire", "merseyside", "norfolk", "north-yorkshire",
  "northamptonshire", "northumberland", "nottinghamshire", "oxfordshire", "rutland", "shropshire",
  "somerset", "south-yorkshire", "staffordshire", "suffolk", "surrey", "tyne-and-wear",
  "warwickshire", "west-midlands", "west-sussex", "west-yorkshire", "wiltshire", "worcestershire"
]);

test("every Planning Data England LPA entity has at least one valid county mapping", async () => {
  const module = await loadMapping();
  assert.equal(typeof module.allEnglandPlanningDataEntities, "function");
  assert.equal(typeof module.countySlugsForPlanningDataEntity, "function");

  const entities = (module.allEnglandPlanningDataEntities as () => number[])();
  const countiesFor = module.countySlugsForPlanningDataEntity as (entity: number) => string[];

  assert.equal(entities.length, 337);
  assert.deepEqual(entities, Array.from({ length: 337 }, (_, index) => 626001 + index));

  for (const entity of entities) {
    const slugs = countiesFor(entity);
    assert.ok(slugs.length > 0, `entity ${entity} has no county mapping`);
    for (const slug of slugs) {
      assert.ok(COUNTY_SLUGS.has(slug), `entity ${entity} maps to unknown county ${slug}`);
    }
  }
});

test("initial ProjectSignal counties map to their expected Planning Data authorities", async () => {
  const module = await loadMapping();
  const countiesFor = module.countySlugsForPlanningDataEntity as (entity: number) => string[];

  assert.deepEqual(countiesFor(626090), ["leicestershire"]);
  assert.deepEqual(countiesFor(626118), ["staffordshire"]);
  for (const entity of [626125, 626126, 626127, 626128, 626129]) {
    assert.deepEqual(countiesFor(entity), ["warwickshire"]);
  }
});

test("cross-county LPAs preserve many-to-many ceremonial county coverage", async () => {
  const module = await loadMapping();
  const countiesFor = module.countySlugsForPlanningDataEntity as (entity: number) => string[];

  assert.deepEqual(countiesFor(626007), ["durham", "north-yorkshire"]);
  assert.deepEqual(countiesFor(626324), [
    "cheshire",
    "derbyshire",
    "greater-manchester",
    "south-yorkshire",
    "staffordshire",
    "west-yorkshire"
  ]);
  assert.deepEqual(countiesFor(626325), ["east-sussex", "hampshire", "west-sussex"]);
  assert.deepEqual(countiesFor(626326), ["norfolk", "suffolk"]);
  assert.deepEqual(countiesFor(626327), ["cumbria", "lancashire", "north-yorkshire"]);
});

test("flattened mapping includes one row per authority/county relationship", async () => {
  const module = await loadMapping();
  assert.equal(typeof module.buildEnglandAuthorityCountyMappings, "function");
  const rows = (module.buildEnglandAuthorityCountyMappings as () => Array<{ planningDataEntity: number; countySlug: string }>)();
  assert.ok(rows.length > 337);
  assert.ok(rows.some((row) => row.planningDataEntity === 626324 && row.countySlug === "staffordshire"));
});
