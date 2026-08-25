import assert from "node:assert/strict";
import test from "node:test";
import {
  parseCoverageIndex,
  parseCoverageDetail,
  joinAuthorityDiscovery,
  probePlanningPortal,
  runPortalProbes
} from "../../lib/planning/coverage-discovery.ts";

test("coverage discovery joins official council websites and identifies legacy successor LPAs", () => {
  const joined = joinAuthorityDiscovery(
    [
      { authoritySlug: "adur", name: "Adur LPA", reference: "E60000281" },
      { authoritySlug: "allerdale", name: "Allerdale LPA", reference: "E60000019" }
    ],
    [
      { name: "Adur District Council", website: "https://www.adur-worthing.gov.uk", localPlanningAuthority: "E60000281" },
      { name: "Allerdale Borough Council", website: "https://www.allerdale.gov.uk", localPlanningAuthority: "E60000019" }
    ],
    [{ code: "E07000223", authorityName: "Adur", platformHint: "Idox" }]
  );

  assert.deepEqual(joined[0], {
    authoritySlug: "adur",
    authorityName: "Adur",
    authorityReference: "E60000281",
    officialCouncilPage: "https://www.adur-worthing.gov.uk/",
    coverageCode: "E07000223",
    platformHint: "Idox",
    legacySuccessor: null
  });
  assert.equal(joined[1]?.coverageCode, null);
  assert.equal(joined[1]?.legacySuccessor, "Cumberland");
});

test("coverage discovery parses platform rows and the original HTTPS portal", () => {
  const index = String.raw`<script>self.__next_f.push([1,"37:[\"$\",\"tr\",\"E07000223\",{\"children\":[[\"$\",\"td\",null,{\"children\":[[\"$\",\"$L17\",null,{\"href\":\"/coverage/E07000223\",\"children\":\"Adur\"}],false]}],[\"$\",\"td\",null,{\"children\":\"Idox\"}]]}]"])</script>`;
  assert.deepEqual(parseCoverageIndex(index), [
    { code: "E07000223", authorityName: "Adur", platformHint: "Idox" }
  ]);

  const detail = `
    <p>We index every application published on Adur's planning portal
      (<!-- -->Idox Public Access<!-- -->).</p>
    <a href="https://planning.adur-worthing.gov.uk/online-applications">
      https://planning.adur-worthing.gov.uk/online-applications
    </a>`;
  assert.deepEqual(parseCoverageDetail(detail), {
    portalUrl: "https://planning.adur-worthing.gov.uk/online-applications",
    platformHint: "Idox Public Access"
  });
});

test("coverage detail ignores embedded script payloads when reading the visible platform label", () => {
  const detail = `
    <script>self.__next_f.push([1,"planning portal (\\\",\\\"wrong\\\")"])</script>
    <p>We index applications from the planning portal
      (<!-- -->Agile Applications<!-- -->).</p>
    <a href="https://planning.agileapplications.co.uk/example">
      https://planning.agileapplications.co.uk/example
    </a>`;
  assert.equal(parseCoverageDetail(detail).platformHint, "Agile Applications");
});

test("portal probe follows only bounded HTTPS redirects and identifies platform signatures", async () => {
  const requested: string[] = [];
  const fetchImpl = async (input: string | URL | Request) => {
    const url = String(input);
    requested.push(url);
    if (requested.length === 1) {
      return new Response(null, { status: 302, headers: { location: "/online-applications/" } });
    }
    return new Response("<title>Idox Public Access</title><form action='search.do'></form>", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" }
    });
  };

  const result = await probePlanningPortal(
    "https://planning.example.test/start",
    fetchImpl as typeof fetch
  );
  assert.deepEqual(requested, [
    "https://planning.example.test/start",
    "https://planning.example.test/online-applications/"
  ]);
  assert.equal(result.outcome, "reachable");
  assert.equal(result.platform, "Idox Public Access");
  assert.equal(result.status, 200);
});

test("portal probe rejects plaintext redirects before requesting them", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response(null, {
      status: 302,
      headers: { location: "http://unsafe.example.test/planning" }
    });
  };
  const result = await probePlanningPortal(
    "https://planning.example.test/start",
    fetchImpl as typeof fetch
  );
  assert.equal(calls, 1);
  assert.equal(result.outcome, "unsafe_protocol");
  assert.doesNotMatch(JSON.stringify(result), /unsafe-token/i);
});

test("portal probe rejects private-network redirects before requesting them", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response(null, { status: 302, headers: { location: "https://127.0.0.1/admin" } });
  };
  const result = await probePlanningPortal("https://planning.example.test/start", fetchImpl as typeof fetch);
  assert.equal(calls, 1);
  assert.equal(result.outcome, "unsafe_protocol");
  assert.equal(result.errorCode, "UNSAFE_PROTOCOL");
});

test("portal probe keeps nested transport codes and redacts query secrets", async () => {
  const secret = "discovery-secret-123";
  const fetchImpl = async () => {
    const cause = Object.assign(new Error(`connect failed token ${secret}`), {
      code: "UND_ERR_CONNECT_TIMEOUT"
    });
    throw Object.assign(new TypeError("fetch failed"), { cause });
  };
  const result = await probePlanningPortal(
    `https://planning.example.test/search?api_key=${secret}`,
    fetchImpl as typeof fetch
  );
  assert.equal(result.outcome, "transport_error");
  assert.equal(result.errorCode, "UND_ERR_CONNECT_TIMEOUT");
  assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
  assert.match(result.error ?? "", /\[REDACTED\]/);
});

test("portal probe stops reading oversized signature bodies", async () => {
  let cancelled = false;
  let pulls = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1;
      controller.enqueue(new Uint8Array(128_000));
      if (pulls === 10) controller.close();
    },
    cancel() { cancelled = true; }
  });
  const result = await probePlanningPortal(
    "https://planning.example.test/search",
    (async () => new Response(stream, { status: 200, headers: { "content-type": "text/html" } })) as typeof fetch
  );
  assert.equal(result.outcome, "reachable");
  assert.equal(cancelled, true);
  assert.ok(pulls <= 6);
});

test("discovery probe runner limits global concurrency to two and each host to one", async () => {
  let active = 0;
  let maxActive = 0;
  const perHost = new Map<string, number>();
  let maxPerHost = 0;
  const fetchImpl = async (input: string | URL | Request) => {
    const host = new URL(String(input)).hostname;
    active += 1;
    perHost.set(host, (perHost.get(host) ?? 0) + 1);
    maxActive = Math.max(maxActive, active);
    maxPerHost = Math.max(maxPerHost, perHost.get(host) ?? 0);
    await new Promise((resolve) => setTimeout(resolve, 8));
    active -= 1;
    perHost.set(host, (perHost.get(host) ?? 1) - 1);
    return new Response("<title>Planning register</title>", {
      status: 200,
      headers: { "content-type": "text/html" }
    });
  };
  const results = await runPortalProbes([
    { authoritySlug: "a", portalUrl: "https://one.example.test/a" },
    { authoritySlug: "b", portalUrl: "https://one.example.test/b" },
    { authoritySlug: "c", portalUrl: "https://two.example.test/c" },
    { authoritySlug: "d", portalUrl: "https://two.example.test/d" }
  ], { fetchImpl: fetchImpl as typeof fetch });

  assert.equal(results.length, 4);
  assert.equal(maxActive, 2);
  assert.equal(maxPerHost, 1);
});
