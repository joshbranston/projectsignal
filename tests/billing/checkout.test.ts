import assert from "node:assert/strict";
import test from "node:test";
import {
  billingDatabaseError,
  configuredStripePriceId,
  safeBillingDiagnostic
} from "../../lib/billing/checkout.ts";

test("checkout requires the server-controlled configured Stripe price", () => {
  assert.equal(configuredStripePriceId(" price_live_configured "), "price_live_configured");
  assert.throws(() => configuredStripePriceId(), /not configured/i);
});

test("billing diagnostics retain safe codes without leaking messages or request data", () => {
  const diagnostic = safeBillingDiagnostic({
    name: "StripeInvalidRequestError",
    code: "resource_missing",
    type: "invalid_request_error",
    message: "secret customer details",
    raw: { requestHeaders: { authorization: "Bearer secret" } }
  });
  assert.deepEqual(diagnostic, {
    name: "StripeInvalidRequestError",
    code: "resource_missing",
    type: "invalid_request_error"
  });
  assert.doesNotMatch(JSON.stringify(diagnostic), /secret|authorization|customer details/i);
});

test("billing database errors expose only a safe operation identifier", () => {
  const error = billingDatabaseError("read_subscription", { message: "customer secret in database error" });
  assert.deepEqual(safeBillingDiagnostic(error), {
    name: "BillingDatabaseError",
    code: null,
    type: null,
    operation: "read_subscription"
  });
  assert.doesNotMatch(JSON.stringify(safeBillingDiagnostic(error)), /customer secret/i);
});
