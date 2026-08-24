import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchMasterGovApplications,
  parseMasterGovApplicationHtml,
  parseMasterGovSearchResultsHtml
} from "../../lib/planning/adapters/mastergov.ts";
import type { PlanningSourceRecord } from "../../lib/planning/types.ts";

const LEICESTER_BASE_URL = "https://planning.leicester.gov.uk/";

const leicesterSource: PlanningSourceRecord = {
  id: "leicester-mastergov",
  councilId: "leicester",
  councilSlug: "leicester",
  councilName: "Leicester City Council",
  slug: "official",
  adapter: "custom",
  endpointUrl: LEICESTER_BASE_URL,
  format: "html",
  config: { provider: "mastergov", lookbackDays: 7, maxPages: 2 }
};

function responseAt(url: string, body: BodyInit | null, init: ResponseInit = {}) {
  const response = new Response(body, init);
  Object.defineProperty(response, "url", { value: url });
  return response;
}

function resultRow(reference: string) {
  return `<tr>
    <td><a href="/Planning/Display/${reference}">${reference}</a></td>
    <td>1000${reference}</td>
    <td>${reference} Example Road, Leicester LE1 1AA</td>
    <td>Alterations for application ${reference}</td>
    <td>20/08/2026</td><td></td><td>Pending decision</td>
  </tr>`;
}

function resultPage(references: string[], pageLinks = "") {
  return `<div>${references.length} results found</div><table><thead><tr>
    <th>Application Number</th><th>Site Ref (PPRN)</th><th>Location</th>
    <th>Description</th><th>Date Validated</th><th>Decision Date</th><th>Status Decision</th>
  </tr></thead><tbody>${references.map(resultRow).join("")}</tbody></table>${pageLinks}`;
}

function detailPage(reference: string) {
  return `<table>
    <tr><th>Application Number</th><td>${reference}</td></tr>
    <tr><th>Location</th><td>${reference} Example Road, Leicester LE1 1AA</td></tr>
    <tr><th>Description</th><td>Alterations for application ${reference}</td></tr>
    <tr><th>Application Type</th><td>Full application</td></tr>
    <tr><th>Date Received</th><td>18/08/2026</td></tr>
    <tr><th>Date Validated</th><td>20/08/2026</td></tr>
    <tr><th>Status</th><td>Pending decision</td></tr>
  </table>`;
}

const leicesterSearchFixture = `
<!doctype html>
<html>
  <body>
    <div class="search-results-count">39 results found</div>
    <table id="search-results">
      <thead>
        <tr>
          <th>Application Number</th>
          <th>Site Ref (PPRN)</th>
          <th>Location</th>
          <th>Description</th>
          <th>Date Validated</th>
          <th>Decision Date</th>
          <th>Status Decision</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><a href="/Planning/Display/20261245">20261245</a></td>
          <td>100012345678</td>
          <td>1 Kilverstone Avenue</td>
          <td>Demolition of single storey extension at front; construction of single storey extension at side and rear; first floor extension at side; alterations to house (Class C3)</td>
          <td>20/08/2026</td>
          <td></td>
          <td>Pending decision</td>
        </tr>
      </tbody>
    </table>
    <a data-ajax-target="#search-results" href="/Search/ResultsPage/2?module=PLA&amp;tabOrder=0">2</a>
    <a data-ajax-target="#search-results" href="/Search/ResultsPage/3?module=PLA&amp;tabOrder=0">3</a>
  </body>
</html>`;

const leicesterDetailFixture = `
<!doctype html>
<html>
  <head><title>Planning application 20261245</title></head>
  <body>
    <table>
      <tr><th>Application Number</th><td>20261245</td></tr>
      <tr><th>Location Address</th><td>1 Kilverstone Avenue</td></tr>
      <tr><th>Proposal</th><td>Demolition of single storey extension at front; construction of single storey extension at side and rear; first floor extension at side; alterations to house (Class C3)</td></tr>
      <tr><th>Application Type</th><td>Operational development - full application</td></tr>
      <tr><th>Status</th><td>Pending decision</td></tr>
      <tr><th>Application Received Date</th><td>18/08/2026</td></tr>
      <tr><th>Application Valid Date</th><td>20/08/2026</td></tr>
      <tr><th>Agent Name</th><td>Example Planning Agent Ltd</td></tr>
      <tr><th>Agent Address</th><td>10 Example Street, Leicester LE1 1AA</td></tr>
    </table>
  </body>
</html>`;

test("parseMasterGovSearchResultsHtml preserves Leicester references and discovers bounded page URLs", () => {
  const parsed = parseMasterGovSearchResultsHtml(leicesterSearchFixture, LEICESTER_BASE_URL);

  assert.equal(parsed.recognized, true);
  assert.equal(parsed.resultCount, 39);
  assert.deepEqual(parsed.pageUrls, [
    "https://planning.leicester.gov.uk/Search/ResultsPage/2?module=PLA&tabOrder=0",
    "https://planning.leicester.gov.uk/Search/ResultsPage/3?module=PLA&tabOrder=0"
  ]);
  assert.equal(parsed.applications.length, 1);
  assert.equal(parsed.applications[0].externalReference, "20261245");
  assert.equal(parsed.applications[0].sourceUrl, "https://planning.leicester.gov.uk/Planning/Display/20261245");
});

test("parseMasterGovApplicationHtml normalises Leicester application 20261245", () => {
  const search = parseMasterGovSearchResultsHtml(leicesterSearchFixture, LEICESTER_BASE_URL);
  const application = parseMasterGovApplicationHtml({
    detailHtml: leicesterDetailFixture,
    sourceUrl: "https://planning.leicester.gov.uk/Planning/Display/20261245",
    fallback: search.applications[0]
  });

  assert.ok(application);
  assert.deepEqual(application, {
    externalReference: "20261245",
    address: "1 Kilverstone Avenue",
    postcode: null,
    latitude: null,
    longitude: null,
    proposal: "Demolition of single storey extension at front; construction of single storey extension at side and rear; first floor extension at side; alterations to house (Class C3)",
    applicationType: "Operational development - full application",
    stage: "Pending decision",
    submittedAt: "2026-08-18",
    validatedAt: "2026-08-20",
    decisionAt: null,
    decision: null,
    applicantName: null,
    agentName: "Example Planning Agent Ltd",
    agentContact: "10 Example Street, Leicester LE1 1AA",
    sourceUrl: "https://planning.leicester.gov.uk/Planning/Display/20261245",
    rawPayload: {
      search: {
        "Application Number": "20261245",
        "Site Ref (PPRN)": "100012345678",
        Location: "1 Kilverstone Avenue",
        Description: "Demolition of single storey extension at front; construction of single storey extension at side and rear; first floor extension at side; alterations to house (Class C3)",
        "Date Validated": "20/08/2026",
        "Decision Date": "",
        "Status Decision": "Pending decision"
      },
      details: {
        "Application Number": "20261245",
        "Location Address": "1 Kilverstone Avenue",
        Proposal: "Demolition of single storey extension at front; construction of single storey extension at side and rear; first floor extension at side; alterations to house (Class C3)",
        "Application Type": "Operational development - full application",
        Status: "Pending decision",
        "Application Received Date": "18/08/2026",
        "Application Valid Date": "20/08/2026",
        "Agent Name": "Example Planning Agent Ltd",
        "Agent Address": "10 Example Street, Leicester LE1 1AA"
      }
    }
  });
});

test("parseMasterGovApplicationHtml returns the valid search row when detail HTML is malformed", () => {
  const fallback = parseMasterGovSearchResultsHtml(leicesterSearchFixture, LEICESTER_BASE_URL).applications[0];
  const application = parseMasterGovApplicationHtml({
    detailHtml: "<html><body>temporarily unavailable</body></html>",
    sourceUrl: fallback.sourceUrl!,
    fallback
  });

  assert.equal(application, null);
});

test("parseMasterGovApplicationHtml refuses to merge a different application detail page", () => {
  const fallback = parseMasterGovSearchResultsHtml(leicesterSearchFixture, LEICESTER_BASE_URL).applications[0];
  const application = parseMasterGovApplicationHtml({
    detailHtml: detailPage("20269999"),
    sourceUrl: fallback.sourceUrl!,
    fallback
  });

  assert.equal(application, null);
});

test("fetchMasterGovApplications accepts the disclaimer, carries cookies, and uses AJAX pagination", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string; headers: Headers; body: string }> = [];
  let standardSearchVisits = 0;
  const pageLinks = [
    '<a href="/Search/ResultsPage/2?module=PLA&amp;tabOrder=0">2</a>',
    '<a href="/Search/ResultsPage/3?module=PLA&amp;tabOrder=0">3</a>'
  ].join("");

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const parsed = new URL(url);
    const method = String(init.method ?? "GET").toUpperCase();
    const headers = new Headers(init.headers);
    calls.push({ url, method, headers, body: String(init.body ?? "") });
    assert.equal(init.redirect, "manual");

    if (parsed.pathname === "/Search/Standard") {
      standardSearchVisits += 1;
      if (standardSearchVisits === 1) {
        return responseAt(url, null, {
          status: 302,
          headers: {
            location: `/Disclaimer?returnUrl=${encodeURIComponent(`${parsed.pathname}${parsed.search}`)}`,
            "set-cookie": "ASP.NET_SessionId=session-secret; Path=/; HttpOnly; SameSite=Lax"
          }
        });
      }
      assert.match(headers.get("cookie") ?? "", /ASP\.NET_SessionId=session-secret/);
      assert.match(headers.get("cookie") ?? "", /AcceptedDisclaimer=accepted-secret/);
      assert.equal(parsed.searchParams.get("AcknowledgeLetterDateFrom"), "08/17/2026 00:00:00");
      assert.equal(parsed.searchParams.get("AcknowledgeLetterDateTo"), "08/24/2026 00:00:00");
      return responseAt(url, null, { status: 302, headers: { location: "/Search/Results" } });
    }

    if (parsed.pathname === "/Disclaimer") {
      assert.match(headers.get("cookie") ?? "", /ASP\.NET_SessionId=session-secret/);
      return responseAt(url, `<form method="post" action="/Disclaimer/Accept${parsed.search}">
        <input type="hidden" name="__RequestVerificationToken" value="csrf-secret">
      </form>`);
    }

    if (parsed.pathname === "/Disclaimer/Accept") {
      assert.equal(method, "POST");
      assert.equal(headers.get("content-type"), "application/x-www-form-urlencoded");
      assert.match(headers.get("referer") ?? "", /\/Disclaimer\?/);
      assert.match(headers.get("cookie") ?? "", /ASP\.NET_SessionId=session-secret/);
      assert.equal(String(init.body), "__RequestVerificationToken=csrf-secret");
      return responseAt(url, null, {
        status: 302,
        headers: {
          location: decodeURIComponent(parsed.searchParams.get("returnUrl") ?? ""),
          "set-cookie": "AcceptedDisclaimer=accepted-secret; Path=/; HttpOnly; SameSite=Lax"
        }
      });
    }

    if (parsed.pathname === "/Search/Results") {
      assert.match(headers.get("cookie") ?? "", /AcceptedDisclaimer=accepted-secret/);
      return responseAt(url, resultPage(["20261245"], pageLinks), {
        headers: { "content-type": "text/html; charset=utf-8" }
      });
    }

    if (parsed.pathname === "/Search/ResultsPage/2") {
      assert.equal(headers.get("x-requested-with"), "XMLHttpRequest");
      assert.match(headers.get("referer") ?? "", /\/Search\/Results$/);
      return responseAt(url, resultPage(["20261246"]));
    }

    if (parsed.pathname === "/Planning/Display/20261245") {
      assert.match(headers.get("cookie") ?? "", /AcceptedDisclaimer=accepted-secret/);
      return responseAt(url, detailPage("20261245"));
    }
    if (parsed.pathname === "/Planning/Display/20261246") {
      return responseAt(url, "<title>Service unavailable</title><p>private body marker</p>", {
        status: 503,
        headers: { "content-type": "text/html" }
      });
    }

    throw new Error(`Unexpected request: ${method} ${url}`);
  };

  try {
    const applications = await fetchMasterGovApplications(leicesterSource, {
      now: new Date("2026-08-24T12:00:00.000Z")
    });

    assert.equal(applications.length, 2);
    assert.equal(applications[0].externalReference, "20261245");
    assert.equal(applications[0].submittedAt, "2026-08-18");
    assert.equal(applications[1].externalReference, "20261246");
    assert.equal(applications[1].applicationType, null);
    assert.match(String((applications[1].rawPayload as { enrichmentError?: string }).enrichmentError), /status=503/);
    assert.doesNotMatch(JSON.stringify(applications[1].rawPayload), /private body marker/);
    assert.equal(calls.some((call) => new URL(call.url).pathname === "/Search/ResultsPage/3"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchMasterGovApplications caps detail-page concurrency at four", async () => {
  const originalFetch = globalThis.fetch;
  const references = Array.from({ length: 7 }, (_, index) => `2026130${index}`);
  let standardSearchVisits = 0;
  let activeDetails = 0;
  let peakDetails = 0;

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const parsed = new URL(url);
    if (parsed.pathname === "/Search/Standard") {
      standardSearchVisits += 1;
      return standardSearchVisits === 1
        ? responseAt(url, null, { status: 302, headers: { location: "/Disclaimer?returnUrl=%2FSearch%2FStandard", "set-cookie": "ASP.NET_SessionId=session-1; Path=/" } })
        : responseAt(url, null, { status: 302, headers: { location: "/Search/Results" } });
    }
    if (parsed.pathname === "/Disclaimer") {
      return responseAt(url, '<form method="post" action="/Disclaimer/Accept"><input type="hidden" name="flow" value="yes"></form>');
    }
    if (parsed.pathname === "/Disclaimer/Accept") {
      return responseAt(url, null, { status: 302, headers: { location: "/Search/Standard", "set-cookie": "AcceptedDisclaimer=yes; Path=/" } });
    }
    if (parsed.pathname === "/Search/Results") return responseAt(url, resultPage(references));
    if (parsed.pathname.startsWith("/Planning/Display/")) {
      activeDetails += 1;
      peakDetails = Math.max(peakDetails, activeDetails);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeDetails -= 1;
      return responseAt(url, detailPage(parsed.pathname.split("/").at(-1)!));
    }
    throw new Error(`Unexpected ${String(init.method ?? "GET")} ${url}`);
  };

  try {
    const applications = await fetchMasterGovApplications(leicesterSource, {
      now: new Date("2026-08-24T12:00:00.000Z"),
      maxPages: 1
    });
    assert.equal(applications.length, 7);
    assert.equal(peakDetails, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchMasterGovApplications reports sanitized HTTP rejection context", async () => {
  const originalFetch = globalThis.fetch;
  const source: PlanningSourceRecord = {
    ...leicesterSource,
    config: {
      ...leicesterSource.config,
      requestHeaders: { authorization: "Bearer configured-secret" }
    }
  };

  globalThis.fetch = async (input) => responseAt(String(input),
    "<title>Access denied configured-secret</title><p>full private body must not escape</p>", {
      status: 403,
      statusText: "Forbidden",
      headers: {
        "content-type": "text/html; charset=utf-8",
        "set-cookie": "ASP.NET_SessionId=response-secret; Path=/"
      }
    });

  try {
    await assert.rejects(
      fetchMasterGovApplications(source),
      (error: Error) => {
        assert.match(error.message, /MasterGov open-date-search rejected/);
        assert.match(error.message, /host=planning\.leicester\.gov\.uk/);
        assert.match(error.message, /status=403/);
        assert.match(error.message, /content-type=text\/html; charset=utf-8/);
        assert.match(error.message, /title=Access denied \[REDACTED\]/);
        assert.doesNotMatch(error.message, /configured-secret|response-secret|full private body/);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchMasterGovApplications retains nested Node and Undici transport diagnostics", async () => {
  const originalFetch = globalThis.fetch;
  const secret = "transport-secret";
  globalThis.fetch = async () => {
    const cause = Object.assign(new Error(`Connect Timeout Error ${secret}`), { code: "UND_ERR_CONNECT_TIMEOUT" });
    throw new TypeError("fetch failed", { cause });
  };

  try {
    await assert.rejects(
      fetchMasterGovApplications({
        ...leicesterSource,
        config: { ...leicesterSource.config, requestHeaders: { authorization: `Bearer ${secret}` } }
      }),
      (error: Error) => {
        assert.match(error.message, /MasterGov open-date-search request failed/);
        assert.match(error.message, /TypeError: fetch failed/);
        assert.match(error.message, /Error\[UND_ERR_CONNECT_TIMEOUT\]: Connect Timeout Error \[REDACTED\]/);
        assert.match(error.message, /portal=leicester/);
        const chain: string[] = [];
        let current: unknown = error;
        while (current && typeof current === "object") {
          const record = current as Record<string, unknown>;
          chain.push(`${String(record.name)} ${String(record.code ?? "")} ${String(record.message)}`);
          current = record.cause;
        }
        assert.match(chain.join(" | "), /UND_ERR_CONNECT_TIMEOUT/);
        assert.doesNotMatch(chain.join(" | "), new RegExp(secret));
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchMasterGovApplications can return valid search rows without detail enrichment", async () => {
  const originalFetch = globalThis.fetch;
  let detailRequests = 0;
  const source: PlanningSourceRecord = {
    ...leicesterSource,
    config: { ...leicesterSource.config, enrichDetails: false, maxPages: 1 }
  };
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/Search/Standard?")) return responseAt(url, resultPage(["20261245"]));
    detailRequests += 1;
    throw new Error(`Unexpected detail request ${url}`);
  };

  try {
    const applications = await fetchMasterGovApplications(source);
    assert.equal(applications.length, 1);
    assert.equal(applications[0].externalReference, "20261245");
    assert.equal(detailRequests, 0);
    assert.deepEqual(Object.keys(applications[0].rawPayload as object), ["search"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchMasterGovApplications rejects a positive result count with no parseable rows", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => responseAt(String(input), `
    <div>39 results found</div>
    <div class="redesigned-result"><a href="/Planning/Display/20261245">20261245</a></div>
  `);

  try {
    await assert.rejects(
      fetchMasterGovApplications(leicesterSource),
      /reported 39 results but yielded no parseable applications/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchMasterGovApplications rejects malformed results but keeps malformed detail pages partial", async () => {
  const originalFetch = globalThis.fetch;
  let standardSearchVisits = 0;
  let malformedResults = true;

  globalThis.fetch = async (input) => {
    const url = String(input);
    const parsed = new URL(url);
    if (parsed.pathname === "/Search/Standard") {
      standardSearchVisits += 1;
      return standardSearchVisits % 2 === 1
        ? responseAt(url, null, { status: 302, headers: { location: "/Disclaimer", "set-cookie": `ASP.NET_SessionId=session-${standardSearchVisits}; Path=/` } })
        : responseAt(url, null, { status: 302, headers: { location: "/Search/Results" } });
    }
    if (parsed.pathname === "/Disclaimer") return responseAt(url, '<form method="post" action="/Disclaimer/Accept"></form>');
    if (parsed.pathname === "/Disclaimer/Accept") return responseAt(url, null, { status: 302, headers: { location: "/Search/Standard", "set-cookie": "AcceptedDisclaimer=yes; Path=/" } });
    if (parsed.pathname === "/Search/Results") {
      return responseAt(url, malformedResults ? "<html><h1>Unexpected template</h1></html>" : resultPage(["20261245"]));
    }
    if (parsed.pathname === "/Planning/Display/20261245") return responseAt(url, "<html><p>Unexpected detail template</p></html>");
    throw new Error(`Unexpected ${url}`);
  };

  try {
    await assert.rejects(fetchMasterGovApplications(leicesterSource), /did not contain recognizable search results/);
    malformedResults = false;
    const applications = await fetchMasterGovApplications(leicesterSource);
    assert.equal(applications.length, 1);
    assert.equal(applications[0].externalReference, "20261245");
    assert.match(String((applications[0].rawPayload as { enrichmentError?: string }).enrichmentError), /unrecognizable detail HTML/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchMasterGovApplications redacts disclaimer tokens and cookies from later failures", async () => {
  const originalFetch = globalThis.fetch;
  let standardSearchVisits = 0;

  globalThis.fetch = async (input) => {
    const url = String(input);
    const parsed = new URL(url);
    if (parsed.pathname === "/Search/Standard") {
      standardSearchVisits += 1;
      return standardSearchVisits === 1
        ? responseAt(url, null, { status: 302, headers: { location: "/Disclaimer", "set-cookie": "ASP.NET_SessionId=session-secret; Path=/" } })
        : responseAt(url, null, { status: 302, headers: { location: "/Search/Results" } });
    }
    if (parsed.pathname === "/Disclaimer") {
      return responseAt(url, '<form method="post" action="/Disclaimer/Accept"><input type="hidden" name="__RequestVerificationToken" value="csrf-secret"></form>');
    }
    if (parsed.pathname === "/Disclaimer/Accept") {
      return responseAt(url, null, { status: 302, headers: { location: "/Search/Standard", "set-cookie": "AcceptedDisclaimer=accepted-secret; Path=/" } });
    }
    if (parsed.pathname === "/Search/Results") {
      return responseAt(url, "<title>Denied csrf-secret session-secret accepted-secret</title><p>private response details</p>", {
        status: 403,
        headers: { "content-type": "text/html" }
      });
    }
    throw new Error(`Unexpected ${url}`);
  };

  try {
    await assert.rejects(
      fetchMasterGovApplications(leicesterSource),
      (error: Error) => {
        assert.match(error.message, /MasterGov load-date-search rejected/);
        assert.match(error.message, /title=Denied \[REDACTED] \[REDACTED] \[REDACTED]/);
        assert.doesNotMatch(error.message, /csrf-secret|session-secret|accepted-secret|private response details/);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
