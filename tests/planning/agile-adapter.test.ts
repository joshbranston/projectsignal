import assert from "node:assert/strict";
import test from "node:test";
import { fetchAgileApplications } from "../../lib/planning/adapters/agile.ts";
import type { PlanningSourceRecord } from "../../lib/planning/types.ts";

const endpoint = "https://planning.agileapplications.co.uk/cannock";
const source: PlanningSourceRecord = {
  id: "cannock-agile",
  councilId: "cannock",
  councilSlug: "cannock-chase",
  councilName: "Cannock Chase",
  slug: "official",
  adapter: "custom",
  endpointUrl: endpoint,
  format: "json",
  config: { provider: "agile_applications", lookbackDays: 7, enrichDetails: true }
};

function responseAt(url: string, body: unknown, init: ResponseInit = {}) {
  const response = typeof body === "string" ? new Response(body, init) : Response.json(body, init);
  Object.defineProperty(response, "url", { value: url });
  return response;
}

const searchRow = {
  id: 321,
  reference: "CH/26/0321",
  proposal: "Replacement windows",
  location: "1 Market Street, Cannock WS11 1AA",
  applicationType: "Householder",
  status: "Pending",
  registrationDate: "2026-08-19T00:00:00",
  validDate: "2026-08-20T00:00:00",
  decisionDate: null,
  decisionText: null,
  applicantSurname: "Applicant",
  agentName: "Agent Ltd"
};

const detail = {
  ...searchRow,
  fullProposal: "Replacement of all timber windows",
  applicantName: "A Applicant",
  agentName: "Agent Ltd",
  agentEmail: "agent@example.test",
  receivedDate: "2026-08-18T00:00:00"
};

test("fetchAgileApplications bootstraps the public API and normalises a complete bounded search", async () => {
  const originalFetch = globalThis.fetch;
  const seenHeaders: Headers[] = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url === "https://identity.agileapplications.co.uk/api/client/get?url=cannock") {
      return responseAt(url, { client: "public-cannock-client" });
    }
    const headers = new Headers(init.headers);
    seenHeaders.push(headers);
    assert.equal(headers.get("x-client"), "public-cannock-client");
    assert.equal(headers.get("x-product"), "CITIZENPORTAL");
    assert.equal(headers.get("x-service"), "PA");
    if (url === "https://identity.agileapplications.co.uk/api/configuration/API_URL") {
      return responseAt(url, { value: "https://planningapi.agileapplications.co.uk" });
    }
    if (url.startsWith("https://planningapi.agileapplications.co.uk/api/application/search?")) {
      const parsed = new URL(url);
      assert.equal(parsed.searchParams.get("validDateFrom"), "2026-08-17T00:00:00.000Z");
      assert.equal(parsed.searchParams.get("validDateTo"), "2026-08-24T23:59:59.999Z");
      return responseAt(url, { total: 1, results: [searchRow] });
    }
    if (url.endsWith("/api/application/321")) return responseAt(url, detail);
    throw new Error(`Unexpected request ${url}`);
  };

  try {
    const [application] = await fetchAgileApplications(source, { now: new Date("2026-08-24T12:00:00Z") });
    assert.ok(seenHeaders.length >= 3);
    assert.equal(application.externalReference, "CH/26/0321");
    assert.equal(application.proposal, "Replacement of all timber windows");
    assert.equal(application.postcode, "WS11 1AA");
    assert.equal(application.submittedAt, "2026-08-18");
    assert.equal(application.validatedAt, "2026-08-20");
    assert.equal(application.sourceUrl, `${endpoint}/application-details/321`);
    assert.doesNotMatch(JSON.stringify(application.rawPayload), /agent@example\.test|public-cannock-client/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchAgileApplications retains the base result after optional detail rejection", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/api/client/get")) return responseAt(url, { value: "public-client" });
    if (url.includes("/api/configuration/API_URL")) return responseAt(url, { value: "https://planningapi.agileapplications.co.uk" });
    if (url.includes("/api/application/search")) return responseAt(url, { total: 1, results: [searchRow] });
    return responseAt(url, "private rejected detail", { status: 503, headers: { "content-type": "text/plain" } });
  };
  try {
    const [application] = await fetchAgileApplications(source, { now: new Date("2026-08-24T12:00:00Z") });
    assert.equal(application.externalReference, "CH/26/0321");
    assert.equal(application.proposal, "Replacement windows");
    assert.match(JSON.stringify(application.rawPayload), /load-detail rejected.*status=503/);
    assert.doesNotMatch(JSON.stringify(application.rawPayload), /private rejected detail|public-client/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchAgileApplications fails closed on advertised total or visible reference inconsistency", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const search of [
      { total: 2, results: [searchRow] },
      { total: 2, results: [searchRow, { ...searchRow, id: 322 }] }
    ]) {
      globalThis.fetch = async (input) => {
        const url = String(input);
        if (url.includes("/api/client/get")) return responseAt(url, { value: "public-client" });
        if (url.includes("/api/configuration/API_URL")) return responseAt(url, { value: "https://planningapi.agileapplications.co.uk" });
        return responseAt(url, search);
      };
      await assert.rejects(fetchAgileApplications({ ...source, config: { ...source.config, enrichDetails: false } }), /total mismatch|duplicate planning reference/);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchAgileApplications rejects a mismatched detail reference", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/api/client/get")) return responseAt(url, { clientId: "public-client" });
    if (url.includes("/api/configuration/API_URL")) return responseAt(url, { configurationValue: "https://planningapi.agileapplications.co.uk" });
    if (url.includes("/api/application/search")) return responseAt(url, { total: 1, results: [searchRow] });
    return responseAt(url, { ...detail, reference: "CH/26/9999" });
  };
  try {
    await assert.rejects(fetchAgileApplications(source), /detail reference mismatch/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchAgileApplications rejects unsafe portal and dynamically resolved API hosts", async () => {
  await assert.rejects(
    fetchAgileApplications({ ...source, endpointUrl: "http://planning.agileapplications.co.uk/cannock" }),
    /HTTPS/
  );
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/api/client/get")) return responseAt(url, { value: "public-client" });
    return responseAt(url, { value: "https://attacker.example/api" });
  };
  try {
    await assert.rejects(fetchAgileApplications(source), /unsupported Agile API host/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchAgileApplications retains nested transport diagnostics but redacts bootstrap headers", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/api/client/get")) return responseAt(url, { value: "bootstrap-secret" });
    if (url.includes("/api/configuration/API_URL")) return responseAt(url, { value: "https://planningapi.agileapplications.co.uk" });
    const cause = Object.assign(new Error("connect timeout bootstrap-secret"), { code: "UND_ERR_CONNECT_TIMEOUT" });
    throw new TypeError("fetch failed", { cause });
  };
  try {
    await assert.rejects(fetchAgileApplications(source), (error: Error) => {
      assert.match(error.message, /Agile search request failed/);
      assert.match(error.message, /host=planningapi\.agileapplications\.co\.uk/);
      assert.match(error.message, /UND_ERR_CONNECT_TIMEOUT/);
      assert.doesNotMatch(error.message, /bootstrap-secret/);
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchAgileApplications sends fixed public platform headers and not configured credentials", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Headers[] = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.includes("/api/client/get")) return responseAt(url, { value: "resolved-client" });
    const headers = new Headers(init.headers);
    requests.push(headers);
    if (url.includes("/api/configuration/API_URL")) {
      return responseAt(url, { value: "https://planningapi.agileapplications.co.uk" });
    }
    return responseAt(url, { total: 0, results: [] });
  };
  try {
    await fetchAgileApplications({
      ...source,
      config: {
        ...source.config,
        enrichDetails: false,
        requestHeaders: { authorization: "Bearer must-not-be-sent", "x-client": "must-not-override" }
      }
    });
    assert.ok(requests.length >= 2);
    for (const headers of requests) {
      assert.equal(headers.get("x-client"), "resolved-client");
      assert.equal(headers.get("x-product"), "CITIZENPORTAL");
      assert.equal(headers.get("x-service"), "PA");
      assert.equal(headers.get("authorization"), null);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchAgileApplications classifies malformed JSON without echoing response data", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => responseAt(
    String(input),
    "private-bootstrap-response",
    { headers: { "content-type": "application/json" } }
  );
  try {
    await assert.rejects(fetchAgileApplications(source), (error: Error) => {
      assert.match(error.message, /malformed JSON/);
      assert.match(error.message, /operation=resolve-client/);
      assert.doesNotMatch(error.message, /private-bootstrap-response/);
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchAgileApplications rejects a cross-origin redirect before forwarding platform headers", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async (input) => {
    requests += 1;
    const url = String(input);
    return responseAt(url, null, {
      status: 302,
      headers: { location: "https://planningapi.agileapplications.co.uk/api/client/get" }
    });
  };
  try {
    await assert.rejects(fetchAgileApplications(source), /cross-origin redirect/);
    assert.equal(requests, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
