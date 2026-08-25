import assert from "node:assert/strict";
import test from "node:test";
import {
  formatGbp,
  parseOpportunityFilters,
  stageLabel
} from "../../lib/crm/presentation.ts";

test("opportunity query parsing accepts customer filters and ignores invalid enum values", () => {
  assert.deepEqual(parseOpportunityFilters({
    stage: ["quoted", "admin"],
    priority: "HIGH",
    date: "7d",
    county: " Staffordshire ",
    council: "Stafford",
    applicationType: "Full planning",
    valueMin: "5000",
    valueMax: "25000",
    followUp: "due",
    q: "  ST16 26/00123 ",
    page: "2"
  }), {
    filters: {
      stages: ["quoted"],
      priorities: ["HIGH"],
      date: "7d",
      county: "Staffordshire",
      council: "Stafford",
      applicationType: "Full planning",
      minEstimatedValueGbp: 5000,
      maxEstimatedValueGbp: 25000,
      followUp: "due",
      search: "ST16 26/00123"
    },
    page: 2
  });
});

test("customer-facing money and stage labels remain explicit", () => {
  assert.equal(formatGbp(6500), "£6,500");
  assert.equal(formatGbp(null), "Not set");
  assert.equal(stageLabel("follow_up"), "Follow Up");
  assert.equal(stageLabel("not_relevant"), "Not Relevant");
});
