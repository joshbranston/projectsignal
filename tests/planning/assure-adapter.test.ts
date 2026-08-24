import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAssureWeeklySearchRequest,
  fetchAssureApplications,
  parseAssureApplicationHtml,
  parseAssureSearchResultsHtml
} from "../../lib/planning/adapters/assure.ts";
import type { PlanningSourceRecord } from "../../lib/planning/types.ts";

const CHARNWOOD_SEARCH_URL =
  "https://planningexplorer.charnwood.gov.uk/Assure/ES/Presentation/Planning/OnLinePlanning/OnlinePlanningSearch";

const charnwoodSource: PlanningSourceRecord = {
  id: "charnwood-assure",
  councilId: "charnwood",
  councilSlug: "charnwood",
  councilName: "Charnwood Borough Council",
  slug: "official",
  adapter: "custom",
  endpointUrl: CHARNWOOD_SEARCH_URL,
  format: "html",
  config: { provider: "assure", lookbackDays: 7, maxPages: 10, enrichDetails: false }
};

function responseAt(url: string, body: BodyInit | null, init: ResponseInit = {}) {
  const response = new Response(body, init);
  Object.defineProperty(response, "url", { value: url });
  return response;
}

const charnwoodResultsFixture = `
<span>Total record(s): 1</span>
<table>
  <thead><tr>
    <th>Reference No.</th><th>Status</th><th>Development type</th>
    <th>Description</th><th>Address</th><th>Date Registered</th>
  </tr></thead>
  <tbody id="divWeeklyMonthlySearchResultsForSorting"><tr>
    <td class="col-md-2"><a target="_blank" href="/Assure/ES/Presentation/Planning/OnlinePlanning/OnlinePlanningOverview?applicationNumber=P%2F26%2F1521%2F2"><span class="HyperlinkBlueUnderline">P/26/1521/2</span></a></td>
    <td class="col-md-2">REGISTERED</td>
    <td class="col-md-2"></td>
    <td class="col-md-2">Rear conservatory (Existing lawful development certificate) <a href="#">read more</a></td>
    <td class="col-md-2">81 The Green, Mountsorrel, Leicestershire, LE12 7AE</td>
    <td class="col-md-2">20/08/2026</td>
  </tr></tbody>
</table>`;

const assureSearchFixture = `
<form id="frmOnlinePlanningSearch">
  <input type="radio" name="SearchFor" value="PlanningApplications">
  <input type="hidden" name="__RequestVerificationToken" value="hidden-secret">
  <input type="hidden" name="urlOnlinePlanningWeeklyMonthlySearchView"
    value="/Assure/ES/Presentation/Planning/OnlinePlanning/OnlinePlanningWeeklyMonthlyView">
  <input type="hidden" name="urlOnlinePlanningWeeklyMonthlyGoSearch"
    value="/Assure/ES/Presentation/Planning/OnlinePlanning/OnlinePlanningSearchResultsForWeeklyMonthlyGo">
  <input type="hidden" name="IsWeeklyListSearch" value="false">
  <input type="hidden" name="IsMonthlyListSearch" value="true">
  <div id="divOnlinePlanningSearchView"><input name="OldSearchControl" value="must-disappear"></div>
  <input type="checkbox" name="Repeated" value="first" checked>
  <input type="checkbox" name="Repeated" value="unchecked">
  <input type="hidden" name="Repeated" value="second">
  <input name="DisabledControl" value="must-not-appear" disabled>
  <fieldset disabled>
    <legend><input name="LegendControl" value="preserved-from-first-legend"></legend>
    <input name="FieldsetDisabledControl" value="must-not-appear">
  </fieldset>
  <input type="radio" name="DefaultRadioValue" checked>
  <textarea name="MultilineText">first line
second line</textarea>
  <button name="ButtonControl" value="must-not-appear">Submit</button>
  <select name="SortOptions"><option value="date">Date</option><option value="reference" selected>Reference</option></select>
  <textarea name="SearchInput">preserved text</textarea>
</form>`;

const assureWeeklyFixture = `
<select name="SelectedWeek"><option value="0" selected>Choose dates</option><option value="17/08/2026 00:00:00">Week</option></select>
<input type="text" name="WeeklyFromDate" value="">
<input type="text" name="WeeklyToDate" value="">
<input type="radio" name="WeeklyListStatus" value="ValidatedThisWeek">
<input type="radio" name="WeeklyListStatus" value="DecidedThisWeek" checked>
<input type="checkbox" name="Ward" value="true">
<input type="hidden" name="Ward" value="false">
<div id="divWeeklyMonthlySearchResultsForSorting"></div>`;

const charnwoodDetailFixture = `
<span id="spnApplicationId">P/26/1521/2</span>
<input type="hidden" id="applicationReference" value="P/26/1521/2">
<table><tbody>
  <tr><td class="width-30"><label>Proposal</label></td><td class="width-70"><label class="font-weight-normal">Rear conservatory (Existing lawful development certificate)</label></td></tr>
  <tr><td class="width-30"><label>Address</label></td><td class="width-70"><label class="font-weight-normal">81 The Green, Mountsorrel, Leicestershire, LE12 7AE</label></td></tr>
  <tr><td class="width-30"><label>Received</label></td><td class="width-70"><label class="font-weight-normal">06 August 2026</label></td></tr>
  <tr><td class="width-30"><label>Registered</label></td><td class="width-70"><label class="font-weight-normal">20 August 2026</label></td></tr>
  <tr><td class="width-30"><label>Validated</label></td><td class="width-70"><label class="font-weight-normal">18 August 2026</label></td></tr>
  <tr><td class="width-30"><label>Applicant</label></td><td class="width-70"><label class="font-weight-normal">Example Applicant</label></td></tr>
  <tr><td class="width-30"><label>Agent/Company</label></td><td class="width-70"><label class="font-weight-normal">Example Agent Ltd</label></td></tr>
  <tr><td class="width-30"><label>Agent Address</label></td><td class="width-70"><label class="font-weight-normal">10 Example Road, Leicester LE1 1AA</label></td></tr>
</tbody></table>`;

function pagedResultsFixture(reference: string, currentIndex: number, pageIndexes: number[]) {
  return `<div id="divSearchList"><p>${pageIndexes.length + 1} Results</p>
    <article class="assure-search-result"><dl class="govuk-summary-list">
      <div class="govuk-summary-list__row"><dt>Application Reference</dt><dd>${reference}</dd></div>
      <div class="govuk-summary-list__row"><dt>Address</dt><dd>${reference} Example Road, LE12 7AE</dd></div>
      <div class="govuk-summary-list__row"><dt>Description</dt><dd>Works for ${reference}</dd></div>
      <div class="govuk-summary-list__row"><dt>Date Registered</dt><dd>20/08/2026</dd></div>
    </dl><a data-redirect-url="/Assure/ES/Presentation/Planning/OnlinePlanning/OnlinePlanningOverview?applicationNumber=${encodeURIComponent(reference)}">View</a></article>
  </div>
  <div id="generalSearchPagination" data-url="/Assure/ES/Presentation/Planning/OnlinePlanning/OnlinePlanningSearchResultsPagination">
    <input type="hidden" name="PagingParameters.CurrentPageIndex" value="${currentIndex}">
    <input type="hidden" name="IsPaginationClicked" value="false">
    ${pageIndexes.map((index) => `<a onclick="PagingClick('${index}')">${index + 1}</a>`).join("")}
  </div>`;
}

function multipleResultsFixture(references: string[]) {
  return `<div id="divSearchList"><p>${references.length} Results</p>${references.map((reference) => `
    <article class="assure-search-result"><dl class="govuk-summary-list">
      <div class="govuk-summary-list__row"><dt>Application Reference</dt><dd>${reference}</dd></div>
      <div class="govuk-summary-list__row"><dt>Address</dt><dd>${reference} Example Road, LE12 7AE</dd></div>
      <div class="govuk-summary-list__row"><dt>Description</dt><dd>Works for ${reference}</dd></div>
      <div class="govuk-summary-list__row"><dt>Date Registered</dt><dd>20/08/2026</dd></div>
    </dl><a data-redirect-url="/Assure/ES/Presentation/Planning/OnlinePlanning/OnlinePlanningOverview?applicationNumber=${encodeURIComponent(reference)}">View</a></article>`).join("")}</div>`;
}

function detailFixture(reference: string) {
  return `<dl class="govuk-summary-list">
    <div class="govuk-summary-list__row"><dt>Application Reference</dt><dd>${reference}</dd></div>
    <div class="govuk-summary-list__row"><dt>Description</dt><dd>Works for ${reference}</dd></div>
    <div class="govuk-summary-list__row"><dt>Date Received</dt><dd>18/08/2026</dd></div>
    <div class="govuk-summary-list__row"><dt>Date Validated</dt><dd>20/08/2026</dd></div>
  </dl>`;
}

test("parseAssureSearchResultsHtml normalises Charnwood application P/26/1521/2", () => {
  const parsed = parseAssureSearchResultsHtml(charnwoodResultsFixture, CHARNWOOD_SEARCH_URL);

  assert.equal(parsed.recognized, true);
  assert.equal(parsed.resultCount, 1);
  assert.equal(parsed.applications.length, 1);
  assert.deepEqual(parsed.applications[0], {
    externalReference: "P/26/1521/2",
    address: "81 The Green, Mountsorrel, Leicestershire, LE12 7AE",
    postcode: "LE12 7AE",
    latitude: null,
    longitude: null,
    proposal: "Rear conservatory (Existing lawful development certificate)",
    applicationType: null,
    stage: "REGISTERED",
    submittedAt: null,
    validatedAt: "2026-08-20",
    decisionAt: null,
    decision: null,
    applicantName: null,
    agentName: null,
    agentContact: null,
    sourceUrl:
      "https://planningexplorer.charnwood.gov.uk/Assure/ES/Presentation/Planning/OnlinePlanning/OnlinePlanningOverview?applicationNumber=P%2F26%2F1521%2F2",
    rawPayload: {
      search: {
        "Reference No.": "P/26/1521/2",
        Status: "REGISTERED",
        "Development type": "",
        Description: "Rear conservatory (Existing lawful development certificate)",
        Address: "81 The Green, Mountsorrel, Leicestershire, LE12 7AE",
        "Date Registered": "20/08/2026"
      }
    }
  });
});

test("parseAssureApplicationHtml enriches the matching base application", () => {
  const fallback = parseAssureSearchResultsHtml(
    charnwoodResultsFixture,
    CHARNWOOD_SEARCH_URL
  ).applications[0];
  const application = parseAssureApplicationHtml({
    detailHtml: charnwoodDetailFixture,
    sourceUrl: fallback.sourceUrl!,
    fallback
  });

  assert.ok(application);
  assert.equal(application.externalReference, "P/26/1521/2");
  assert.equal(application.submittedAt, "2026-08-06");
  assert.equal(application.validatedAt, "2026-08-18");
  assert.equal(application.applicantName, "Example Applicant");
  assert.equal(application.agentName, "Example Agent Ltd");
  assert.equal(application.agentContact, "10 Example Road, Leicester LE1 1AA");
  assert.deepEqual(Object.keys(application.rawPayload as object), ["search", "details"]);
});

test("parseAssureApplicationHtml accepts the ASSURE hidden application reference fallback", () => {
  const fallback = parseAssureSearchResultsHtml(
    charnwoodResultsFixture,
    CHARNWOOD_SEARCH_URL
  ).applications[0];
  const detailWithoutVisibleReference = charnwoodDetailFixture.replace(
    '<span id="spnApplicationId">P/26/1521/2</span>',
    ""
  );

  const application = parseAssureApplicationHtml({
    detailHtml: detailWithoutVisibleReference,
    sourceUrl: fallback.sourceUrl!,
    fallback
  });

  assert.equal(application?.externalReference, "P/26/1521/2");
});

test("buildAssureWeeklySearchRequest preserves browser successful-control semantics and DOM order", () => {
  const request = buildAssureWeeklySearchRequest({
    searchHtml: assureSearchFixture,
    weeklyHtml: assureWeeklyFixture,
    pageUrl: CHARNWOOD_SEARCH_URL,
    fromDate: "17/08/2026",
    toDate: "24/08/2026",
    status: "ValidatedThisWeek"
  });

  assert.equal(
    request.weeklyViewUrl,
    "https://planningexplorer.charnwood.gov.uk/Assure/ES/Presentation/Planning/OnlinePlanning/OnlinePlanningWeeklyMonthlyView?isWeeklySearch=true&searchFor=PlanningApplications"
  );
  assert.equal(
    request.searchUrl,
    "https://planningexplorer.charnwood.gov.uk/Assure/ES/Presentation/Planning/OnlinePlanning/OnlinePlanningSearchResultsForWeeklyMonthlyGo"
  );
  assert.deepEqual([...request.body], [
    ["SearchFor", "PlanningApplications"],
    ["__RequestVerificationToken", "hidden-secret"],
    ["urlOnlinePlanningWeeklyMonthlySearchView", "/Assure/ES/Presentation/Planning/OnlinePlanning/OnlinePlanningWeeklyMonthlyView"],
    ["urlOnlinePlanningWeeklyMonthlyGoSearch", "/Assure/ES/Presentation/Planning/OnlinePlanning/OnlinePlanningSearchResultsForWeeklyMonthlyGo"],
    ["IsWeeklyListSearch", "true"],
    ["IsMonthlyListSearch", "false"],
    ["SelectedWeek", "0"],
    ["WeeklyFromDate", "17/08/2026"],
    ["WeeklyToDate", "24/08/2026"],
    ["WeeklyListStatus", "ValidatedThisWeek"],
    ["Ward", "false"],
    ["Repeated", "first"],
    ["Repeated", "second"],
    ["LegendControl", "preserved-from-first-legend"],
    ["DefaultRadioValue", "on"],
    ["MultilineText", "first line\r\nsecond line"],
    ["SortOptions", "reference"],
    ["SearchInput", "preserved text"]
  ]);
  assert.ok(request.sensitiveValues.includes("hidden-secret"));
  assert.equal(request.body.has("OldSearchControl"), false);
  assert.equal(request.body.has("DisabledControl"), false);
  assert.equal(request.body.has("FieldsetDisabledControl"), false);
  assert.equal(request.body.has("ButtonControl"), false);
});

test("buildAssureWeeklySearchRequest uses the live ASSURE weekly-view replacement target", () => {
  const request = buildAssureWeeklySearchRequest({
    searchHtml: assureSearchFixture,
    weeklyHtml: assureWeeklyFixture,
    pageUrl: CHARNWOOD_SEARCH_URL,
    fromDate: "17/08/2026",
    toDate: "24/08/2026",
    status: "ValidatedThisWeek"
  });

  assert.equal(request.body.get("OldSearchControl"), null);
  assert.equal(request.body.get("WeeklyFromDate"), "17/08/2026");
  assert.equal(request.body.get("WeeklyToDate"), "24/08/2026");
  assert.equal(request.body.get("WeeklyListStatus"), "ValidatedThisWeek");
});

test("fetchAssureApplications carries the ASP.NET session through a date-bounded weekly search", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string; headers: Headers; body: string; signal: AbortSignal | null }> = [];

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const method = String(init.method ?? "GET").toUpperCase();
    const headers = new Headers(init.headers);
    calls.push({
      url,
      method,
      headers,
      body: init.body instanceof URLSearchParams ? init.body.toString() : String(init.body ?? ""),
      signal: init.signal ?? null
    });
    assert.equal(init.redirect, "manual");

    if (url === CHARNWOOD_SEARCH_URL) {
      return responseAt(url, assureSearchFixture, {
        headers: {
          "set-cookie": "ASP.NET_SessionId=session-secret; Path=/; HttpOnly, HASH_ASP.NET_SessionId=hash-secret; Path=/; HttpOnly"
        }
      });
    }
    if (url.includes("OnlinePlanningWeeklyMonthlyView")) {
      assert.match(headers.get("cookie") ?? "", /ASP\.NET_SessionId=session-secret/);
      assert.match(headers.get("cookie") ?? "", /HASH_ASP\.NET_SessionId=hash-secret/);
      assert.equal(headers.get("x-requested-with"), "XMLHttpRequest");
      return responseAt(url, assureWeeklyFixture, {
        headers: { "set-cookie": "AssureFlow=flow-secret; Path=/; HttpOnly" }
      });
    }
    if (url.includes("OnlinePlanningSearchResultsForWeeklyMonthlyGo")) {
      assert.equal(method, "POST");
      assert.match(headers.get("cookie") ?? "", /AssureFlow=flow-secret/);
      assert.equal(headers.get("origin"), "https://planningexplorer.charnwood.gov.uk");
      assert.equal(headers.get("referer"), CHARNWOOD_SEARCH_URL);
      assert.equal(headers.get("x-requested-with"), "XMLHttpRequest");
      const body = new URLSearchParams(String(init.body));
      assert.equal(body.get("WeeklyFromDate"), "17/08/2026");
      assert.equal(body.get("WeeklyToDate"), "24/08/2026");
      assert.equal(body.get("WeeklyListStatus"), "ValidatedThisWeek");
      assert.deepEqual(body.getAll("Repeated"), ["first", "second"]);
      return responseAt(url, charnwoodResultsFixture);
    }
    throw new Error(`Unexpected request ${method} ${url}`);
  };

  try {
    const applications = await fetchAssureApplications(charnwoodSource, {
      now: new Date("2026-08-24T12:00:00.000Z")
    });
    assert.equal(applications.length, 1);
    assert.equal(applications[0].externalReference, "P/26/1521/2");
    assert.equal(calls.length, 3);
    assert.ok(calls.every((call) => call.signal instanceof AbortSignal));
    assert.match(calls[0].headers.get("user-agent") ?? "", /Chrome\/140\.0\.0\.0/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchAssureApplications follows dynamic POST pagination and respects the page cap", async () => {
  const originalFetch = globalThis.fetch;
  const pagedIndexes: string[] = [];

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url === CHARNWOOD_SEARCH_URL) {
      return responseAt(url, assureSearchFixture, {
        headers: { "set-cookie": "ASP.NET_SessionId=paging-session; Path=/; HttpOnly" }
      });
    }
    if (url.includes("OnlinePlanningWeeklyMonthlyView")) return responseAt(url, assureWeeklyFixture);
    if (url.includes("OnlinePlanningSearchResultsForWeeklyMonthlyGo")) {
      return responseAt(url, pagedResultsFixture("P/26/1521/2", 0, [0, 1, 2]));
    }
    if (url.includes("OnlinePlanningSearchResultsPagination")) {
      const headers = new Headers(init.headers);
      assert.match(headers.get("cookie") ?? "", /ASP\.NET_SessionId=paging-session/);
      const body = new URLSearchParams(String(init.body));
      assert.equal(body.get("IsPaginationClicked"), "true");
      const index = body.get("PagingParameters.CurrentPageIndex");
      assert.ok(index);
      pagedIndexes.push(index);
      return responseAt(url, pagedResultsFixture("P/26/1522/2", Number(index), [0, 1, 2]));
    }
    throw new Error(`Unexpected request ${String(init.method ?? "GET")} ${url}`);
  };

  try {
    const applications = await fetchAssureApplications(charnwoodSource, {
      now: new Date("2026-08-24T12:00:00.000Z"),
      maxPages: 2
    });
    assert.deepEqual(applications.map((application) => application.externalReference), [
      "P/26/1521/2",
      "P/26/1522/2"
    ]);
    assert.deepEqual(pagedIndexes, ["1"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchAssureApplications caps detail-page concurrency at four", async () => {
  const originalFetch = globalThis.fetch;
  const references = Array.from({ length: 7 }, (_, index) => `P/26/16${index}/2`);
  let activeDetails = 0;
  let peakDetails = 0;

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === CHARNWOOD_SEARCH_URL) return responseAt(url, assureSearchFixture);
    if (url.includes("OnlinePlanningWeeklyMonthlyView")) return responseAt(url, assureWeeklyFixture);
    if (url.includes("OnlinePlanningSearchResultsForWeeklyMonthlyGo")) {
      return responseAt(url, multipleResultsFixture(references));
    }
    if (url.includes("OnlinePlanningOverview")) {
      const reference = new URL(url).searchParams.get("applicationNumber")!;
      activeDetails += 1;
      peakDetails = Math.max(peakDetails, activeDetails);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeDetails -= 1;
      return responseAt(url, detailFixture(reference));
    }
    throw new Error(`Unexpected request ${url}`);
  };

  try {
    const applications = await fetchAssureApplications(
      { ...charnwoodSource, config: { ...charnwoodSource.config, enrichDetails: true } },
      { now: new Date("2026-08-24T12:00:00.000Z"), maxPages: 1 }
    );
    assert.equal(applications.length, 7);
    assert.equal(peakDetails, 4);
    assert.ok(applications.every((application) => application.submittedAt === "2026-08-18"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchAssureApplications retains the base application when detail enrichment fails", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === CHARNWOOD_SEARCH_URL) return responseAt(url, assureSearchFixture);
    if (url.includes("OnlinePlanningWeeklyMonthlyView")) return responseAt(url, assureWeeklyFixture);
    if (url.includes("OnlinePlanningSearchResultsForWeeklyMonthlyGo")) {
      return responseAt(url, multipleResultsFixture(["P/26/1521/2"]));
    }
    if (url.includes("OnlinePlanningOverview")) {
      return responseAt(url, "<title>Service unavailable</title><p>private upstream body</p>", {
        status: 503,
        headers: { "content-type": "text/html" }
      });
    }
    throw new Error(`Unexpected request ${url}`);
  };

  try {
    const applications = await fetchAssureApplications(
      { ...charnwoodSource, config: { ...charnwoodSource.config, enrichDetails: true } },
      { now: new Date("2026-08-24T12:00:00.000Z"), maxPages: 1 }
    );
    assert.equal(applications.length, 1);
    assert.equal(applications[0].externalReference, "P/26/1521/2");
    assert.equal(applications[0].proposal, "Works for P/26/1521/2");
    const raw = applications[0].rawPayload as { enrichmentError?: string };
    assert.match(raw.enrichmentError ?? "", /load-detail rejected.*status=503/);
    assert.doesNotMatch(JSON.stringify(raw), /private upstream body/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchAssureApplications retains nested transport codes and redacts configured headers", async () => {
  const originalFetch = globalThis.fetch;
  const secret = "configured-transport-secret";
  globalThis.fetch = async () => {
    const cause = Object.assign(new Error(`Connect Timeout Error ${secret}`), {
      name: "ConnectTimeoutError",
      code: "UND_ERR_CONNECT_TIMEOUT"
    });
    throw new TypeError("fetch failed", { cause });
  };

  try {
    await assert.rejects(
      fetchAssureApplications({
        ...charnwoodSource,
        config: { ...charnwoodSource.config, requestHeaders: { authorization: `Bearer ${secret}` } }
      }),
      (error: Error) => {
        assert.match(error.message, /ASSURE open-search-page request failed/);
        assert.match(error.message, /portal=charnwood/);
        assert.match(error.message, /host=planningexplorer\.charnwood\.gov\.uk/);
        assert.match(error.message, /TypeError: fetch failed/);
        assert.match(error.message, /ConnectTimeoutError\[UND_ERR_CONNECT_TIMEOUT\]: Connect Timeout Error \[REDACTED\]/);
        assert.doesNotMatch(error.message, new RegExp(secret));
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

test("fetchAssureApplications sanitizes HTTP clues, session cookies, and hidden form state", async () => {
  const originalFetch = globalThis.fetch;
  const source = {
    ...charnwoodSource,
    config: {
      ...charnwoodSource.config,
      requestHeaders: { authorization: "Bearer configured-secret" }
    }
  };

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === CHARNWOOD_SEARCH_URL) {
      return responseAt(url, assureSearchFixture, {
        headers: { "set-cookie": "ASP.NET_SessionId=session-secret; Path=/; HttpOnly" }
      });
    }
    if (url.includes("OnlinePlanningWeeklyMonthlyView")) return responseAt(url, assureWeeklyFixture);
    return responseAt(
      url,
      "<title>Denied configured-secret session-secret hidden-secret</title><h1>Forbidden</h1><p>private response body</p>",
      {
        status: 403,
        statusText: "Forbidden",
        headers: {
          "content-type": "text/html; charset=utf-8",
          "set-cookie": "AssureRejected=response-cookie-secret; Path=/; HttpOnly"
        }
      }
    );
  };

  try {
    await assert.rejects(fetchAssureApplications(source), (error: Error) => {
      assert.match(error.message, /ASSURE submit-weekly-search rejected/);
      assert.match(error.message, /status=403/);
      assert.match(error.message, /status-text=Forbidden/);
      assert.match(error.message, /content-type=text\/html,/);
      assert.match(error.message, /title=Denied \[REDACTED\] \[REDACTED\] \[REDACTED\]/);
      assert.doesNotMatch(
        error.message,
        /configured-secret|session-secret|hidden-secret|response-cookie-secret|private response body/
      );
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchAssureApplications follows same-origin redirects and uses the effective search-page Referer", async () => {
  const originalFetch = globalThis.fetch;
  const redirectedSearchUrl =
    "https://planningexplorer.charnwood.gov.uk/Assure/ES/Presentation/Planning/OnlinePlanning/RedirectedSearch";
  let initialVisits = 0;

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const headers = new Headers(init.headers);
    if (url === CHARNWOOD_SEARCH_URL) {
      initialVisits += 1;
      return responseAt(url, null, {
        status: 302,
        headers: {
          location: redirectedSearchUrl,
          "set-cookie": "ASP.NET_SessionId=redirect-session; Path=/; HttpOnly"
        }
      });
    }
    if (url === redirectedSearchUrl) {
      assert.match(headers.get("cookie") ?? "", /ASP\.NET_SessionId=redirect-session/);
      assert.equal(headers.get("referer"), CHARNWOOD_SEARCH_URL);
      return responseAt(url, assureSearchFixture);
    }
    if (url.includes("OnlinePlanningWeeklyMonthlyView")) {
      assert.equal(headers.get("referer"), redirectedSearchUrl);
      return responseAt(url, assureWeeklyFixture);
    }
    if (url.includes("OnlinePlanningSearchResultsForWeeklyMonthlyGo")) {
      assert.equal(headers.get("referer"), redirectedSearchUrl);
      return responseAt(url, charnwoodResultsFixture);
    }
    throw new Error(`Unexpected request ${url}`);
  };

  try {
    const applications = await fetchAssureApplications(charnwoodSource, {
      now: new Date("2026-08-24T12:00:00.000Z")
    });
    assert.equal(applications.length, 1);
    assert.equal(initialVisits, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchAssureApplications applies bounded browser redirect semantics to the search POST", async () => {
  const originalFetch = globalThis.fetch;
  const preservedPostUrl = new URL("/Assure/redirected-weekly-post", CHARNWOOD_SEARCH_URL).toString();
  const finalGetUrl = new URL("/Assure/final-weekly-results", CHARNWOOD_SEARCH_URL).toString();

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const method = String(init.method ?? "GET").toUpperCase();
    const headers = new Headers(init.headers);
    if (url === CHARNWOOD_SEARCH_URL) return responseAt(url, assureSearchFixture);
    if (url.includes("OnlinePlanningWeeklyMonthlyView")) return responseAt(url, assureWeeklyFixture);
    if (url.includes("OnlinePlanningSearchResultsForWeeklyMonthlyGo")) {
      assert.equal(method, "POST");
      return responseAt(url, null, { status: 307, headers: { location: preservedPostUrl } });
    }
    if (url === preservedPostUrl) {
      assert.equal(method, "POST");
      assert.match(String(init.body), /WeeklyFromDate=17%2F08%2F2026/);
      return responseAt(url, null, { status: 303, headers: { location: finalGetUrl } });
    }
    if (url === finalGetUrl) {
      assert.equal(method, "GET");
      assert.equal(init.body, undefined);
      assert.equal(headers.has("content-type"), false);
      assert.equal(headers.get("referer"), preservedPostUrl);
      return responseAt(
        url,
        charnwoodResultsFixture.replace(
          "/Assure/ES/Presentation/Planning/OnlinePlanning/OnlinePlanningOverview",
          "OnlinePlanningOverview"
        )
      );
    }
    throw new Error(`Unexpected request ${method} ${url}`);
  };

  try {
    const applications = await fetchAssureApplications(charnwoodSource, {
      now: new Date("2026-08-24T12:00:00.000Z")
    });
    assert.equal(applications.length, 1);
    assert.equal(
      applications[0].sourceUrl,
      "https://planningexplorer.charnwood.gov.uk/Assure/OnlinePlanningOverview?applicationNumber=P%2F26%2F1521%2F2"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchAssureApplications follows a same-origin detail redirect", async () => {
  const originalFetch = globalThis.fetch;
  const detailUrl =
    "https://planningexplorer.charnwood.gov.uk/Assure/ES/Presentation/Planning/OnlinePlanning/OnlinePlanningOverview?applicationNumber=P%2F26%2F1521%2F2";
  const redirectedDetailUrl = `${detailUrl}&view=full`;

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const method = String(init.method ?? "GET").toUpperCase();
    if (url === CHARNWOOD_SEARCH_URL) return responseAt(url, assureSearchFixture);
    if (url.includes("OnlinePlanningWeeklyMonthlyView")) return responseAt(url, assureWeeklyFixture);
    if (url.includes("OnlinePlanningSearchResultsForWeeklyMonthlyGo")) {
      return responseAt(url, charnwoodResultsFixture);
    }
    if (url === detailUrl) {
      return responseAt(url, null, { status: 302, headers: { location: redirectedDetailUrl } });
    }
    if (url === redirectedDetailUrl) {
      assert.equal(method, "GET");
      assert.equal(new Headers(init.headers).get("referer"), detailUrl);
      return responseAt(url, charnwoodDetailFixture);
    }
    throw new Error(`Unexpected request ${method} ${url}`);
  };

  try {
    const applications = await fetchAssureApplications(
      { ...charnwoodSource, config: { ...charnwoodSource.config, enrichDetails: true } },
      { now: new Date("2026-08-24T12:00:00.000Z") }
    );
    assert.equal(applications[0].submittedAt, "2026-08-06");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchAssureApplications rejects a cross-origin redirect before sending session data", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async (input) => {
    requests += 1;
    return responseAt(String(input), null, {
      status: 302,
      headers: {
        location: "https://untrusted.example/search",
        "set-cookie": "ASP.NET_SessionId=must-not-leave-origin; Path=/; HttpOnly"
      }
    });
  };

  try {
    await assert.rejects(fetchAssureApplications(charnwoodSource), /ASSURE redirect is cross-origin/);
    assert.equal(requests, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("parseAssureApplicationHtml refuses to merge a different application", () => {
  const fallback = parseAssureSearchResultsHtml(
    charnwoodResultsFixture,
    CHARNWOOD_SEARCH_URL
  ).applications[0];
  assert.equal(
    parseAssureApplicationHtml({
      detailHtml: detailFixture("P/26/9999/2"),
      sourceUrl: fallback.sourceUrl!,
      fallback
    }),
    null
  );
});

test("buildAssureWeeklySearchRequest rejects cross-origin dynamic actions", () => {
  const hostile = assureSearchFixture.replace(
    "/Assure/ES/Presentation/Planning/OnlinePlanning/OnlinePlanningSearchResultsForWeeklyMonthlyGo",
    "https://untrusted.example/search"
  );
  assert.throws(
    () => buildAssureWeeklySearchRequest({
      searchHtml: hostile,
      weeklyHtml: assureWeeklyFixture,
      pageUrl: CHARNWOOD_SEARCH_URL,
      fromDate: "17/08/2026",
      toDate: "24/08/2026",
      status: "ValidatedThisWeek"
    }),
    /weekly-search URL is missing or cross-origin/
  );
});

test("fetchAssureApplications rejects an unrecognizable initial page with a safe clue", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => responseAt(
    String(input),
    "<title>UnsupportedWebBrowser</title><p>private upstream explanation</p>",
    { headers: { "content-type": "text/html" } }
  );
  try {
    await assert.rejects(fetchAssureApplications(charnwoodSource), (error: Error) => {
      assert.match(error.message, /ASSURE search page did not contain a recognizable form/);
      assert.match(error.message, /host=planningexplorer\.charnwood\.gov\.uk/);
      assert.match(error.message, /title=UnsupportedWebBrowser/);
      assert.doesNotMatch(error.message, /private upstream explanation/);
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchAssureApplications rejects a positive count with no parseable applications", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === CHARNWOOD_SEARCH_URL) return responseAt(url, assureSearchFixture);
    if (url.includes("OnlinePlanningWeeklyMonthlyView")) return responseAt(url, assureWeeklyFixture);
    return responseAt(url, "<div id='divSearchList'><p>12 Results</p><div>Changed template</div></div>");
  };
  try {
    await assert.rejects(
      fetchAssureApplications(charnwoodSource),
      /reported 12 results but yielded no parseable applications/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchAssureApplications fails closed when a result set is truncated without a pagination route", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === CHARNWOOD_SEARCH_URL) return responseAt(url, assureSearchFixture);
    if (url.includes("OnlinePlanningWeeklyMonthlyView")) return responseAt(url, assureWeeklyFixture);
    return responseAt(url, charnwoodResultsFixture.replace("Total record(s): 1", "Total record(s): 99"));
  };
  try {
    await assert.rejects(
      fetchAssureApplications(charnwoodSource),
      /reported 99 results but page one yielded 1 and no usable pagination route/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchAssureApplications enforces the configured request timeout", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init = {}) => await new Promise<Response>((_resolve, reject) => {
    if (!init.signal) return reject(new Error("missing timeout signal"));
    const guard = setTimeout(() => reject(new Error("timeout signal did not abort")), 500);
    const rejectWithReason = () => {
      clearTimeout(guard);
      reject(init.signal?.reason);
    };
    if (init.signal.aborted) rejectWithReason();
    else init.signal.addEventListener("abort", rejectWithReason, { once: true });
  });
  try {
    await assert.rejects(
      fetchAssureApplications(charnwoodSource, { requestTimeoutMs: 20 }),
      (error: Error) => {
        assert.match(error.message, /ASSURE open-search-page request failed/);
        assert.match(error.message, /TimeoutError\[23\]: The operation was aborted due to timeout/);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
