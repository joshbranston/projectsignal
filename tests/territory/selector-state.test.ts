import assert from "node:assert/strict";
import test from "node:test";
import { toggleCountySelection } from "../../lib/territory/selector-state.ts";

test("toggleCountySelection adds an unselected county below the plan limit", () => {
  assert.deepEqual(toggleCountySelection(["leicestershire"], "derbyshire", 3), [
    "leicestershire",
    "derbyshire"
  ]);
});

test("toggleCountySelection removes an already selected county", () => {
  assert.deepEqual(
    toggleCountySelection(["leicestershire", "derbyshire"], "leicestershire", 3),
    ["derbyshire"]
  );
});

test("toggleCountySelection refuses a fourth county when the plan limit is three", () => {
  assert.deepEqual(
    toggleCountySelection(
      ["leicestershire", "derbyshire", "staffordshire"],
      "nottinghamshire",
      3
    ),
    ["leicestershire", "derbyshire", "staffordshire"]
  );
});

test("toggleCountySelection normalises duplicate input before adding", () => {
  assert.deepEqual(
    toggleCountySelection(["Leicestershire", " leicestershire "], "Derbyshire", 3),
    ["leicestershire", "derbyshire"]
  );
});
