import assert from "node:assert/strict";
import test from "node:test";
import { analyseWindowsApplication } from "../../lib/planning/scoring.ts";
import { scoreWindowsOpportunity } from "../../lib/scoring.ts";

const base = {
  id: "app-1",
  council_id: "council-1",
  external_reference: "A/26/00123",
  address: "12 Market Street, Wigan WN1 1AA",
  postcode: "WN1 1AA",
  latitude: null,
  longitude: null,
  proposal: "Replacement windows and bi-fold doors",
  stage: null,
  decision: "Approved",
  first_seen_at: "2026-08-23T10:00:00.000Z"
};

test("analyseWindowsApplication converts a strong glazing application into a trade opportunity", () => {
  const result = analyseWindowsApplication(base);
  assert.ok(result);
  assert.equal(result.planningApplicationId, "app-1");
  assert.equal(result.score, 10);
  assert.equal(result.stage, "Approved");
  assert.equal(result.minValue, 5000);
  assert.equal(result.maxValue, 20000);
});

test("analyseWindowsApplication returns null below the qualifying score", () => {
  const result = analyseWindowsApplication({
    ...base,
    proposal: "Works to oak tree canopy",
    decision: "Pending"
  });
  assert.equal(result, null);
});


test("first-floor rear extension is treated as a high-confidence implied glazing opportunity", () => {
  const result = analyseWindowsApplication({
    ...base,
    id: "app-ibstock",
    address: "54 Grange Road Ibstock Coalville Leicestershire LE67 6LF",
    postcode: "LE67 6LF",
    proposal:
      "Erection of a first-floor rear extension and erection of a pitched roof over an existing single-storey rear projection (Amended Scheme to planning permission 26/00531/FUL)",
    decision: ""
  });

  assert.ok(result);
  assert.ok(result.score >= 7, `expected score >= 7, got ${result.score}`);
  assert.ok(result.minValue >= 5000, `expected minimum value >= 5000, got ${result.minValue}`);
  assert.match(result.reason, /first-floor extension/i);
});

test("new dwelling is a high-confidence implied glazing opportunity", () => {
  const result = analyseWindowsApplication({
    ...base,
    proposal: "Erection of one new dwelling with associated parking and landscaping",
    decision: "Pending"
  });

  assert.ok(result);
  assert.ok(result.score >= 7, `expected score >= 7, got ${result.score}`);
  assert.ok(result.minValue >= 10000);
});

test("single-storey rear extension qualifies as a medium implied glazing opportunity", () => {
  const result = analyseWindowsApplication({
    ...base,
    proposal: "Erection of a single-storey rear extension",
    decision: "Pending"
  });

  assert.ok(result);
  assert.ok(result.score >= 5.5 && result.score < 7, `expected 5.5 <= score < 7, got ${result.score}`);
  assert.ok(result.minValue >= 5000);
});

test("dormer or loft work qualifies without explicit glazing wording", () => {
  const result = analyseWindowsApplication({
    ...base,
    proposal: "Loft conversion including rear dormer",
    decision: "Pending"
  });

  assert.ok(result);
  assert.ok(result.score >= 5.5, `expected score >= 5.5, got ${result.score}`);
});

test("telecom pole remains excluded despite being a live application", () => {
  const result = analyseWindowsApplication({
    ...base,
    proposal: "Installation of 1no. 10m Medium Wooden Pole",
    decision: "Undecided"
  });

  assert.equal(result, null);
});

test("replacement dwelling is a high-value high-priority fenestration opportunity", () => {
  const result = scoreWindowsOpportunity(
    "Demolition of existing house and erection of a replacement dwelling",
    "Rural Lane, Staffordshire ST18 0AA",
    "Pending"
  );

  assert.ok(result.score >= 7, `expected replacement dwelling score >= 7, got ${result.score}`);
  assert.ok(result.minValue >= 15000);
  assert.match(result.reason, /replacement dwelling/i);
});

test("bungalow and rural-worker dwelling wording retains the new-home signal", () => {
  for (const proposal of [
    "Erection of a detached bungalow with garage",
    "Erection of a rural worker dwelling and associated access",
    "Erection of a rural worker’s dwelling and associated access"
  ]) {
    const result = scoreWindowsOpportunity(proposal, "Staffordshire ST18 0AA", "Pending");
    assert.ok(result.score >= 5.5, `expected residential score >= 5.5 for ${proposal}, got ${result.score}`);
    assert.ok(result.minValue >= 10000);
  }
});

test("outline status reduces confidence without hiding a multi-unit housing signal", () => {
  const detailed = scoreWindowsOpportunity(
    "Full application for erection of 10 dwellings",
    "Example Road",
    "Pending"
  );
  const outline = scoreWindowsOpportunity(
    "Outline application for erection of 10 dwellings",
    "Example Road",
    "Pending"
  );

  assert.ok(outline.score >= 5.5);
  assert.ok(outline.score < detailed.score, `${outline.score} should be below ${detailed.score}`);
  assert.deepEqual([outline.minValue, outline.maxValue], [50000, 250000]);
});

test("value estimates distinguish a single door from several windows and larger projects", () => {
  const door = scoreWindowsOpportunity("Replacement of one front door", "Example Road", "Pending");
  const windows = scoreWindowsOpportunity("Replacement of eight windows", "Example Road", "Pending");
  const conservatory = scoreWindowsOpportunity("Erection of a conservatory", "Example Road", "Pending");
  const dwelling = scoreWindowsOpportunity("Erection of a new dwelling", "Example Road", "Pending");

  assert.deepEqual([door.minValue, door.maxValue], [1500, 5000]);
  assert.deepEqual([windows.minValue, windows.maxValue], [4000, 15000]);
  assert.deepEqual([conservatory.minValue, conservatory.maxValue], [8000, 25000]);
  assert.deepEqual([dwelling.minValue, dwelling.maxValue], [10000, 30000]);
});

test("generic conditions remain low while explicit glazing conditions rank higher", () => {
  const generic = scoreWindowsOpportunity("Discharge of condition 3", "Example Road", "Pending");
  const glazing = scoreWindowsOpportunity(
    "Discharge of condition 3 relating to replacement windows and doors",
    "Example Road",
    "Pending"
  );

  assert.equal(generic.priority, "LOW");
  assert.ok(glazing.score > generic.score);
});
