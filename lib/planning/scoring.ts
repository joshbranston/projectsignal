import { bulkGeocode, normalizePostcode } from "../postcodes.ts";
import { scoreWindowsOpportunity } from "../scoring.ts";
import type { SavedPlanningApplication } from "./types.ts";
import type { TradeOpportunityAnalysis, TradeRecord } from "./matching.ts";

export const WINDOWS_QUALIFYING_SCORE = 5.5;

export function analyseWindowsApplication(
  app: SavedPlanningApplication
): TradeOpportunityAnalysis | null {
  const analysis = scoreWindowsOpportunity(
    app.proposal,
    app.address ?? "",
    app.decision ?? ""
  );

  if (analysis.score < WINDOWS_QUALIFYING_SCORE) return null;

  return {
    planningApplicationId: app.id,
    score: analysis.score,
    minValue: analysis.minValue,
    maxValue: analysis.maxValue,
    priority: analysis.priority,
    reason: analysis.reason,
    recommended: analysis.recommended,
    stage: analysis.stage,
    confidence: Math.min(0.95, 0.45 + analysis.score / 20)
  };
}

async function geocodeQualifiedApplications(
  admin: any,
  savedApps: SavedPlanningApplication[],
  analyses: TradeOpportunityAnalysis[]
) {
  const qualifiedIds = new Set(analyses.map((analysis) => analysis.planningApplicationId));
  const pending = savedApps.filter(
    (app) =>
      qualifiedIds.has(app.id) &&
      (app.latitude == null || app.longitude == null) &&
      Boolean(app.postcode)
  );

  if (pending.length === 0) return;

  const geo = await bulkGeocode(pending.map((app) => app.postcode!));

  for (const app of pending) {
    const coords = geo.get(normalizePostcode(app.postcode!));
    if (!coords) continue;

    const { error } = await admin
      .from("planning_applications")
      .update({
        latitude: coords.latitude,
        longitude: coords.longitude
      })
      .eq("id", app.id);

    if (error) throw error;
    app.latitude = coords.latitude;
    app.longitude = coords.longitude;
  }
}

export async function scoreSavedApplications(
  admin: any,
  savedApps: SavedPlanningApplication[],
  trade: TradeRecord
): Promise<TradeOpportunityAnalysis[]> {
  if (trade.slug !== "windows-doors-bifolds") {
    throw new Error(`No scoring engine configured for trade ${trade.slug}`);
  }

  const analyses = savedApps
    .map(analyseWindowsApplication)
    .filter((analysis): analysis is TradeOpportunityAnalysis => analysis !== null);

  await geocodeQualifiedApplications(admin, savedApps, analyses);

  if (analyses.length === 0) return [];

  const payload = analyses.map((analysis) => ({
    planning_application_id: analysis.planningApplicationId,
    trade_id: trade.id,
    score: analysis.score,
    estimated_value_min_gbp: analysis.minValue,
    estimated_value_max_gbp: analysis.maxValue,
    reason: analysis.reason,
    recommended_approach: analysis.recommended,
    confidence: analysis.confidence
  }));

  const { error } = await admin
    .from("application_trade_opportunities")
    .upsert(payload, {
      onConflict: "planning_application_id,trade_id"
    });

  if (error) throw error;
  return analyses;
}
