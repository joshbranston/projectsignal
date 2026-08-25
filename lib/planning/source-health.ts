export type SourceHealthRow = {
  sourceId: string;
  counties: string[];
  authority: string;
  platform: string;
  sourceRole: "primary" | "fallback";
  sourceActive: boolean;
  officialActive: boolean;
  fallbackActive: boolean;
  lastScan: string | null;
  lastSuccess: string | null;
  nextScan: string | null;
  failures: number;
  error: string | null;
};

export function hasSourceHealthAccess(authorization: string | null, configuredSecret: string | undefined) {
  if (!configuredSecret || !authorization?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(authorization.slice("Bearer ".length));
  const expected = Buffer.from(configuredSecret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function one(value: any) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function platform(row: any) {
  if (row.adapter === "idox_public_access") return "Idox Public Access";
  if (row.adapter === "csv") return "CSV / open data";
  const provider = String(row?.config?.provider ?? "");
  const labels: Record<string, string> = {
    planit: "PlanIt",
    mastergov: "DEF Software / MasterGov",
    assure: "NEC ASSURE",
    statmap_horizon: "StatMap HorizoNext",
    agile_applications: "Agile Applications"
  };
  return labels[provider] ?? "Custom / unknown";
}

function safeError(value: unknown) {
  if (!value) return null;
  let message = String(value).replace(/[\u0000-\u001f\u007f]+/g, " ");
  message = message.replace(/https?:\/\/[^\s)]+/gi, (raw) => {
    try {
      const url = new URL(raw);
      if (url.username) url.username = "REDACTED";
      if (url.password) url.password = "REDACTED";
      for (const name of Array.from(url.searchParams.keys())) {
        if (/(?:api[-_]?key|token|secret|password|pass|auth|signature|session|csrf)/i.test(name)) {
          url.searchParams.set(name, "[REDACTED]");
        }
      }
      return url.toString();
    } catch {
      return "[invalid URL]";
    }
  });
  message = message
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(
      /\b(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api[-_]?key|token|secret|password|auth)\s*([:=])\s*([^\s,;]+)/gi,
      "$1$2[REDACTED]"
    )
    .trim();
  return message.slice(0, 500) || null;
}

export function buildSourceHealthRows(input: any[]): SourceHealthRow[] {
  const councilSources = new Map<string, any[]>();
  for (const row of input) {
    const council = one(row?.council);
    const councilId = String(council?.id ?? "");
    if (!councilId) continue;
    const rows = councilSources.get(councilId) ?? [];
    rows.push(row);
    councilSources.set(councilId, rows);
  }

  return input.flatMap((row): SourceHealthRow[] => {
    const council = one(row?.council);
    const councilId = String(council?.id ?? "");
    if (!councilId || !row?.id) return [];
    const siblings = councilSources.get(councilId) ?? [];
    const mappings = Array.isArray(council.planning_authority_counties)
      ? council.planning_authority_counties
      : [];
    const counties = Array.from(new Set<string>(mappings
      .map((mapping: any) => String(one(mapping?.county)?.name ?? "").trim())
      .filter(Boolean)
    )).sort();
    return [{
      sourceId: String(row.id),
      counties,
      authority: String(council.name ?? "Unknown authority"),
      platform: platform(row),
      sourceRole: row.source_role === "fallback" ? "fallback" : "primary",
      sourceActive: Boolean(row.active),
      officialActive: siblings.some((source) => source.source_role !== "fallback" && source.active),
      fallbackActive: siblings.some((source) => source.source_role === "fallback" && source.active),
      lastScan: row.last_scanned_at ?? null,
      lastSuccess: row.last_success_at ?? null,
      nextScan: row.next_scan_at ?? null,
      failures: Math.max(0, Number(row.consecutive_failures ?? 0)),
      error: safeError(row.last_error)
    }];
  }).sort((left, right) =>
    left.counties.join(",").localeCompare(right.counties.join(",")) ||
    left.authority.localeCompare(right.authority) ||
    Number(left.sourceRole === "fallback") - Number(right.sourceRole === "fallback")
  );
}
import { timingSafeEqual } from "node:crypto";
