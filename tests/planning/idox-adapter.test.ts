import assert from "node:assert/strict";
import test from "node:test";
import {
  parseIdoxApplicationHtml,
  parseIdoxSearchResultLinks
} from "../../lib/planning/adapters/idox.ts";

const searchHtml = `
<ul id="searchresults">
  <li class="searchresult">
    <a href="/public-access/applicationDetails.do?activeTab=summary&amp;keyVal=ABC123">26/01057/FUL | Erection of a first-floor rear extension | 54 Grange Road Ibstock Coalville Leicestershire LE67 6LH</a>
  </li>
  <li class="searchresult">
    <a href="applicationDetails.do?activeTab=summary&amp;keyVal=XYZ789">26/01099/FUL | Replacement windows and doors | 2 High Street Ashby De La Zouch LE65 1AA</a>
  </li>
</ul>`;

test("parseIdoxSearchResultLinks extracts unique application detail URLs", () => {
  const links = parseIdoxSearchResultLinks(
    searchHtml,
    "https://plans.nwleics.gov.uk/public-access/"
  );

  assert.deepEqual(links, [
    "https://plans.nwleics.gov.uk/public-access/applicationDetails.do?activeTab=summary&keyVal=ABC123",
    "https://plans.nwleics.gov.uk/public-access/applicationDetails.do?activeTab=summary&keyVal=XYZ789"
  ]);
});

const summaryHtml = `
<table>
  <tr><th>Reference</th><td>26/01057/FUL</td></tr>
  <tr><th>Application Received</th><td>16 Aug 2026</td></tr>
  <tr><th>Application Validated</th><td>18 Aug 2026</td></tr>
  <tr><th>Address</th><td>54 Grange Road Ibstock Coalville Leicestershire LE67 6LH</td></tr>
  <tr><th>Proposal</th><td>Erection of a first-floor rear extension and replacement windows</td></tr>
  <tr><th>Status</th><td>Pending Consideration</td></tr>
  <tr><th>Decision</th><td>Not Available</td></tr>
  <tr><th>Decision Issued Date</th><td>Not Available</td></tr>
</table>`;

const detailsHtml = `
<dl>
  <dt>Application Type</dt><dd>Householder</dd>
  <dt>Applicant Name</dt><dd>Mr Example</dd>
  <dt>Agent Name</dt><dd>Example Architects</dd>
</dl>`;

test("parseIdoxApplicationHtml normalises standard Idox fields", () => {
  const application = parseIdoxApplicationHtml({
    summaryHtml,
    detailsHtml,
    sourceUrl: "https://plans.nwleics.gov.uk/public-access/applicationDetails.do?activeTab=summary&keyVal=ABC123"
  });

  assert.deepEqual(application, {
    externalReference: "26/01057/FUL",
    address: "54 Grange Road Ibstock Coalville Leicestershire LE67 6LH",
    postcode: "LE67 6LH",
    latitude: null,
    longitude: null,
    proposal: "Erection of a first-floor rear extension and replacement windows",
    applicationType: "Householder",
    stage: "Pending Consideration",
    submittedAt: "2026-08-16",
    validatedAt: "2026-08-18",
    decisionAt: null,
    decision: null,
    applicantName: "Mr Example",
    agentName: "Example Architects",
    agentContact: null,
    sourceUrl: "https://plans.nwleics.gov.uk/public-access/applicationDetails.do?activeTab=summary&keyVal=ABC123",
    rawPayload: {
      summary: {
        Reference: "26/01057/FUL",
        "Application Received": "16 Aug 2026",
        "Application Validated": "18 Aug 2026",
        Address: "54 Grange Road Ibstock Coalville Leicestershire LE67 6LH",
        Proposal: "Erection of a first-floor rear extension and replacement windows",
        Status: "Pending Consideration",
        Decision: "Not Available",
        "Decision Issued Date": "Not Available"
      },
      details: {
        "Application Type": "Householder",
        "Applicant Name": "Mr Example",
        "Agent Name": "Example Architects"
      }
    }
  });
});

import { fetchIdoxApplications } from "../../lib/planning/adapters/idox.ts";
import type { PlanningSourceRecord } from "../../lib/planning/types.ts";

const source: PlanningSourceRecord = {
  id: "source-nwl",
  councilId: "council-nwl",
  councilSlug: "north-west-leicestershire",
  councilName: "North West Leicestershire District Council",
  slug: "primary",
  adapter: "idox_public_access",
  endpointUrl: "https://plans.nwleics.gov.uk/public-access/",
  format: "html",
  config: {}
};

const harboroughSource: PlanningSourceRecord = {
  ...source,
  id: "source-harborough",
  councilId: "council-harborough",
  councilSlug: "harborough",
  councilName: "Harborough District Council",
  endpointUrl: "https://pa2.harborough.gov.uk/online-applications/"
};

test("fetchIdoxApplications reports safe nested transport diagnostics", async () => {
  const originalFetch = globalThis.fetch;
  const nestedCause = Object.assign(new Error("Connect Timeout Error"), {
    name: "ConnectTimeoutError",
    code: "UND_ERR_CONNECT_TIMEOUT"
  });
  const fetchFailure = new TypeError("fetch failed", { cause: nestedCause });

  globalThis.fetch = async () => {
    throw fetchFailure;
  };

  try {
    await assert.rejects(
      fetchIdoxApplications(harboroughSource),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /Harborough District Council Idox open-search-page request failed/);
        assert.match(error.message, /portal=harborough/);
        assert.match(error.message, /host=pa2\.harborough\.gov\.uk/);
        assert.match(error.message, /TypeError: fetch failed/);
        assert.match(error.message, /ConnectTimeoutError\[UND_ERR_CONNECT_TIMEOUT\]: Connect Timeout Error/);
        assert.equal(error.cause, fetchFailure);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchIdoxApplications redacts sensitive configured header values from diagnostics", async () => {
  const originalFetch = globalThis.fetch;
  const sourceWithSensitiveHeaders: PlanningSourceRecord = {
    ...harboroughSource,
    config: {
      requestHeaders: {
        Authorization: "Bearer project-secret",
        Cookie: "session=private-cookie",
        "X-Partner": "opaque-partner-value"
      }
    }
  };
  const fetchFailure = Object.assign(
    new Error(
      "X-Partner: opaque-partner-value; Authorization: Bearer project-secret; " +
      "Cookie: session=private-cookie"
    ),
    { code: "ECONNRESET" }
  );

  globalThis.fetch = async () => {
    throw fetchFailure;
  };

  try {
    await assert.rejects(
      fetchIdoxApplications(sourceWithSensitiveHeaders),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /Error\[ECONNRESET\]/);
        assert.match(error.message, /\[REDACTED\]/);
        assert.doesNotMatch(error.message, /project-secret/);
        assert.doesNotMatch(error.message, /private-cookie/);
        assert.doesNotMatch(error.message, /opaque-partner-value/);
        assert.equal(error.cause, fetchFailure);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchIdoxApplications identifies search submission transport failures", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input) => {
    if (String(input).endsWith("search.do?action=advanced")) {
      return new Response('<input type="hidden" name="_csrf" value="token-1">', { status: 200 });
    }

    throw Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
  };

  try {
    await assert.rejects(
      fetchIdoxApplications(harboroughSource),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /Idox submit-search request failed/);
        assert.match(error.message, /Error\[ECONNRESET\]: socket hang up/);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchIdoxApplications identifies paged-results transport failures", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("search.do?action=advanced")) {
      return new Response('<input type="hidden" name="_csrf" value="token-1">', { status: 200 });
    }
    if (url.endsWith("advancedSearchResults.do?action=firstPage")) {
      return new Response('<a href="pagedSearchResults.do?action=page&amp;searchCriteria.page=2">2</a>', { status: 200 });
    }

    throw Object.assign(new Error("connection timed out"), { code: "ETIMEDOUT" });
  };

  try {
    await assert.rejects(
      fetchIdoxApplications(harboroughSource, { maxPages: 2 }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /Idox load-results-page request failed/);
        assert.match(error.message, /Error\[ETIMEDOUT\]: connection timed out/);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchIdoxApplications identifies application-tab transport failures", async () => {
  const originalFetch = globalThis.fetch;
  const singleResultHtml = `
    <a href="applicationDetails.do?activeTab=summary&amp;keyVal=ABC123">Application</a>
  `;

  try {
    for (const failingTab of ["summary", "details"] as const) {
      globalThis.fetch = async (input) => {
        const url = String(input);
        if (url.endsWith("search.do?action=advanced")) {
          return new Response('<input type="hidden" name="_csrf" value="token-1">', { status: 200 });
        }
        if (url.endsWith("advancedSearchResults.do?action=firstPage")) {
          return new Response(singleResultHtml, { status: 200 });
        }
        if (url.includes(`activeTab=${failingTab}`)) {
          throw Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" });
        }
        if (url.includes("activeTab=summary")) return new Response(summaryHtml, { status: 200 });
        if (url.includes("activeTab=details")) return new Response(detailsHtml, { status: 200 });
        throw new Error(`Unexpected request ${url}`);
      };

      await assert.rejects(
        fetchIdoxApplications(harboroughSource, { maxPages: 1 }),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.match(error.message, new RegExp(`Idox load-${failingTab} request failed`));
          assert.match(error.message, /Error\[UND_ERR_SOCKET\]: other side closed/);
          return true;
        }
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchIdoxApplications identifies response-body transport failures", async () => {
  const originalFetch = globalThis.fetch;
  const bodyFailure = Object.assign(
    new Error("terminated JSESSIONID=initial-private-session"),
    { code: "UND_ERR_SOCKET" }
  );

  globalThis.fetch = async () => new Response(
    new ReadableStream({
      start(controller) {
        controller.error(bodyFailure);
      }
    }),
    {
      status: 200,
      headers: { "set-cookie": "JSESSIONID=initial-private-session; Path=/online-applications" }
    }
  );

  try {
    await assert.rejects(
      fetchIdoxApplications(harboroughSource),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /Idox read-search-page response failed/);
        assert.match(error.message, /Error\[UND_ERR_SOCKET\]: terminated/);
        assert.match(error.message, /\[REDACTED\]/);
        assert.doesNotMatch(error.message, /initial-private-session/);
        assert.equal(error.cause, bodyFailure);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchIdoxApplications redacts session and CSRF values from body-read diagnostics", async () => {
  const originalFetch = globalThis.fetch;
  let requestNumber = 0;

  globalThis.fetch = async () => {
    requestNumber++;
    if (requestNumber === 1) {
      return new Response('<input type="hidden" name="_csrf" value="csrf-private-value">', {
        status: 200,
        headers: { "set-cookie": "JSESSIONID=session-private-value; Path=/online-applications; HttpOnly" }
      });
    }

    const bodyFailure = Object.assign(
      new Error("csrf-private-value JSESSIONID=session-private-value"),
      { code: "UND_ERR_SOCKET" }
    );
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.error(bodyFailure);
        }
      }),
      { status: 200 }
    );
  };

  try {
    await assert.rejects(
      fetchIdoxApplications(harboroughSource),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /Idox read-search-results response failed/);
        assert.match(error.message, /Error\[UND_ERR_SOCKET\]/);
        assert.match(error.message, /\[REDACTED\]/);
        assert.doesNotMatch(error.message, /csrf-private-value/);
        assert.doesNotMatch(error.message, /session-private-value/);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchIdoxApplications bounds upstream requests with an abort timeout", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (_input, init = {}) => {
    if (!init.signal) throw new Error("missing request timeout signal");

    return await new Promise<Response>((_resolve, reject) => {
      const timeoutGuard = setTimeout(
        () => reject(new Error("request timeout signal did not abort")),
        500
      );
      const rejectWithReason = () => {
        clearTimeout(timeoutGuard);
        reject(init.signal?.reason);
      };
      if (init.signal?.aborted) rejectWithReason();
      else init.signal?.addEventListener("abort", rejectWithReason, { once: true });
    });
  };

  try {
    await assert.rejects(
      fetchIdoxApplications(harboroughSource, { requestTimeoutMs: 20 }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /Idox open-search-page request failed/);
        assert.match(error.message, /TimeoutError\[23\]: The operation was aborted due to timeout/);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchIdoxApplications rejects failed upstream search pages", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("Service unavailable", { status: 503 });

  try {
    await assert.rejects(
      fetchIdoxApplications(harboroughSource),
      /Harborough District Council Idox search page returned 503/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchIdoxApplications rejects malformed search pages without a CSRF token", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("<html><form></form></html>", { status: 200 });

  try {
    await assert.rejects(
      fetchIdoxApplications(harboroughSource),
      /Harborough District Council Idox search page did not provide a CSRF token/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchIdoxApplications opens a session, sends CSRF, searches by validated date and fetches application details", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string; body: string; cookie: string | null }> = [];

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const method = String(init.method ?? "GET");
    const headers = new Headers(init.headers);
    const body = typeof init.body === "string" ? init.body : init.body instanceof URLSearchParams ? init.body.toString() : "";
    calls.push({ url, method, body, cookie: headers.get("cookie") });

    if (url.endsWith("search.do?action=advanced")) {
      return new Response(`<html><form><input type="hidden" name="_csrf" value="csrf-abc-123" /></form></html>`, {
        status: 200,
        headers: { "set-cookie": "JSESSIONID=session-123; Path=/public-access; HttpOnly" }
      });
    }

    if (url.endsWith("advancedSearchResults.do?action=firstPage")) {
      return new Response(searchHtml, { status: 200 });
    }

    if (url.includes("activeTab=summary") && url.includes("keyVal=ABC123")) {
      return new Response(summaryHtml, { status: 200 });
    }

    if (url.includes("activeTab=details") && url.includes("keyVal=ABC123")) {
      return new Response(detailsHtml, { status: 200 });
    }

    if (url.includes("keyVal=XYZ789")) {
      return new Response("<html><table><tr><th>Reference</th><td></td></tr></table></html>", { status: 200 });
    }

    throw new Error(`Unexpected request ${method} ${url}`);
  };

  try {
    const applications = await fetchIdoxApplications(source, {
      now: new Date("2026-08-23T12:00:00Z"),
      lookbackDays: 7,
      maxPages: 1
    });

    assert.equal(applications.length, 1);
    assert.equal(applications[0].externalReference, "26/01057/FUL");

    const searchCall = calls.find((call) => call.url.endsWith("advancedSearchResults.do?action=firstPage"));
    assert.ok(searchCall);
    assert.equal(searchCall.method, "POST");
    assert.match(searchCall.body, /_csrf=csrf-abc-123/);
    assert.match(searchCall.body, /date%28applicationValidatedStart%29=16%2F08%2F2026/);
    assert.match(searchCall.body, /date%28applicationValidatedEnd%29=23%2F08%2F2026/);
    assert.equal(searchCall.cookie, "JSESSIONID=session-123");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
