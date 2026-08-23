import assert from "node:assert/strict";
import test from "node:test";

async function loadGeo() {
  try {
    return await import("../../lib/territory/geo.ts");
  } catch {
    return {} as Record<string, unknown>;
  }
}

test("normalises ceremonial county source names to ProjectSignal slugs", async () => {
  const module = await loadGeo();
  assert.equal(typeof module.countyNameToSlug, "function");
  const slug = module.countyNameToSlug as (name: string) => string;
  assert.equal(slug("Tyne & Wear"), "tyne-and-wear");
  assert.equal(slug("County Durham"), "durham");
  assert.equal(slug("City of London"), "city-of-london");
});

test("converts a polygon into an SVG path inside the England viewbox", async () => {
  const module = await loadGeo();
  assert.equal(typeof module.geometryToSvgPath, "function");
  const path = module.geometryToSvgPath as (geometry: any) => string;
  const value = path({
    type: "Polygon",
    coordinates: [[[-1, 52], [0, 52], [0, 53], [-1, 53], [-1, 52]]]
  });
  assert.match(value, /^M/);
  assert.match(value, /Z$/);
});
