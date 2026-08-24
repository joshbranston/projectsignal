import { randomUUID } from "node:crypto";
import { fetchCsvApplications } from "./adapters/csv.ts";
import { fetchIdoxApplications } from "./adapters/idox.ts";
import { fetchPlanItApplications } from "./adapters/planit.ts";
import { ingestApplications } from "./ingest.ts";
import { matchCountyLeads } from "./matching.ts";
import { scoreSavedApplications } from "./scoring.ts";
import type { PlanningSourceRecord } from "./types.ts";

export type SourceScanStats = {
  sourceRows: number;
  applicationsSaved: number;
  opportunities: number;
  customerMatches: number;
};

export type BatchScanStats = SourceScanStats & {
  sourcesProcessed: number;
  sourcesSucceeded: number;
  sourcesFailed: number;
  failures: Array<{ sourceId: string; councilSlug: string; error: string }>;
};

type ScanOne = (source: PlanningSourceRecord) => Promise<SourceScanStats>;
type MarkSuccess = (source: PlanningSourceRecord, stats: SourceScanStats) => Promise<void>;
type MarkFailure = (source: PlanningSourceRecord, error: Error) => Promise<void>;

export async function runSourceBatch(
  sources: PlanningSourceRecord[],
  scanOne: ScanOne,
  markSuccess: MarkSuccess,
  markFailure: MarkFailure
): Promise<BatchScanStats> {
  const result: BatchScanStats = {
    sourcesProcessed: 0,
    sourcesSucceeded: 0,
    sourcesFailed: 0,
    sourceRows: 0,
    applicationsSaved: 0,
    opportunities: 0,
    customerMatches: 0,
    failures: []
  };

  for (const source of sources) {
    result.sourcesProcessed++;

    try {
      const stats = await scanOne(source);
      await markSuccess(source, stats);
      result.sourcesSucceeded++;
      result.sourceRows += stats.sourceRows;
      result.applicationsSaved += stats.applicationsSaved;
      result.opportunities += stats.opportunities;
      result.customerMatches += stats.customerMatches;
    } catch (failure) {
      const error = failure instanceof Error ? failure : new Error(String(failure));
      result.sourcesFailed++;
      result.failures.push({
        sourceId: source.id,
        councilSlug: source.councilSlug,
        error: error.message
      });

      try {
        await markFailure(source, error);
      } catch (markError) {
        const message = markError instanceof Error ? markError.message : String(markError);
        result.failures.push({
          sourceId: source.id,
          councilSlug: source.councilSlug,
          error: `Unable to record source failure: ${message}`
        });
      }
    }
  }

  return result;
}

function councilFromRow(row: any) {
  const value = row?.council;
  const nested = Array.isArray(value) ? value[0] : value;
  if (nested) return nested;
  if (row?.council_id && row?.council_slug && row?.council_name) {
    return { id: row.council_id, slug: row.council_slug, name: row.council_name };
  }
  return null;
}

export function planningSourceFromRow(row: any): PlanningSourceRecord {
  const council = councilFromRow(row);
  if (!council?.id || !council?.slug || !council?.name) {
    throw new Error(`Planning source ${row?.id ?? "unknown"} is missing council identity`);
  }

  return {
    id: String(row.id),
    councilId: String(council.id),
    councilSlug: String(council.slug),
    councilName: String(council.name),
    slug: String(row.slug),
    adapter: String(row.adapter),
    endpointUrl: String(row.endpoint_url),
    format: row.format ? String(row.format) : null,
    config: row.config && typeof row.config === "object" ? row.config : {},
    priority: Number(row.priority ?? 100),
    scanEveryMinutes: Number(row.scan_every_minutes ?? 1440),
    consecutiveFailures: Number(row.consecutive_failures ?? 0),
    lastScannedAt: row.last_scanned_at ?? null,
    lastSuccessAt: row.last_success_at ?? null,
    nextScanAt: row.next_scan_at ?? null,
    sourceRole: row.source_role === "fallback" ? "fallback" : "primary",
    fallbackAfterFailures: Number(row.fallback_after_failures ?? 3),
    leaseToken: row.lease_token ?? null,
    leaseExpiresAt: row.lease_expires_at ?? null
  };
}

export async function fetchPlanningApplications(source: PlanningSourceRecord) {
  switch (source.adapter) {
    case "csv":
      return fetchCsvApplications(source);
    case "idox_public_access":
      return fetchIdoxApplications(source);
    case "custom":
      if (source.config.provider === "planit") return fetchPlanItApplications(source);
      throw new Error(`Unsupported custom planning source provider: ${source.config.provider ?? "unknown"}`);
    default:
      throw new Error(`Unsupported planning source adapter: ${source.adapter}`);
  }
}

export async function scanOnePlanningSource(
  admin: any,
  source: PlanningSourceRecord
): Promise<SourceScanStats> {
  const applications = await fetchPlanningApplications(source);

  const { data: trade, error: tradeError } = await admin
    .from("trades")
    .select("id,slug")
    .eq("slug", "windows-doors-bifolds")
    .eq("active", true)
    .single();

  if (tradeError || !trade) {
    throw tradeError ?? new Error("Windows, Doors & Bifolds trade is not configured");
  }

  const savedApps = await ingestApplications(admin, source, applications);
  const analyses = await scoreSavedApplications(admin, savedApps, trade);
  const customerMatches = await matchCountyLeads(
    admin,
    source.councilId,
    savedApps,
    analyses,
    trade
  );

  return {
    sourceRows: applications.length,
    applicationsSaved: savedApps.length,
    opportunities: analyses.length,
    customerMatches
  };
}

function nextScanIso(source: PlanningSourceRecord, multiplier = 1) {
  const baseMinutes = Math.max(15, Number(source.scanEveryMinutes ?? 1440));
  return new Date(Date.now() + baseMinutes * multiplier * 60_000).toISOString();
}

async function markSourceSuccess(admin: any, source: PlanningSourceRecord) {
  const now = new Date().toISOString();
  let update = admin
    .from("planning_sources")
    .update({
      last_scanned_at: now,
      last_success_at: now,
      next_scan_at: nextScanIso(source),
      consecutive_failures: 0,
      last_error: null,
      lease_token: null,
      lease_expires_at: null
    })
    .eq("id", source.id);

  if (source.leaseToken) update = update.eq("lease_token", source.leaseToken);
  const { error } = await update;
  if (error) throw error;

  // A degraded live authority can recover automatically after a successful feed run.
  await admin
    .from("councils")
    .update({ coverage_status: "live", last_error: null })
    .eq("id", source.councilId)
    .eq("coverage_status", "degraded");
}

async function markSourceFailure(admin: any, source: PlanningSourceRecord, error: Error) {
  const failures = Number(source.consecutiveFailures ?? 0) + 1;
  const backoff = Math.min(6, 2 ** Math.min(failures - 1, 3));
  const now = new Date().toISOString();

  let update = admin
    .from("planning_sources")
    .update({
      last_scanned_at: now,
      next_scan_at: nextScanIso(source, backoff),
      consecutive_failures: failures,
      last_error: error.message.slice(0, 1000),
      lease_token: null,
      lease_expires_at: null
    })
    .eq("id", source.id);

  if (source.leaseToken) update = update.eq("lease_token", source.leaseToken);
  const { error: updateError } = await update;
  if (updateError) throw updateError;

  await admin
    .from("councils")
    .update({
      last_scanned_at: now,
      last_error: error.message.slice(0, 1000),
      ...(failures >= 3 ? { coverage_status: "degraded" } : {})
    })
    .eq("id", source.councilId);
}

export async function loadDuePlanningSources(admin: any, limit = 5) {
  const boundedLimit = Math.max(1, Math.min(Math.floor(limit), 20));
  const workerToken = randomUUID();
  const { data, error } = await admin.rpc("claim_due_planning_sources", {
    p_limit: boundedLimit,
    p_worker_token: workerToken,
    p_lease_seconds: 90,
    p_planit_limit: 1
  });

  if (error) throw error;
  return (data ?? []).map(planningSourceFromRow);
}

export async function scanDuePlanningSources(admin: any, limit = 5) {
  const sources = await loadDuePlanningSources(admin, limit);
  return runSourceBatch(
    sources,
    (source) => scanOnePlanningSource(admin, source),
    (source) => markSourceSuccess(admin, source),
    (source, error) => markSourceFailure(admin, source, error)
  );
}

export async function scanPlanningSourceByCouncilSlug(admin: any, councilSlug: string) {
  const { data, error } = await admin
    .from("planning_sources")
    .select(
      "id,slug,adapter,endpoint_url,format,config,priority,scan_every_minutes,consecutive_failures,last_scanned_at,last_success_at,next_scan_at,council:councils!inner(id,slug,name,coverage_status)"
    )
    .eq("active", true)
    .eq("council.slug", councilSlug)
    .order("priority", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error(`${councilSlug} planning source is not configured`);

  const source = planningSourceFromRow(data);
  return runSourceBatch(
    [source],
    (item) => scanOnePlanningSource(admin, item),
    (item) => markSourceSuccess(admin, item),
    (item, failure) => markSourceFailure(admin, item, failure)
  );
}
