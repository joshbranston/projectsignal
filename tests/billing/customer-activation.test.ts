import assert from "node:assert/strict";
import test from "node:test";
import { activateInitialCustomerAccess } from "../../lib/billing/customer-activation.ts";

function adminMock(options: {
  activated?: number;
  backfilled?: number;
  error?: unknown;
} = {}) {
  const calls: Array<{ method: string; args: unknown }> = [];
  const admin = {
    async rpc(name: string, args: unknown) {
      calls.push({ method: "rpc", args: [name, args] });
      return {
        data: {
          activatedCounties: options.activated ?? 3,
          backfilledOpportunities: options.backfilled ?? 12
        },
        error: options.error ?? null
      };
    }
  };
  return { admin, calls };
}

test("newly activated counties receive one bounded initial backfill", async () => {
  const { admin, calls } = adminMock({ activated: 3, backfilled: 18 });
  const result = await activateInitialCustomerAccess(admin, {
    companyId: "company-1",
    effectiveAt: "2026-08-26T08:00:00.000Z",
    lockedUntil: "2026-09-26T08:00:00.000Z",
    stripeEventId: "evt_1"
  });

  assert.deepEqual(result, { activatedCounties: 3, backfilledOpportunities: 18 });
  assert.equal(calls.filter((call) => call.method === "rpc").length, 1);
  assert.match(JSON.stringify(calls), /activate_initial_customer_access/);
  assert.equal(JSON.stringify(calls).includes("30"), false, "lookback cannot be widened by callers");
});

test("renewal events still reach the atomic RPC so county locks can advance", async () => {
  const { admin, calls } = adminMock({ activated: 0, backfilled: 0 });
  const result = await activateInitialCustomerAccess(admin, {
    companyId: "company-1",
    effectiveAt: "2026-08-26T08:00:00.000Z",
    lockedUntil: "2026-09-26T08:00:00.000Z",
    stripeEventId: "evt_renewal"
  });

  assert.deepEqual(result, { activatedCounties: 0, backfilledOpportunities: 0 });
  assert.equal(calls.filter((call) => call.method === "rpc").length, 1);
  assert.match(JSON.stringify(calls), /2026-09-26/);
});

test("atomic activation failures are surfaced for Stripe retry", async () => {
  await assert.rejects(
    activateInitialCustomerAccess(adminMock({ error: { message: "activation or backfill failed" } }).admin, {
      companyId: "company-1", effectiveAt: "2026-08-26T08:00:00.000Z", lockedUntil: null, stripeEventId: "evt_1"
    }),
    /activate and backfill customer access: activation or backfill failed/
  );
});
