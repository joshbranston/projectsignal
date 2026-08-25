import { readFile, writeFile } from "node:fs/promises";
import type { OfficialPlanningSourceDefinition, OfficialSourceClassification } from "../lib/planning/coverage.ts";

type InvestigationAuthority = {
  authorityName: string;
  authoritySlug: string;
  officialCouncilPage: string | null;
  platformHint: string | null;
  portalUrl: string | null;
  legacySuccessor: string | null;
  discoveryError: string | null;
  portalProbe?: {
    outcome: "reachable" | "unsafe_protocol" | "transport_error" | "http_error" | "redirect_limit";
    finalUrl: string | null;
    status: number | null;
    platform: string | null;
    errorCode: string | null;
    error: string | null;
  } | null;
  adapterVerification?: {
    outcome: "passed" | "failed";
    checkedAt: string;
    applicationsReturned: number;
    detailEnriched: number;
    error: string | null;
  };
};

const known: Record<string, Partial<OfficialPlanningSourceDefinition>> = {
  wigan: {
    platform: "Wigan Open Data CSV", adapter: "csv", classification: "OFFICIAL_LIVE", status: "live",
    endpoint: "https://opendata.wigan.gov.uk/api/download/v1/items/1a3ea7fae81b46b68aa36ed2401f1161/csv?layers=9",
    evidence: "Production primary source with successful scans",
    localVerification: { outcome: "passed", checkedAt: "2026-08-24", recordCount: 0, detailsVerified: false, clue: "Production-proven CSV; bounded window contained no new applications" },
    config: { fields: { address: "ADDRESS", decision: "DECSN", proposal: "PROPOSAL", externalReference: "REFVAL" } }
  },
  leicester: { platform: "DEF Software / MasterGov", adapter: "custom", provider: "mastergov", classification: "OFFICIAL_LIVE", status: "live", endpoint: "https://planning.leicester.gov.uk/", evidence: "Production primary source with successful scans", localVerification: { outcome: "passed", checkedAt: "2026-08-24", recordCount: 24, detailsVerified: true } },
  blaby: { platform: "Idox Public Access", adapter: "idox_public_access", classification: "OFFICIAL_LIVE", status: "live", endpoint: "https://pa.blaby.gov.uk/online-applications/", evidence: "Production primary source with successful scans", localVerification: { outcome: "passed", checkedAt: "2026-08-24", recordCount: 8, detailsVerified: true } },
  charnwood: { platform: "NEC ASSURE", adapter: "custom", provider: "assure", classification: "OFFICIAL_LIVE", status: "live", endpoint: "https://planningexplorer.charnwood.gov.uk/Assure/ES/Presentation/Planning/OnLinePlanning/OnlinePlanningSearch", evidence: "Production primary source with successful scans", localVerification: { outcome: "passed", checkedAt: "2026-08-24", recordCount: 6, detailsVerified: true } },
  "peak-district-national-park": { platform: "NEC ASSURE", adapter: "custom", provider: "assure", classification: "OFFICIAL_LIVE", status: "live", endpoint: "https://planning.peakdistrict.gov.uk/AssureLive/ES/Presentation/Planning/OnlinePlanning/OnlinePlanningSearch", evidence: "Production primary source with successful scans", localVerification: { outcome: "passed", checkedAt: "2026-08-24", recordCount: 29, detailsVerified: true } },
  lichfield: { platform: "Idox Public Access", adapter: "idox_public_access", classification: "OFFICIAL_LIVE", status: "live", endpoint: "https://planning.lichfielddc.gov.uk/online-applications/", evidence: "Production primary source with successful scans", localVerification: { outcome: "passed", checkedAt: "2026-08-24", recordCount: 17, detailsVerified: true } },
  "south-staffordshire": { platform: "Idox Public Access", adapter: "idox_public_access", classification: "OFFICIAL_LIVE", status: "live", endpoint: "https://planning.sstaffs.gov.uk/online-applications/", evidence: "Production primary source with successful scans", localVerification: { outcome: "passed", checkedAt: "2026-08-24", recordCount: 8, detailsVerified: true } },
  "east-staffordshire": { platform: "StatMap HorizoNext", adapter: "custom", provider: "statmap_horizon", classification: "OFFICIAL_READY", status: "ready", endpoint: "https://eaststaffs-publicportal.statmap.co.uk/horizoNext/publicportal", evidence: "Complete bounded Node 22 search and detail verification", localVerification: { outcome: "passed", checkedAt: "2026-08-24", recordCount: 5, detailsVerified: true } },
  "cannock-chase": { platform: "Agile Applications Citizen Portal", adapter: "custom", provider: "agile_applications", classification: "OFFICIAL_READY", status: "ready", endpoint: "https://planning.agileapplications.co.uk/cannock", evidence: "Complete bounded Node 22 search and detail verification", localVerification: { outcome: "passed", checkedAt: "2026-08-24", recordCount: 9, detailsVerified: true } },
  harborough: { platform: "Idox Public Access", adapter: "idox_public_access", classification: "OFFICIAL_BLOCKED_TIMEOUT", status: "blocked", endpoint: "https://pa2.harborough.gov.uk/online-applications/", blocker: "Vercel connection timeout (UND_ERR_CONNECT_TIMEOUT); TLS verification remains enabled", evidence: "Production diagnostic and bounded local transport investigation" },
  "hinckley-bosworth": { platform: "Idox Public Access", adapter: "idox_public_access", classification: "OFFICIAL_BLOCKED_WAF", status: "blocked", endpoint: "https://pa.hinckley-bosworth.gov.uk/online-applications/", blocker: "Official search POST rejected with HTTP 403; no reusable Idox requirement evidenced", evidence: "Production diagnostic and bounded request-flow comparison" },
  melton: { platform: "Idox Public Access", adapter: "idox_public_access", classification: "OFFICIAL_BLOCKED_PORTAL_DOWN", status: "blocked", endpoint: "https://pa.melton.gov.uk/online-applications/", blocker: "Official portal unavailable (previous HTTP 503; current bounded Node 22 request timed out)", evidence: "Official council register link and bounded transport checks" },
  "north-west-leicestershire": { platform: "Idox Public Access (legacy template)", adapter: "idox_public_access", classification: "OFFICIAL_BLOCKED_TLS", status: "blocked", endpoint: "https://plans.nwleics.gov.uk/public-access/", blocker: "Official host certificate chain fails verification (UNABLE_TO_VERIFY_LEAF_SIGNATURE)", evidence: "Official council terms flow and Node 22 TLS diagnostic" },
  "oadby-and-wigston": { platform: "Idox Public Access", adapter: "idox_public_access", classification: "OFFICIAL_BLOCKED_TLS", status: "blocked", endpoint: "https://pa.oadby-wigston.gov.uk/online-applications/", blocker: "Official host certificate chain fails verification (UNABLE_TO_VERIFY_LEAF_SIGNATURE)", evidence: "Official council PublicAccess reference and Node 22 TLS diagnostic" },
  stafford: { platform: "Idox Public Access", adapter: "idox_public_access", classification: "OFFICIAL_BLOCKED_TIMEOUT", status: "blocked", endpoint: "https://www12.staffordbc.gov.uk/online-applications/", blocker: "Vercel connection timeout (UND_ERR_CONNECT_TIMEOUT)", evidence: "Locally compatible Idox flow and production transport diagnostic" },
  "newcastle-under-lyme": { platform: "Idox Public Access", adapter: "idox_public_access", classification: "OFFICIAL_BLOCKED_TLS", status: "blocked", endpoint: "https://publicaccess.newcastle-staffs.gov.uk/online-applications/", blocker: "Official host certificate chain fails verification (UNABLE_TO_VERIFY_LEAF_SIGNATURE)", evidence: "Official council link and Node 22 TLS diagnostic" },
  "staffordshire-moorlands": { platform: "Legacy ApplicationSearchServlet", adapter: null, classification: "OFFICIAL_BLOCKED_UNSAFE_PROTOCOL", status: "blocked", endpoint: "https://publicaccess.staffsmoorlands.gov.uk/portal/servlets/ApplicationSearchServlet", blocker: "Official HTTPS endpoint cannot establish a valid TLS session; plain HTTP is prohibited", evidence: "Bounded Node 22 protocol investigation" },
  "stoke-on-trent": { platform: "Tascomi", adapter: null, classification: "OFFICIAL_BLOCKED_WAF", status: "blocked", endpoint: "https://development.stoke.gov.uk/planning/index.html", blocker: "AWS WAF challenge blocks useful ordinary-HTTP routes; no bypass attempted", evidence: "Official council link and bounded Node 22 protocol investigation" },
  tamworth: { platform: "Northgate M3 PlanningExplorer", adapter: null, classification: "OFFICIAL_BLOCKED_TLS", status: "blocked", endpoint: "https://planning.tamworth.gov.uk/Northgate/PlanningExplorerAA/Generic/StdDetails.aspx", blocker: "Official host certificate chain fails verification; TLS bypass is prohibited", evidence: "Official register and Node 22 TLS diagnostic" }
};

const OFFICIAL_PLANNING_PAGES: Readonly<Record<string, string>> = {
  peterborough: "https://www.peterborough.gov.uk/council/planning-and-development/planning-and-building/search-applications",
  islington: "https://www.islington.gov.uk/planning/applications/comment",
  slough: "https://www.slough.gov.uk/planning-building-control/search-comment-track-planning-applications",
  "mole-valley": "https://www.molevalley.gov.uk/planning-building/search-planning-application/",
  "lake-district-national-park": "https://lakedistrict.gov.uk/planning/planning-applications/planning-application-search/",
  "new-forest-national-park": "https://www.newforestnpa.gov.uk/planning-home-page/search-for-a-planning-application/guide-to-viewing/",
  "yorkshire-dales-national-park": "https://www.yorkshiredales.org.uk/planning/view-planning-applications/",
  "old-oak-and-park-royal-development-corporation": "https://www.london.gov.uk/who-we-are/city-halls-partners/old-oak-and-park-royal-development-corporation-opdc/planning/planning-applications"
};

function adapterFor(item: InvestigationAuthority) {
  const hint = item.platformHint ?? "";
  const detected = item.portalProbe?.platform ?? "";
  if (detected === "Idox Public Access" && hint === "Idox Public Access") return { adapter: "idox_public_access" as const };
  if (detected === "DEF / MasterGov" && /^(?:DEF|def_v3|def_csrf|Plansearch|online_register)$/.test(hint)) return { adapter: "custom" as const, provider: "mastergov" as const };
  if (detected === "NEC ASSURE" && hint === "NECSWS") return { adapter: "custom" as const, provider: "assure" as const };
  if (detected === "StatMap HorizoNext" && hint === "statmap") return { adapter: "custom" as const, provider: "statmap_horizon" as const };
  if (hint === "Agile Applications" && item.portalUrl && new URL(item.portalUrl).hostname === "planning.agileapplications.co.uk") return { adapter: "custom" as const, provider: "agile_applications" as const };
  return { adapter: null };
}

function classification(item: InvestigationAuthority): { classification: OfficialSourceClassification; blocker?: string } {
  if (item.authoritySlug === "high-peak") return { classification: "OFFICIAL_BLOCKED_UNSAFE_PROTOCOL", blocker: "Official council search link downgrades to plaintext HTTP; HTTPS transport is unavailable" };
  if (item.authoritySlug === "london-legacy-development-corporation") return { classification: "OFFICIAL_UNSUPPORTED" };
  if (item.authoritySlug === "new-forest") return { classification: "OFFICIAL_BLOCKED_INCOMPLETE", blocker: "Discovered client key resolves to the New Forest National Park register, not the district planning authority; authority identity check failed" };
  if (item.legacySuccessor) return { classification: "OFFICIAL_UNSUPPORTED" };
  if (item.portalProbe?.outcome === "reachable" && item.portalProbe.platform === "Idox Public Access" && item.platformHint === "Idox Public Access") {
    return { classification: "OFFICIAL_BLOCKED_INCOMPLETE", blocker: "Idox landing/session flow is reachable, but this deployment has not provided a safely verified advertised-total completeness check" };
  }
  const verification = item.adapterVerification;
  if (verification?.outcome === "passed") {
    if (item.portalProbe?.platform === "Idox Public Access" && item.platformHint === "Idox Public Access") {
      return { classification: "OFFICIAL_BLOCKED_INCOMPLETE", blocker: "Bounded Idox search parsed successfully, but this Idox template does not expose a safely verified advertised-total completeness check" };
    }
    return verification.applicationsReturned > 0 && verification.detailEnriched > 0
      ? { classification: "OFFICIAL_READY" }
      : { classification: "OFFICIAL_BLOCKED_INCOMPLETE", blocker: verification.applicationsReturned > 0
        ? "Bounded search normalized base rows, but detail enrichment was not proven"
        : "Bounded adapter search completed but returned no applications, so normalization compatibility is not yet proven" };
  }
  const diagnostic = `${verification?.error ?? ""} ${item.portalProbe?.errorCode ?? ""} ${item.portalProbe?.error ?? ""}`;
  if (/CERT_|CERTIFICATE|TLS|SSL|UNABLE_TO_VERIFY_LEAF_SIGNATURE/i.test(diagnostic)) return { classification: "OFFICIAL_BLOCKED_TLS", blocker: "Verified HTTPS request failed certificate/TLS validation; verification was not bypassed" };
  if (/403|WAF|challenge/i.test(diagnostic) || item.portalProbe?.status === 403) return { classification: "OFFICIAL_BLOCKED_WAF", blocker: "Ordinary public HTTP request was rejected with HTTP 403; no WAF bypass attempted" };
  if (/TIMEOUT|TIMEDOUT|ABORT/i.test(diagnostic)) return { classification: "OFFICIAL_BLOCKED_TIMEOUT", blocker: "Bounded Node 22 request timed out" };
  if (/(?:status=|HTTP\s*)5\d\d|(?:status=|HTTP\s*)404/i.test(diagnostic)) return { classification: "OFFICIAL_BLOCKED_PORTAL_DOWN", blocker: "Official search flow returned an upstream unavailable/not-found response" };
  if (verification?.outcome === "failed") return { classification: "OFFICIAL_BLOCKED_INCOMPLETE", blocker: "Existing platform adapter could not prove a complete normalized bounded search: " + (verification.error ?? "unknown adapter failure") };
  if (item.portalProbe?.outcome === "unsafe_protocol") return { classification: "OFFICIAL_BLOCKED_UNSAFE_PROTOCOL", blocker: "Official portal redirects to plaintext HTTP; downgrade is prohibited" };
  if (item.portalProbe?.outcome === "transport_error") return { classification: "OFFICIAL_BLOCKED_INCOMPLETE", blocker: `Official portal transport failed without a safely reusable application-layer remedy${item.portalProbe.errorCode ? ` (${item.portalProbe.errorCode})` : ""}` };
  if (item.portalProbe?.outcome === "http_error") return { classification: "OFFICIAL_BLOCKED_PORTAL_DOWN", blocker: `Official portal returned HTTP ${item.portalProbe.status ?? "error"}` };
  if (item.portalProbe?.outcome === "redirect_limit") return { classification: "OFFICIAL_BLOCKED_INCOMPLETE", blocker: "Official portal exceeded the bounded redirect limit" };
  return { classification: "OFFICIAL_UNSUPPORTED" };
}

function endpoint(item: InvestigationAuthority) {
  if (item.authoritySlug === "high-peak") return "https://planning.highpeak.gov.uk/portal/servlets/ApplicationSearchServlet";
  if (item.authoritySlug === "london-legacy-development-corporation") return "https://www.london.gov.uk/programmes-strategies/planning/implementing-london-plan/london-legacy-development-corporation";
  return item.portalUrl ?? item.officialCouncilPage ?? "https://www.planning.data.gov.uk/";
}

function httpsUrl(value: string) {
  const url = new URL(value);
  if (url.protocol === "http:") url.protocol = "https:";
  return url.toString();
}

function platformFor(item: InvestigationAuthority, adapter: ReturnType<typeof adapterFor>) {
  if (adapter.adapter === "idox_public_access") return "Idox Public Access";
  if (adapter.provider === "mastergov") return "DEF Software / MasterGov";
  if (adapter.provider === "assure") return "NEC ASSURE";
  if (adapter.provider === "statmap_horizon") return "StatMap HorizoNext";
  if (adapter.provider === "agile_applications") return "Agile Applications Citizen Portal";
  return item.portalProbe?.platform && item.portalProbe.platform !== "Unknown"
    ? item.portalProbe.platform
    : item.platformHint ?? (item.legacySuccessor ? "Legacy authority (successor register)" : "Unidentified official planning register");
}

const investigation = JSON.parse(await readFile("docs/planning-authority-investigation.json", "utf8")) as { authorities: InvestigationAuthority[] };
const sources = investigation.authorities.map((item): OfficialPlanningSourceDefinition => {
  const classified = classification(item);
  const adapter = adapterFor(item);
  const base: OfficialPlanningSourceDefinition = {
    authoritySlug: item.authoritySlug,
    platform: platformFor(item, adapter),
    ...adapter,
    officialCouncilPage: httpsUrl(OFFICIAL_PLANNING_PAGES[item.authoritySlug] ?? item.officialCouncilPage ?? endpoint(item)),
    endpoint: httpsUrl(endpoint(item)),
    ...classified,
    status: classified.classification === "OFFICIAL_LIVE" ? "live" : classified.classification === "OFFICIAL_READY" ? "ready" : "blocked",
    evidence: item.legacySuccessor
      ? `Planning Data legacy LPA is superseded by ${item.legacySuccessor}; no separate current official source`
      : item.authoritySlug === "london-legacy-development-corporation"
        ? "LLDC planning powers returned to Hackney, Newham, Tower Hamlets and Waltham Forest on 1 December 2024"
        : classified.classification === "OFFICIAL_UNSUPPORTED" && item.portalProbe?.outcome === "reachable"
          ? `Official register was reachable and platform-classified, but no adapter met bounded-search/completeness acceptance; PlanIt retained`
          : `Official council/register discovery followed by bounded independent Node 22 probe (${item.portalProbe?.outcome ?? item.discoveryError ?? "no current portal"})`,
    lastInvestigatedAt: "2026-08-24",
    ...(item.adapterVerification ? { localVerification: {
      outcome: item.adapterVerification.outcome,
      checkedAt: item.adapterVerification.checkedAt,
      recordCount: item.adapterVerification.applicationsReturned,
      detailsVerified: item.adapterVerification.detailEnriched > 0,
      ...(item.adapterVerification.error ? { clue: item.adapterVerification.error } : {})
    } } : {})
  };
  return { ...base, ...(known[item.authoritySlug] ?? {}) } as OfficialPlanningSourceDefinition;
}).sort((left, right) => left.authoritySlug.localeCompare(right.authoritySlug));

const body = `import type { OfficialPlanningSourceDefinition } from "./coverage.ts";\n\n` +
  `// Generated from the public planning-authority investigation snapshot. This is documentation/configuration only;\n` +
  `// it does not activate sources or change the 337 PlanIt fallbacks.\n` +
  `export const EVIDENCED_OFFICIAL_PLANNING_SOURCES = ${JSON.stringify(sources, null, 2)} as const satisfies readonly OfficialPlanningSourceDefinition[];\n`;
await writeFile("lib/planning/coverage-catalogue.ts", body);
process.stdout.write(`Wrote ${sources.length} classified official-source catalogue entries.\n`);
