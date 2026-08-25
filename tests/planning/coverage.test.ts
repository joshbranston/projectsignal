import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPlanningCoverageInventory,
  summarisePlanningCoverage,
  type OfficialPlanningSourceDefinition
} from "../../lib/planning/coverage.ts";
import { buildEnglandAuthorityCountyMappings } from "../../lib/territory/england-authority-counties.ts";

const authorities = [
  { entity: 626086, name: "Charnwood", slug: "charnwood", active: true },
  { entity: 626115, name: "Cannock Chase", slug: "cannock-chase", active: true },
  { entity: 626324, name: "Peak District National Park", slug: "peak-district-national-park", active: true }
];

const mappings = [
  { planningDataEntity: 626086, countySlug: "leicestershire" },
  { planningDataEntity: 626115, countySlug: "staffordshire" },
  { planningDataEntity: 626324, countySlug: "derbyshire" },
  { planningDataEntity: 626324, countySlug: "staffordshire" }
];

const sources: OfficialPlanningSourceDefinition[] = [
  {
    authoritySlug: "charnwood",
    platform: "NEC ASSURE",
    adapter: "custom",
    provider: "assure",
    officialCouncilPage: "https://www.charnwood.gov.uk/planning",
    endpoint: "https://planning.example.test/Assure/OnlinePlanningSearch",
    status: "live",
    classification: "OFFICIAL_LIVE",
    evidence: "Production-verified official source",
    lastInvestigatedAt: "2026-08-24"
  },
  {
    authoritySlug: "peak-district-national-park",
    platform: "NEC ASSURE",
    adapter: "custom",
    provider: "assure",
    officialCouncilPage: "https://www.peakdistrict.gov.uk/planning",
    endpoint: "https://peak.example.test/AssureLive/OnlinePlanningSearch",
    status: "blocked",
    classification: "OFFICIAL_BLOCKED_INCOMPLETE",
    blocker: "Official route is known but production use remains disabled",
    evidence: "Bounded local protocol test",
    lastInvestigatedAt: "2026-08-24"
  }
];

test("coverage inventory preserves every authority, multi-county mapping and fallback", () => {
  const inventory = buildPlanningCoverageInventory(authorities, mappings, sources);

  assert.equal(inventory.length, 3);
  assert.deepEqual(inventory[2]?.countySlugs, ["derbyshire", "staffordshire"]);
  assert.equal(inventory[0]?.officialSource?.status, "live");
  assert.equal(inventory[0]?.officialSource?.classification, "OFFICIAL_LIVE");
  assert.equal(inventory[1]?.officialSource, null);
  assert.deepEqual(inventory[1]?.fallback, {
    platform: "PlanIt",
    adapter: "custom",
    provider: "planit",
    status: "active"
  });
  assert.equal(inventory[2]?.officialSource?.blocker, "Official route is known but production use remains disabled");
});

test("coverage inventory rejects duplicate definitions and unsafe or unexplained official sources", () => {
  assert.throws(
    () => buildPlanningCoverageInventory(authorities, mappings, [sources[0]!, sources[0]!]),
    /duplicate.*charnwood/i
  );
  assert.throws(
    () => buildPlanningCoverageInventory(authorities, mappings, [{
      ...sources[0]!,
      endpoint: "http://planning.example.test/search"
    }]),
    /HTTPS/i
  );
  assert.throws(
    () => buildPlanningCoverageInventory(authorities, mappings, [{
      ...sources[1]!,
      blocker: undefined
    }]),
    /blocker/i
  );
});

test("coverage inventory fails when an active authority has no customer-facing county", () => {
  assert.throws(
    () => buildPlanningCoverageInventory(authorities, mappings.slice(0, 1), sources),
    /Cannock Chase.*county mapping/
  );
});

test("national mapping spans 337 authorities and all 48 customer-facing counties", () => {
  const nationalAuthorities = Array.from({ length: 337 }, (_, index) => ({
    entity: 626001 + index,
    name: `Authority ${626001 + index}`,
    slug: `authority-${626001 + index}`,
    active: true
  }));
  const inventory = buildPlanningCoverageInventory(
    nationalAuthorities,
    buildEnglandAuthorityCountyMappings(),
    []
  );
  const summary = summarisePlanningCoverage(inventory);

  assert.equal(summary.authorities, 337);
  assert.equal(summary.counties, 48);
  assert.equal(summary.fallbackCovered, 337);
  assert.equal(summary.officialLive, 0);
  assert.equal(summary.officialUnclassified, 337);
  assert.equal(summary.officialBlockedTls, 0);
  assert.equal(summary.officialUnsupported, 0);
});
