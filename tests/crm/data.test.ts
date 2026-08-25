import assert from "node:assert/strict";
import test from "node:test";
import { isCrmSchemaUnavailableError, normaliseCustomerOpportunityRow } from "../../lib/crm/data.ts";

test("customer opportunity row normalizes legacy stage and related planning facts", () => {
  const opportunity = normaliseCustomerOpportunityRow({
    id: "11111111-1111-4111-8111-111111111111",
    status: "interested",
    priority: "HIGH",
    score: "8.2",
    address: "1 High Street, Stafford ST16 1AA",
    postcode: "ST16 1AA",
    proposal: "Replacement dwelling",
    estimated_value_min_gbp: 15000,
    estimated_value_max_gbp: 40000,
    why_it_matches: "Replacement dwelling likely needs a full glazing package.",
    recommended_approach: "Review and contact.",
    first_viewed_at: "2026-08-24T09:00:00Z",
    follow_up_at: null,
    contacted_at: null,
    quoted_at: null,
    won_at: null,
    quote_value_gbp: null,
    won_value_gbp: null,
    planning_application: {
      external_reference: "26/00123/FUL",
      application_type: "Full planning",
      submitted_at: "2026-08-20",
      validated_at: "2026-08-21",
      stage: "Pending",
      decision: null,
      source_url: "https://planning.example.test/application/26-00123",
      applicant_name: "A Applicant",
      agent_name: "An Agent",
      council: {
        name: "Stafford",
        planning_authority_counties: [
          { county: { name: "Staffordshire", slug: "staffordshire" } }
        ]
      }
    }
  });

  assert.equal(opportunity.status, "reviewing");
  assert.equal(opportunity.externalReference, "26/00123/FUL");
  assert.equal(opportunity.councilName, "Stafford");
  assert.deepEqual(opportunity.countyNames, ["Staffordshire"]);
  assert.equal(opportunity.sourceUrl, "https://planning.example.test/application/26-00123");
  assert.equal(opportunity.estimatedValueMaxGbp, 40000);
});

test("customer opportunity row fails closed when required customer-visible identity is missing", () => {
  assert.throws(
    () => normaliseCustomerOpportunityRow({ id: "11111111-1111-4111-8111-111111111111" }),
    /missing planning application identity/
  );
});

test("CRM schema detection recognizes only missing migration objects", () => {
  assert.equal(isCrmSchemaUnavailableError({
    code: "PGRST204",
    message: "Could not find the 'first_viewed_at' column of 'customer_leads' in the schema cache"
  }), true);
  assert.equal(isCrmSchemaUnavailableError({
    code: "42P01",
    message: 'relation "opportunity_notes" does not exist'
  }), true);
  assert.equal(isCrmSchemaUnavailableError({
    code: "42703",
    message: 'column customer_leads.won_value_gbp does not exist'
  }), true);

  assert.equal(isCrmSchemaUnavailableError({ code: "PGRST204", message: "Could not find an unrelated column" }), false);
  assert.equal(isCrmSchemaUnavailableError({ code: "08006", message: "connection failure" }), false);
  assert.equal(isCrmSchemaUnavailableError({ code: "42501", message: "permission denied" }), false);
});
