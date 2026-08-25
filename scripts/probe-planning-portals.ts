import { readFile, writeFile } from "node:fs/promises";
import { runPortalProbes } from "../lib/planning/coverage-discovery.ts";

type Investigation = {
  generatedAt: string;
  evidence: Record<string, unknown>;
  authorities: Array<{
    authoritySlug: string;
    portalUrl: string | null;
    [key: string]: unknown;
  }>;
};

const path = "docs/planning-authority-investigation.json";
const investigation = JSON.parse(await readFile(path, "utf8")) as Investigation;
const targets = investigation.authorities.flatMap((authority) =>
  authority.portalUrl
    ? [{ authoritySlug: authority.authoritySlug, portalUrl: authority.portalUrl }]
    : []
);

const results = await runPortalProbes(targets, { timeoutMs: 12_000 });
const probeBySlug = new Map(results.map((result) => [result.authoritySlug, result.probe]));
const updated = {
  ...investigation,
  generatedAt: new Date().toISOString(),
  evidence: {
    ...investigation.evidence,
    portalProbe: "Ordinary Node 22 HTTPS landing request; global concurrency 2 and per-host concurrency 1"
  },
  authorities: investigation.authorities.map((authority) => ({
    ...authority,
    portalProbe: probeBySlug.get(authority.authoritySlug) ?? null
  }))
};

await writeFile(path, `${JSON.stringify(updated, null, 2)}\n`);
const counts = new Map<string, number>();
for (const result of results) counts.set(result.probe.outcome, (counts.get(result.probe.outcome) ?? 0) + 1);
process.stdout.write(
  `Probed ${results.length} portals: ` +
  [...counts].map(([outcome, count]) => `${outcome}=${count}`).join(", ") +
  ".\n"
);
