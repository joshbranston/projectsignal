import assert from "node:assert/strict";
import test from "node:test";
import { bootstrapPlanningScheduler, normaliseProjectBaseUrl } from "../../lib/planning/scheduler.ts";

test("normaliseProjectBaseUrl strips trailing slashes and requires http(s)", () => {
  assert.equal(normaliseProjectBaseUrl("https://projectsignal-tau.vercel.app///"), "https://projectsignal-tau.vercel.app");
  assert.throws(() => normaliseProjectBaseUrl("projectsignal-tau.vercel.app"), /http/i);
});

test("bootstrapPlanningScheduler passes the secret only to the service RPC", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const admin = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return { data: { scheduled: true, cadence: "*/10 * * * *" }, error: null };
    }
  };

  const result = await bootstrapPlanningScheduler(
    admin,
    "super-secret-value",
    "https://projectsignal-tau.vercel.app/"
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "bootstrap_projectsignal_planning_scheduler");
  assert.deepEqual(calls[0].args, {
    p_cron_secret: "super-secret-value",
    p_base_url: "https://projectsignal-tau.vercel.app"
  });
  assert.deepEqual(result, { scheduled: true, cadence: "*/10 * * * *" });
});
