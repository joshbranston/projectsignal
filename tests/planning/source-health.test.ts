import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSourceHealthRows,
  hasSourceHealthAccess
} from "../../lib/planning/source-health.ts";

test("source health access requires the exact configured bearer secret", () => {
  assert.equal(hasSourceHealthAccess("Bearer expected-secret", "expected-secret"), true);
  assert.equal(hasSourceHealthAccess("Bearer wrong-secret", "expected-secret"), false);
  assert.equal(hasSourceHealthAccess("expected-secret", "expected-secret"), false);
  assert.equal(hasSourceHealthAccess(null, "expected-secret"), false);
  assert.equal(hasSourceHealthAccess("Bearer expected-secret", undefined), false);
});

test("source health groups official and fallback state without exposing config secrets", () => {
  const secret = "source-token-123";
  const cookieSecret = "portal-session-456";
  const rows = buildSourceHealthRows([
    {
      id: "primary",
      adapter: "custom",
      config: { provider: "assure", requestHeaders: { Authorization: `Bearer ${secret}` } },
      source_role: "primary",
      active: true,
      last_scanned_at: "2026-08-24T10:00:00Z",
      last_success_at: "2026-08-24T10:00:00Z",
      next_scan_at: "2026-08-25T10:00:00Z",
      consecutive_failures: 0,
      last_error: null,
      council: {
        id: "council-1",
        name: "Charnwood",
        planning_authority_counties: [{ county: { name: "Leicestershire" } }]
      }
    },
    {
      id: "fallback",
      adapter: "custom",
      config: { provider: "planit", api_key: secret },
      source_role: "fallback",
      active: true,
      last_scanned_at: null,
      last_success_at: null,
      next_scan_at: null,
      consecutive_failures: 2,
      last_error:
        `request failed https://portal-user:portal-password@api.example.test/search?api_key=${secret} ` +
        `Cookie: ASP.NET_SessionId=${cookieSecret}; X-Api-Key: ${secret}`,
      council: { id: "council-1", name: "Charnwood", planning_authority_counties: [{ county: { name: "Leicestershire" } }] }
    }
  ]);

  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.officialActive, true);
  assert.equal(rows[0]?.fallbackActive, true);
  assert.equal(rows[0]?.platform, "NEC ASSURE");
  assert.deepEqual(rows[0]?.counties, ["Leicestershire"]);
  assert.doesNotMatch(JSON.stringify(rows), new RegExp(secret));
  assert.doesNotMatch(JSON.stringify(rows), new RegExp(cookieSecret));
  assert.doesNotMatch(JSON.stringify(rows), /portal-user|portal-password/);
  assert.match(rows[1]?.error ?? "", /api_key=.*REDACTED/);
});
