import assert from "node:assert/strict";
import test from "node:test";
import { buildDailyOpportunityDigest } from "../../lib/notifications/digest.ts";

const lead = (index: number) => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  priority: index % 2 ? "HIGH" : "HOT",
  address: index === 1 ? "<img src=x onerror=alert(1)>" : `Address ${index}`,
  postcode: `LE1 ${index}AA`,
  proposal: index === 1 ? "Extension <script>bad()</script>" : `Proposal ${index}`,
  estimated_value_min_gbp: 5000,
  estimated_value_max_gbp: 15000
});

test("daily digest is bounded, links to opportunities, and escapes customer/upstream text", () => {
  const digest = buildDailyOpportunityDigest({
    companyName: "A & B <Windows>",
    leads: Array.from({ length: 8 }, (_, index) => lead(index + 1)),
    siteUrl: "https://projectsignal-tau.vercel.app"
  });
  assert.ok(digest);

  assert.equal(digest.leadIds.length, 5);
  assert.equal(digest.subject, "5 new opportunities in your ProjectSignal territories");
  assert.match(digest.html, /A &amp; B &lt;Windows&gt;/);
  assert.doesNotMatch(digest.html, /<script>|<img/);
  assert.match(digest.html, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
  assert.match(digest.html, /\/dashboard\/opportunities\/00000000-0000-4000-8000-000000000001/);
  assert.doesNotMatch(digest.html, /\/10/);
  assert.doesNotMatch(digest.html, /Proposal 6/);
});

test("empty digest returns null so customers are not sent empty email", () => {
  assert.equal(buildDailyOpportunityDigest({ companyName: "Example", leads: [], siteUrl: "https://example.com" }), null);
});
