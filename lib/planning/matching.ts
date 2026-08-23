import type { SavedPlanningApplication } from "./types.ts";

export type CountyLeadEligibilityInput = {
  subscriptionStatus: string | null | undefined;
  entitlementCountyId: string;
  applicationCountyIds: string[];
  entitlementStartsAt: string | null | undefined;
  applicationFirstSeenAt: string | null | undefined;
  opportunityScore: number;
  minimumScore: number;
  opportunityMinValueGbp: number;
  minimumOpportunityGbp: number;
};

export type TradeOpportunityAnalysis = {
  planningApplicationId: string;
  score: number;
  minValue: number;
  maxValue: number;
  priority: string;
  reason: string;
  recommended: string;
  stage: string;
  confidence: number;
};

export type TradeRecord = {
  id: string;
  slug: string;
};

export function isCountyLeadEligible(input: CountyLeadEligibilityInput) {
  if (input.subscriptionStatus !== "active") return false;
  if (!input.applicationCountyIds.includes(input.entitlementCountyId)) return false;
  if (!input.entitlementStartsAt || !input.applicationFirstSeenAt) return false;

  const entitlementStart = Date.parse(input.entitlementStartsAt);
  const applicationFirstSeen = Date.parse(input.applicationFirstSeenAt);
  if (!Number.isFinite(entitlementStart) || !Number.isFinite(applicationFirstSeen)) return false;
  if (applicationFirstSeen < entitlementStart) return false;

  if (input.opportunityScore < input.minimumScore) return false;
  if (input.opportunityMinValueGbp < input.minimumOpportunityGbp) return false;

  return true;
}

export async function matchCountyLeads(
  admin: any,
  councilId: string,
  savedApps: SavedPlanningApplication[],
  analyses: TradeOpportunityAnalysis[],
  trade: TradeRecord
) {
  if (savedApps.length === 0 || analyses.length === 0) return 0;

  const { data: mappings, error: mappingError } = await admin
    .from("planning_authority_counties")
    .select("county_id")
    .eq("council_id", councilId);

  if (mappingError) throw mappingError;

  const countyIds: string[] = [
    ...new Set<string>((mappings ?? []).map((row: any): string => String(row.county_id)))
  ];
  if (countyIds.length === 0) return 0;

  const { data: entitlementRows, error: entitlementError } = await admin
    .from("company_counties")
    .select("company_id,county_id,starts_at")
    .eq("status", "active")
    .in("county_id", countyIds);

  if (entitlementError) throw entitlementError;
  if (!entitlementRows?.length) return 0;

  // A company only needs one relevant county entitlement for an authority.
  // If more than one applies, use the earliest start date so entitlement is
  // never accidentally shortened by a later overlapping county purchase.
  const entitlementByCompany = new Map<string, any>();
  for (const row of entitlementRows) {
    const companyId = String(row.company_id);
    const existing = entitlementByCompany.get(companyId);
    if (!existing) {
      entitlementByCompany.set(companyId, row);
      continue;
    }

    const existingStart = Date.parse(existing.starts_at ?? "");
    const candidateStart = Date.parse(row.starts_at ?? "");
    if (Number.isFinite(candidateStart) && (!Number.isFinite(existingStart) || candidateStart < existingStart)) {
      entitlementByCompany.set(companyId, row);
    }
  }

  const companyIds = [...entitlementByCompany.keys()];

  const [subscriptionsResult, tradesResult, territoriesResult] = await Promise.all([
    admin
      .from("subscriptions")
      .select("company_id,status")
      .eq("status", "active")
      .in("company_id", companyIds),
    admin
      .from("company_trades")
      .select("company_id,min_opportunity_gbp")
      .eq("trade_id", trade.id)
      .in("company_id", companyIds),
    admin
      .from("territories")
      .select("id,company_id,minimum_score")
      .eq("active", true)
      .in("company_id", companyIds)
  ]);

  if (subscriptionsResult.error) throw subscriptionsResult.error;
  if (tradesResult.error) throw tradesResult.error;
  if (territoriesResult.error) throw territoriesResult.error;

  const subscriptionByCompany = new Map(
    (subscriptionsResult.data ?? []).map((row: any) => [String(row.company_id), row])
  );
  const tradeByCompany = new Map(
    (tradesResult.data ?? []).map((row: any) => [String(row.company_id), row])
  );
  const territoryByCompany = new Map<string, any>();
  for (const row of territoriesResult.data ?? []) {
    const companyId = String(row.company_id);
    if (!territoryByCompany.has(companyId)) territoryByCompany.set(companyId, row);
  }
  const analysisByApp = new Map(
    analyses.map((analysis) => [analysis.planningApplicationId, analysis])
  );

  let matches = 0;

  for (const [companyId, entitlement] of entitlementByCompany) {
    const subscription = subscriptionByCompany.get(companyId) as any;
    const companyTrade = tradeByCompany.get(companyId) as any;
    const territory = territoryByCompany.get(companyId) as any;

    if (!subscription || !companyTrade || !territory) continue;

    for (const app of savedApps) {
      const analysis = analysisByApp.get(app.id);
      if (!analysis) continue;

      const eligible = isCountyLeadEligible({
        subscriptionStatus: subscription.status,
        entitlementCountyId: String(entitlement.county_id),
        applicationCountyIds: countyIds,
        entitlementStartsAt: entitlement.starts_at,
        applicationFirstSeenAt: app.first_seen_at,
        opportunityScore: analysis.score,
        minimumScore: Number(territory.minimum_score ?? 0),
        opportunityMinValueGbp: analysis.minValue,
        minimumOpportunityGbp: Number(companyTrade.min_opportunity_gbp ?? 0)
      });

      if (!eligible) continue;

      const title = analysis.score >= 8.5
        ? "High-value planning opportunity"
        : "Matched planning opportunity";

      const { error } = await admin
        .from("customer_leads")
        .upsert(
          {
            company_id: companyId,
            territory_id: territory.id,
            planning_application_id: app.id,
            trade_id: trade.id,
            score: analysis.score,
            priority: analysis.priority,
            title,
            address: app.address,
            postcode: app.postcode,
            stage: analysis.stage || app.stage,
            proposal: app.proposal,
            estimated_value_min_gbp: analysis.minValue,
            estimated_value_max_gbp: analysis.maxValue,
            why_it_matches: analysis.reason,
            recommended_approach: analysis.recommended
          },
          {
            onConflict: "company_id,planning_application_id,trade_id"
          }
        );

      if (error) throw error;
      matches++;
    }
  }

  return matches;
}
