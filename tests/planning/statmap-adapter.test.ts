import assert from "node:assert/strict";
import test from "node:test";
import { fetchStatMapApplications } from "../../lib/planning/adapters/statmap.ts";
import type { PlanningSourceRecord } from "../../lib/planning/types.ts";

const endpoint = "https://eaststaffs-publicportal.statmap.co.uk/horizoNext/publicportal";
const source: PlanningSourceRecord = {
  id: "east-staffordshire-statmap",
  councilId: "east-staffordshire",
  councilSlug: "east-staffordshire",
  councilName: "East Staffordshire",
  slug: "official",
  adapter: "custom",
  endpointUrl: endpoint,
  format: "json",
  config: { provider: "statmap_horizon", lookbackDays: 7, maxPages: 10, pageSize: 2 }
};

function responseAt(url: string, body: unknown, init: ResponseInit = {}) {
  const response = typeof body === "string"
    ? new Response(body, init)
    : Response.json(body, init);
  Object.defineProperty(response, "url", { value: url });
  return response;
}

function row(id: number, reference: string) {
  return {
    id,
    name: reference,
    address: `${id} High Street, Burton-on-Trent DE14 1AA`,
    proposal: `Replacement windows ${id}`,
    status: "Pending",
    receivedDate: "2026-08-18T00:00:00",
    decision: null,
    decisionDate: null,
    applicationTypeId_relatedRecord: { name: "Householder" }
  };
}

function detail(id: number, reference: string) {
  return {
    ...row(id, reference),
    validDate: "2026-08-20T00:00:00",
    registeredDate: "2026-08-19T00:00:00",
    applicant: { name: "A Applicant" },
    agent: { name: "A Agent", email: "agent@example.test" }
  };
}

test("fetchStatMapApplications retrieves every advertised page and enriches visible references", async () => {
  const originalFetch = globalThis.fetch;
  const offsets: number[] = [];
  let activeDetails = 0;
  let peakDetails = 0;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith("/api/publicportal/planningApplications/pageRequest")) {
      const payload = JSON.parse(String(init.body));
      offsets.push(payload.offset);
      assert.deepEqual(payload.order, { id: "asc" });
      assert.deepEqual(payload.filter.parts[0].filterItems, [
        { columnName: "validatedDateFrom", value: "2026-08-17T00:00:00.000Z", operator: "=" },
        { columnName: "validatedDateTo", value: "2026-08-24T23:59:59.999Z", operator: "=" }
      ]);
      const records = payload.offset === 0
        ? [row(101, "P/2026/0101"), row(102, "P/2026/0102")]
        : [row(103, "P/2026/0103")];
      return responseAt(url, { total: 3, records });
    }
    const match = url.match(/planningApplications\/(\d+)$/);
    if (match) {
      activeDetails += 1;
      peakDetails = Math.max(peakDetails, activeDetails);
      await new Promise((resolve) => setTimeout(resolve, 2));
      activeDetails -= 1;
      return responseAt(url, detail(Number(match[1]), `P/2026/0${match[1]}`));
    }
    throw new Error(`Unexpected request ${url}`);
  };

  try {
    const applications = await fetchStatMapApplications(source, {
      now: new Date("2026-08-24T12:00:00.000Z"),
      detailConcurrency: 5
    });
    assert.deepEqual(offsets, [0, 2]);
    assert.equal(applications.length, 3);
    assert.equal(peakDetails, 3);
    assert.deepEqual(applications.map((application) => application.externalReference), [
      "P/2026/0101", "P/2026/0102", "P/2026/0103"
    ]);
    assert.equal(applications[0].validatedAt, "2026-08-20");
    assert.equal(applications[0].postcode, "DE14 1AA");
    assert.equal(applications[0].sourceUrl, `${endpoint}/planningapplications/101`);
    assert.equal(applications[0].latitude, null);
    assert.equal(applications[0].longitude, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchStatMapApplications retains a safe base record when optional detail fails", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/pageRequest")) return responseAt(url, { total: 1, records: [row(101, "P/2026/0101")] });
    return responseAt(url, "<h1>Unavailable private-body</h1>", {
      status: 503,
      statusText: "Unavailable",
      headers: { "content-type": "text/html" }
    });
  };
  try {
    const [application] = await fetchStatMapApplications(source, { now: new Date("2026-08-24T12:00:00Z") });
    assert.equal(application.externalReference, "P/2026/0101");
    assert.equal(application.proposal, "Replacement windows 101");
    assert.equal(application.validatedAt, null);
    assert.match(JSON.stringify(application.rawPayload), /load-detail rejected.*status=503/);
    assert.doesNotMatch(JSON.stringify(application.rawPayload), /private-body|agent@example/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchStatMapApplications fails closed on incomplete totals, duplicate references, and page caps", async () => {
  const cases = [
    { config: { pageSize: 2, maxPages: 10 }, response: { total: 3, records: [row(1, "A"), row(2, "B")] }, pattern: /total mismatch|empty page|complete/ },
    { config: { pageSize: 2, maxPages: 10 }, response: { total: 2, records: [row(1, "A"), row(2, "A")] }, pattern: /duplicate planning reference/ },
    { config: { pageSize: 2, maxPages: 1 }, response: { total: 3, records: [row(1, "A"), row(2, "B")] }, pattern: /page cap/ }
  ];
  const originalFetch = globalThis.fetch;
  try {
    for (const item of cases) {
      globalThis.fetch = async (input) => responseAt(String(input), item.response);
      await assert.rejects(
        fetchStatMapApplications({ ...source, config: { ...source.config, ...item.config, enrichDetails: false } }),
        item.pattern
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchStatMapApplications rejects a detail reference mismatch", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/pageRequest")) return responseAt(url, { total: 1, records: [row(101, "P/2026/0101")] });
    return responseAt(url, detail(101, "P/2026/9999"));
  };
  try {
    await assert.rejects(fetchStatMapApplications(source), /detail reference mismatch/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchStatMapApplications reports nested transport codes without configured secrets", async () => {
  const originalFetch = globalThis.fetch;
  const secret = "statmap-secret";
  globalThis.fetch = async () => {
    const cause = Object.assign(new Error(`socket reset ${secret}`), { code: "ECONNRESET" });
    throw new TypeError("fetch failed", { cause });
  };
  try {
    await assert.rejects(
      fetchStatMapApplications({ ...source, config: { ...source.config, requestHeaders: { authorization: secret } } }),
      (error: Error) => {
        assert.match(error.message, /StatMap search request failed/);
        assert.match(error.message, /host=eaststaffs-publicportal\.statmap\.co\.uk/);
        assert.match(error.message, /ECONNRESET/);
        assert.doesNotMatch(error.message, new RegExp(secret));
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchStatMapApplications rejects unsafe endpoints and cross-origin redirects", async () => {
  await assert.rejects(
    fetchStatMapApplications({ ...source, endpointUrl: "http://eaststaffs-publicportal.statmap.co.uk/horizoNext/publicportal" }),
    /HTTPS/
  );
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => responseAt(String(input), null, {
    status: 302,
    headers: { location: "https://untrusted.example/api" }
  });
  try {
    await assert.rejects(fetchStatMapApplications(source), /cross-origin redirect/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchStatMapApplications classifies malformed JSON without echoing response data", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => responseAt(
    String(input),
    "private-personal-response",
    { headers: { "content-type": "application/json" } }
  );
  try {
    await assert.rejects(fetchStatMapApplications(source), (error: Error) => {
      assert.match(error.message, /malformed JSON/);
      assert.match(error.message, /operation=search/);
      assert.doesNotMatch(error.message, /private-personal-response/);
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
