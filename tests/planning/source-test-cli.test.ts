import assert from "node:assert/strict";
import test from "node:test";
import {
  formatPlanningSourceTestResult,
  parsePlanningSourceTestArgs,
  runPlanningSourceTest,
  runPlanningSourceTestCli
} from "../../lib/planning/source-test-cli.ts";
import type { NormalisedPlanningApplication, PlanningSourceRecord } from "../../lib/planning/types.ts";

const CHARNWOOD_ENDPOINT =
  "https://planningexplorer.charnwood.gov.uk/Assure/ES/Presentation/Planning/OnLinePlanning/OnlinePlanningSearch";

test("parsePlanningSourceTestArgs accepts a bounded deterministic ASSURE run", () => {
  const options = parsePlanningSourceTestArgs([
    "--adapter", "custom",
    "--provider", "assure",
    "--endpoint", CHARNWOOD_ENDPOINT,
    "--lookback-days", "7",
    "--now", "2026-08-24T12:00:00Z",
    "--max-pages", "3",
    "--enrich-details", "false",
    "--json",
    "--score"
  ]);

  assert.equal(options.adapter, "custom");
  assert.equal(options.provider, "assure");
  assert.equal(options.endpoint, CHARNWOOD_ENDPOINT);
  assert.equal(options.lookbackDays, 7);
  assert.equal(options.now.toISOString(), "2026-08-24T12:00:00.000Z");
  assert.equal(options.maxPages, 3);
  assert.equal(options.enrichDetails, false);
  assert.equal(options.json, true);
  assert.equal(options.score, true);
});

test("parsePlanningSourceTestArgs accepts adapter configuration without weakening CLI bounds", async () => {
  const options = parsePlanningSourceTestArgs([
    "--adapter", "csv",
    "--endpoint", "https://data.example.test/planning.csv",
    "--config-json", JSON.stringify({
      fields: { externalReference: "Reference", proposal: "Description" },
      lookbackDays: 30,
      maxPages: 20
    }),
    "--lookback-days", "5",
    "--max-pages", "2"
  ]);
  const captured: PlanningSourceRecord[] = [];

  await runPlanningSourceTest(options, {
    fetchApplications: async (source) => {
      captured.push(source);
      return [];
    }
  });

  assert.deepEqual(captured[0]?.config, {
    fields: { externalReference: "Reference", proposal: "Description" },
    lookbackDays: 5,
    maxPages: 2,
    enrichDetails: true
  });
});

test("parsePlanningSourceTestArgs accepts the two official JSON planning providers", () => {
  for (const [provider, endpoint] of [
    ["statmap_horizon", "https://eaststaffs-publicportal.statmap.co.uk/horizoNext/publicportal"],
    ["agile_applications", "https://planning.agileapplications.co.uk/cannock"]
  ]) {
    const options = parsePlanningSourceTestArgs([
      "--adapter", "custom", "--provider", provider, "--endpoint", endpoint,
      "--lookback-days", "7", "--max-pages", "10"
    ]);
    assert.equal(options.provider, provider);
    assert.equal(options.endpoint, endpoint);
  }
});

test("runPlanningSourceTest uses in-memory dispatch options and returns only the bounded window", async () => {
  const options = parsePlanningSourceTestArgs([
    "--adapter", "custom",
    "--provider", "assure",
    "--endpoint", CHARNWOOD_ENDPOINT,
    "--lookback-days", "7",
    "--now", "2026-08-24T12:00:00Z",
    "--max-pages", "3",
    "--enrich-details", "false"
  ]);
  const calls: Array<{ source: PlanningSourceRecord; options: Record<string, unknown> }> = [];
  const application = (
    externalReference: string,
    validatedAt: string | null
  ): NormalisedPlanningApplication => ({
    externalReference,
    address: "81 The Green, Mountsorrel, Leicestershire, LE12 7AE",
    postcode: "LE12 7AE",
    latitude: null,
    longitude: null,
    proposal: "Rear conservatory",
    applicationType: null,
    stage: "REGISTERED",
    submittedAt: "2026-08-06",
    validatedAt,
    decisionAt: null,
    decision: null,
    applicantName: null,
    agentName: null,
    agentContact: null,
    sourceUrl: `${CHARNWOOD_ENDPOINT}/${externalReference}`,
    rawPayload: { search: {}, details: {} }
  });

  const result = await runPlanningSourceTest(options, {
    fetchApplications: async (source, fetchOptions) => {
      calls.push({ source, options: fetchOptions });
      return [
        application("P/26/1521/2", "2026-08-18"),
        application("P/26/1000/2", "2026-08-16"),
        application("P/26/2000/2", "2026-08-25")
      ];
    }
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].source, {
    id: "local-source-test",
    councilId: "local-source-test",
    councilSlug: "local-source-test",
    councilName: "Local planning source",
    slug: "cli",
    adapter: "custom",
    endpointUrl: CHARNWOOD_ENDPOINT,
    format: "html",
    config: {
      provider: "assure",
      lookbackDays: 7,
      maxPages: 3,
      enrichDetails: false
    }
  });
  assert.deepEqual(calls[0].options, {
    now: new Date("2026-08-24T12:00:00.000Z"),
    lookbackDays: 7,
    maxPages: 3,
    enrichDetails: false
  });
  assert.equal(result.summary.applicationsReturned, 1);
  assert.equal(result.summary.detailEnriched, 1);
  assert.equal(result.summary.earliestDate, "2026-08-18");
  assert.equal(result.summary.latestDate, "2026-08-18");
  assert.deepEqual(result.applications.map((item) => item.externalReference), ["P/26/1521/2"]);
});

test("formatPlanningSourceTestResult produces concise human output and sanitized scored JSON", async () => {
  const options = parsePlanningSourceTestArgs([
    "--adapter", "custom",
    "--provider", "assure",
    "--endpoint", `${CHARNWOOD_ENDPOINT}?api_key=endpoint-secret`,
    "--lookback-days", "7",
    "--now", "2026-08-24T12:00:00Z",
    "--score"
  ]);
  const result = await runPlanningSourceTest(options, {
    fetchApplications: async () => [{
      externalReference: "P/26/1521/2",
      address: "81 The Green, Mountsorrel, Leicestershire, LE12 7AE",
      postcode: "LE12 7AE",
      latitude: null,
      longitude: null,
      proposal: "Rear conservatory",
      applicationType: "Householder",
      stage: "REGISTERED",
      submittedAt: "2026-08-06",
      validatedAt: "2026-08-18",
      decisionAt: null,
      decision: null,
      applicantName: "A private applicant",
      agentName: "An agent",
      agentContact: "agent-secret@example.test",
      sourceUrl: "https://planning.example.test/detail?application=P%2F26%2F1521%2F2&token=url-secret",
      rawPayload: { cookie: "session-secret", csrf: "csrf-secret", details: {} }
    }]
  });

  const human = formatPlanningSourceTestResult(result, { json: false, score: true });
  assert.match(human, /Source\n/);
  assert.match(human, /Applications returned: 1/);
  assert.match(human, /P\/26\/1521\/2/);
  assert.match(human, /81 The Green/);
  assert.match(human, /Score: [\d.]+ \([A-Z]+\)/);
  assert.match(human, /Estimated value: \u00a3[\d,]+\u2013\u00a3[\d,]+/);

  const json = formatPlanningSourceTestResult(result, { json: true, score: true });
  const parsed = JSON.parse(json);
  assert.equal(parsed.applications[0].externalReference, "P/26/1521/2");
  assert.equal(typeof parsed.applications[0].score.score, "number");
  assert.equal(parsed.applications[0].rawPayload, undefined);
  assert.equal(parsed.applications[0].applicantName, undefined);
  assert.equal(parsed.applications[0].agentName, undefined);
  for (const secret of [
    "endpoint-secret", "url-secret", "session-secret", "csrf-secret", "agent-secret"
  ]) {
    assert.doesNotMatch(human, new RegExp(secret));
    assert.doesNotMatch(json, new RegExp(secret));
  }
  assert.match(json, /REDACTED/);
});

test("parsePlanningSourceTestArgs rejects invalid or unbounded input", () => {
  const invalidArguments = [
    ["--adapter", "custom", "--provider", "unknown", "--endpoint", "https://example.test"],
    ["--adapter", "idox_public_access", "--provider", "assure", "--endpoint", "https://example.test"],
    ["--adapter", "csv", "--endpoint", "https://user:password@example.test/feed.csv"],
    ["--adapter", "csv", "--endpoint", "https://example.test/feed.csv", "--lookback-days", "32"],
    ["--adapter", "csv", "--endpoint", "https://example.test/feed.csv", "--max-pages", "26"],
    ["--adapter", "csv", "--endpoint", "https://example.test/feed.csv", "--config-json", "[]"]
  ];

  for (const argv of invalidArguments) {
    assert.throws(() => parsePlanningSourceTestArgs(argv));
  }
});

test("runPlanningSourceTestCli performs one read-only dispatch and writes JSON", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let calls = 0;
  const exitCode = await runPlanningSourceTestCli([
    "--adapter", "custom",
    "--provider", "assure",
    "--endpoint", CHARNWOOD_ENDPOINT,
    "--lookback-days", "7",
    "--now", "2026-08-24T12:00:00Z",
    "--enrich-details", "false",
    "--json"
  ], {
    stdout: (value) => stdout.push(value),
    stderr: (value) => stderr.push(value)
  }, {
    fetchApplications: async () => {
      calls += 1;
      return [];
    }
  });

  assert.equal(exitCode, 0);
  assert.equal(calls, 1);
  assert.deepEqual(stderr, []);
  assert.equal(JSON.parse(stdout.join("")).summary.applicationsReturned, 0);
});

test("runPlanningSourceTestCli reports failures without exposing configured secrets", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCode = await runPlanningSourceTestCli([
    "--adapter", "csv",
    "--endpoint", "https://data.example.test/planning.csv?api_key=query-secret",
    "--config-json", JSON.stringify({ requestHeaders: { "x-client-id": "header-secret" } })
  ], {
    stdout: (value) => stdout.push(value),
    stderr: (value) => stderr.push(value)
  }, {
    fetchApplications: async () => {
      throw new Error("Upstream rejected query-secret and header-secret");
    }
  });

  assert.equal(exitCode, 1);
  assert.deepEqual(stdout, []);
  assert.match(stderr.join(""), /Upstream rejected/);
  assert.match(stderr.join(""), /REDACTED/);
  assert.doesNotMatch(stderr.join(""), /query-secret|header-secret/);
  assert.doesNotMatch(stderr.join(""), /\n\s+at /);
});
