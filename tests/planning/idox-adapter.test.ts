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
