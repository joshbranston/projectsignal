import assert from "node:assert/strict";
import test from "node:test";
import {
  CRM_STAGES,
  normaliseOpportunityStage,
  parseOpportunityMutation,
  parseOpportunityNote
} from "../../lib/crm/domain.ts";
import {
  calculatePipelineMetrics,
  classifyFollowUp,
  filterCustomerOpportunities,
  sortCustomerOpportunities,
  type CustomerOpportunitySummary
} from "../../lib/crm/opportunities.ts";

const base: CustomerOpportunitySummary = {
  id: "11111111-1111-4111-8111-111111111111",
  status: "new",
  priority: "HIGH",
  score: 8,
  externalReference: "26/00123/FUL",
  address: "1 High Street, Stafford ST16 1AA",
  postcode: "ST16 1AA",
  proposal: "Erection of a replacement dwelling",
  councilName: "Stafford",
  countyNames: ["Staffordshire"],
  applicationType: "Full planning",
  validatedAt: "2026-08-23",
  firstViewedAt: null,
  followUpAt: null,
  contactedAt: null,
  quotedAt: null,
  wonAt: null,
  quoteValueGbp: null,
  wonValueGbp: null,
  estimatedValueMinGbp: 15000,
  estimatedValueMaxGbp: 40000
};

test("CRM stages are canonical while legacy lead values normalize safely", () => {
  assert.deepEqual(CRM_STAGES, [
    "new", "reviewing", "contacted", "quoted", "follow_up", "won", "lost", "not_relevant"
  ]);
  assert.equal(normaliseOpportunityStage("interested"), "reviewing");
  assert.equal(normaliseOpportunityStage("ignored"), "not_relevant");
  assert.equal(normaliseOpportunityStage("quoted"), "quoted");
  assert.throws(() => normaliseOpportunityStage("admin"), /Invalid opportunity stage/);
});

test("opportunity mutation validates IDs, dates, money, stage and reason enums", () => {
  const mutation = parseOpportunityMutation({
    opportunityId: base.id,
    stage: "won",
    followUpAt: "2026-08-30T09:30:00+01:00",
    quoteValueGbp: "6500",
    wonValueGbp: "6200",
    lostReason: "",
    notRelevantReason: ""
  });

  assert.equal(mutation.stage, "won");
  assert.equal(mutation.quoteValueGbp, 6500);
  assert.equal(mutation.wonValueGbp, 6200);
  assert.equal(mutation.followUpAt, "2026-08-30T08:30:00.000Z");
  assert.throws(
    () => parseOpportunityMutation({ ...mutation, quoteValueGbp: -1 }),
    /Quote value must be zero or greater/
  );
  assert.throws(
    () => parseOpportunityMutation({ ...mutation, lostReason: "Secret reason" }),
    /Invalid lost reason/
  );
  assert.throws(
    () => parseOpportunityMutation({ ...mutation, followUpAt: "tomorrow-ish" }),
    /Follow-up must be a valid date/
  );
});

test("opportunity notes trim safe text and enforce the body length boundary", () => {
  assert.deepEqual(
    parseOpportunityNote({ opportunityId: base.id, body: "  Called applicant; retry Friday.  " }),
    { opportunityId: base.id, body: "Called applicant; retry Friday." }
  );
  assert.throws(() => parseOpportunityNote({ opportunityId: base.id, body: "" }), /Note is required/);
  assert.throws(
    () => parseOpportunityNote({ opportunityId: base.id, body: "x".repeat(4001) }),
    /Note must be 4000 characters or fewer/
  );
});

test("follow-up classification distinguishes overdue, today, upcoming and unset", () => {
  const now = new Date("2026-08-24T12:00:00+01:00");
  assert.equal(classifyFollowUp(null, now), "none");
  assert.equal(classifyFollowUp("2026-08-23T09:00:00+01:00", now), "overdue");
  assert.equal(classifyFollowUp("2026-08-24T18:00:00+01:00", now), "today");
  assert.equal(classifyFollowUp("2026-08-26T09:00:00+01:00", now), "upcoming");
});

test("dashboard metrics separate estimated value, quote pipeline and actual won ROI", () => {
  const opportunities: CustomerOpportunitySummary[] = [
    base,
    { ...base, id: "22222222-2222-4222-8222-222222222222", status: "contacted", firstViewedAt: "2026-08-20T10:00:00Z", contactedAt: "2026-08-20T10:00:00Z" },
    { ...base, id: "33333333-3333-4333-8333-333333333333", status: "quoted", firstViewedAt: "2026-08-20T10:00:00Z", contactedAt: "2026-08-20T10:00:00Z", quotedAt: "2026-08-21T10:00:00Z", quoteValueGbp: 7000 },
    { ...base, id: "44444444-4444-4444-8444-444444444444", status: "won", firstViewedAt: "2026-08-20T10:00:00Z", contactedAt: "2026-08-20T10:00:00Z", quotedAt: "2026-08-21T10:00:00Z", wonAt: "2026-08-24T10:00:00Z", quoteValueGbp: 8000, wonValueGbp: 7500 }
  ];
  const metrics = calculatePipelineMetrics(opportunities, 237);

  assert.equal(metrics.delivered, 4);
  assert.equal(metrics.reviewed, 3);
  assert.equal(metrics.contacted, 3);
  assert.equal(metrics.quoted, 2);
  assert.equal(metrics.won, 1);
  assert.equal(metrics.quotePipelineGbp, 7000);
  assert.equal(metrics.wonValueGbp, 7500);
  assert.equal(metrics.contactedToQuotedPercent, 66.7);
  assert.equal(metrics.quotedToWonPercent, 50);
  assert.equal(metrics.roiMultiple, 31.65);
  assert.equal(calculatePipelineMetrics(opportunities, 0).roiMultiple, null);
});

test("dashboard ROI excludes stale won values from opportunities that are no longer Won", () => {
  const metrics = calculatePipelineMetrics([
    { ...base, status: "won", wonAt: "2026-08-24T10:00:00Z", wonValueGbp: 7500 },
    { ...base, id: "55555555-5555-4555-8555-555555555555", status: "reviewing", wonAt: null, wonValueGbp: 5000 }
  ], 250);

  assert.equal(metrics.wonValueGbp, 7500);
  assert.equal(metrics.roiMultiple, 30);
});

test("opportunity filters search customer-visible planning facts and follow-up state", () => {
  const due = {
    ...base,
    status: "follow_up" as const,
    priority: "HOT" as const,
    followUpAt: "2026-08-23T09:00:00Z"
  };
  const other = {
    ...base,
    id: "22222222-2222-4222-8222-222222222222",
    externalReference: "26/00999/FUL",
    postcode: "LE1 1AA",
    address: "Leicester LE1 1AA",
    proposal: "Single-storey rear extension",
    councilName: "Leicester",
    countyNames: ["Leicestershire"],
    priority: "MEDIUM"
  } as CustomerOpportunitySummary;

  const filtered = filterCustomerOpportunities([other, due], {
    stages: ["follow_up"],
    priorities: ["HOT"],
    county: "Staffordshire",
    council: "Stafford",
    search: "26/00123 st16",
    followUp: "overdue"
  }, new Date("2026-08-24T12:00:00Z"));

  assert.deepEqual(filtered.map((item) => item.id), [base.id]);
});

test("default opportunity ordering puts active work before closed work, then score and recency", () => {
  const sorted = sortCustomerOpportunities([
    { ...base, id: "22222222-2222-4222-8222-222222222222", status: "won", score: 10 },
    { ...base, id: "33333333-3333-4333-8333-333333333333", score: 7, validatedAt: "2026-08-24" },
    { ...base, id: "44444444-4444-4444-8444-444444444444", score: 9, validatedAt: "2026-08-20" }
  ]);

  assert.deepEqual(sorted.map((item) => item.id), [
    "44444444-4444-4444-8444-444444444444",
    "33333333-3333-4333-8333-333333333333",
    "22222222-2222-4222-8222-222222222222"
  ]);
});
