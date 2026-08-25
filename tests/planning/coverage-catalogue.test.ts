import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { EVIDENCED_OFFICIAL_PLANNING_SOURCES } from "../../lib/planning/coverage-catalogue.ts";
import { OFFICIAL_SOURCE_CLASSIFICATIONS, validateOfficialPlanningSourceDefinitions } from "../../lib/planning/coverage.ts";

test("official source catalogue classifies all 337 mapped authorities exactly once", () => {
  const slugs = EVIDENCED_OFFICIAL_PLANNING_SOURCES.map((source) => source.authoritySlug);
  assert.equal(slugs.length, 337);
  assert.equal(new Set(slugs).size, slugs.length);
  const investigation = JSON.parse(readFileSync("docs/planning-authority-investigation.json", "utf8")) as {
    authorities: Array<{ authoritySlug: string }>;
  };
  assert.deepEqual(
    [...slugs].sort(),
    investigation.authorities.map((authority) => authority.authoritySlug).sort()
  );
  assert.doesNotThrow(() => validateOfficialPlanningSourceDefinitions(EVIDENCED_OFFICIAL_PLANNING_SOURCES));
  assert.ok(EVIDENCED_OFFICIAL_PLANNING_SOURCES.every((source) => source.endpoint.startsWith("https://")));
  assert.ok(EVIDENCED_OFFICIAL_PLANNING_SOURCES.every((source) =>
    OFFICIAL_SOURCE_CLASSIFICATIONS.includes(source.classification)
  ));

  const classifications = Object.fromEntries(
    EVIDENCED_OFFICIAL_PLANNING_SOURCES.map((source) => [source.authoritySlug, source.classification])
  );
  assert.equal(classifications.wigan, "OFFICIAL_LIVE");
  assert.equal(classifications["east-staffordshire"], "OFFICIAL_READY");
  assert.equal(classifications.harborough, "OFFICIAL_BLOCKED_TIMEOUT");
  assert.equal(classifications["hinckley-bosworth"], "OFFICIAL_BLOCKED_WAF");
  assert.equal(classifications.melton, "OFFICIAL_BLOCKED_PORTAL_DOWN");
  assert.equal(classifications["north-west-leicestershire"], "OFFICIAL_BLOCKED_TLS");
  assert.equal(classifications["oadby-and-wigston"], "OFFICIAL_BLOCKED_TLS");
  assert.equal(classifications["staffordshire-moorlands"], "OFFICIAL_BLOCKED_UNSAFE_PROTOCOL");
});
