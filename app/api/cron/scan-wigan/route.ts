import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseCsv } from "@/lib/csv";
import { scoreWindowsOpportunity } from "@/lib/scoring";
import { bulkGeocode, milesBetween, normalizePostcode } from "@/lib/postcodes";

export const runtime = "nodejs";
export const maxDuration = 60;

const WIGAN_CSV =
  "https://opendata.wigan.gov.uk/api/download/v1/items/1a3ea7fae81b46b68aa36ed2401f1161/csv?layers=9";

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: council, error: councilError } = await admin
    .from("councils")
    .select("id")
    .eq("slug", "wigan")
    .single();

  if (councilError || !council) {
    return NextResponse.json({ error: "Wigan council source is not configured" }, { status: 500 });
  }

  const [{ data: trade }, response] = await Promise.all([
    admin.from("trades").select("id").eq("slug", "windows-doors-bifolds").single(),
    fetch(WIGAN_CSV, {
      headers: { "user-agent": "ProjectSignal/0.1 planning opportunity scanner" },
      cache: "no-store"
    })
  ]);

  if (!response.ok || !trade) {
    await admin.from("councils").update({
      last_scanned_at: new Date().toISOString(),
      last_error: `Feed returned ${response.status}`
    }).eq("id", council.id);
    return NextResponse.json({ error: "Unable to fetch Wigan planning feed" }, { status: 502 });
  }

  const parsed = parseCsv(await response.text());
  const scored = parsed
    .map((row: any) => {
      const reference = String(row.REFVAL ?? "").trim();
      const address = String(row.ADDRESS ?? "").trim();
      const proposal = String(row.PROPOSAL ?? "").trim();
      const decision = String(row.DECSN ?? "").trim();
      if (!reference || !proposal) return null;
      return { row, reference, address, proposal, decision, analysis: scoreWindowsOpportunity(proposal, address, decision) };
    })
    .filter(Boolean) as any[];

  // Geocode only useful glazing opportunities; bulk endpoint keeps this inexpensive.
  const qualifyingPostcodes = scored
    .filter((x) => x.analysis.score >= 5.5 && x.analysis.postcode)
    .map((x) => x.analysis.postcode);
  const geo = await bulkGeocode(qualifyingPostcodes);

  const applicationPayload = scored.map((item) => {
    const coords = geo.get(normalizePostcode(item.analysis.postcode));
    return {
      council_id: council.id,
      external_reference: item.reference,
      address: item.address || null,
      postcode: item.analysis.postcode || null,
      latitude: coords?.latitude ?? null,
      longitude: coords?.longitude ?? null,
      proposal: item.proposal,
      stage: item.analysis.stage,
      decision: item.decision || null,
      source_payload: item.row,
      last_seen_at: new Date().toISOString()
    };
  });

  const savedApps: any[] = [];
  for (let i = 0; i < applicationPayload.length; i += 500) {
    const { data, error } = await admin
      .from("planning_applications")
      .upsert(applicationPayload.slice(i, i + 500), {
        onConflict: "council_id,external_reference"
      })
      .select("id,external_reference,address,postcode,latitude,longitude,proposal,stage");
    if (error) throw error;
    savedApps.push(...(data ?? []));
  }

  const scoreByRef = new Map(scored.map((x) => [x.reference, x.analysis]));
  const opportunityPayload = savedApps
    .map((app) => {
      const analysis = scoreByRef.get(app.external_reference);
      if (!analysis || analysis.score < 5.5) return null;
      return {
        planning_application_id: app.id,
        trade_id: trade.id,
        score: analysis.score,
        estimated_value_min_gbp: analysis.minValue,
        estimated_value_max_gbp: analysis.maxValue,
        reason: analysis.reason,
        recommended_approach: analysis.recommended,
        confidence: Math.min(0.95, 0.45 + analysis.score / 20)
      };
    })
    .filter(Boolean);

  if (opportunityPayload.length) {
    const { error } = await admin
      .from("application_trade_opportunities")
      .upsert(opportunityPayload, { onConflict: "planning_application_id,trade_id" });
    if (error) throw error;
  }

  const [{ data: territories }, { data: companyTrades }, { data: activeSubscriptions }] =
    await Promise.all([
      admin.from("territories").select("*").eq("active", true),
      admin.from("company_trades").select("*").eq("trade_id", trade.id),
      admin.from("subscriptions").select("company_id,status").in("status", ["active","trialing"])
    ]);

  const activeCompanies = new Set((activeSubscriptions ?? []).map((s: any) => s.company_id));
  const tradeByCompany = new Map((companyTrades ?? []).map((t: any) => [t.company_id, t]));

  // Fill any missing territory coordinates in one batch.
  const territoryPostcodes = (territories ?? [])
    .filter((t: any) => t.centre_latitude == null || t.centre_longitude == null)
    .map((t: any) => t.centre_postcode);
  const territoryGeo = territoryPostcodes.length ? await bulkGeocode(territoryPostcodes) : new Map();

  for (const territory of territories ?? []) {
    if (territory.centre_latitude == null || territory.centre_longitude == null) {
      const coords = territoryGeo.get(normalizePostcode(territory.centre_postcode));
      if (coords) {
        territory.centre_latitude = coords.latitude;
        territory.centre_longitude = coords.longitude;
        await admin.from("territories").update({
          centre_latitude: coords.latitude,
          centre_longitude: coords.longitude
        }).eq("id", territory.id);
      }
    }
  }

  let matches = 0;
  for (const territory of territories ?? []) {
    if (!activeCompanies.has(territory.company_id)) continue;
    const companyTrade = tradeByCompany.get(territory.company_id);
    if (!companyTrade) continue;
    if (territory.centre_latitude == null || territory.centre_longitude == null) continue;

    for (const app of savedApps) {
      const analysis = scoreByRef.get(app.external_reference);
      if (!analysis || analysis.score < Number(territory.minimum_score)) continue;
      if (analysis.minValue < Number(companyTrade.min_opportunity_gbp ?? 0)) continue;
      if (app.latitude == null || app.longitude == null) continue;

      const distance = milesBetween(
        territory.centre_latitude,
        territory.centre_longitude,
        app.latitude,
        app.longitude
      );
      if (distance > Number(territory.radius_miles)) continue;

      const title =
        analysis.score >= 8.5
          ? "High-value planning opportunity"
          : "Matched planning opportunity";

      const { error } = await admin.from("customer_leads").upsert({
        company_id: territory.company_id,
        territory_id: territory.id,
        planning_application_id: app.id,
        trade_id: trade.id,
        score: analysis.score,
        priority: analysis.priority,
        title,
        address: app.address,
        postcode: app.postcode,
        stage: app.stage,
        proposal: app.proposal,
        estimated_value_min_gbp: analysis.minValue,
        estimated_value_max_gbp: analysis.maxValue,
        why_it_matches: analysis.reason,
        recommended_approach: analysis.recommended
      }, { onConflict: "company_id,planning_application_id,trade_id" });

      if (!error) matches++;
    }
  }

  await admin.from("councils").update({
    last_scanned_at: new Date().toISOString(),
    last_success_at: new Date().toISOString(),
    last_error: null
  }).eq("id", council.id);

  return NextResponse.json({
    source_rows: parsed.length,
    applications_saved: savedApps.length,
    glazing_opportunities: opportunityPayload.length,
    customer_matches: matches
  });
}
