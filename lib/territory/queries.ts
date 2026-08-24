import { createAdminClient } from "@/lib/supabase/admin";
import { summariseCountyCoverage } from "@/lib/territory/coverage";

export type CountyOption = {
  id: string;
  slug: string;
  name: string;
  nation: string;
  coverageStatus: "live" | "partial" | "coming_soon" | "degraded";
  coveragePercent: number;
  totalAuthorities: number;
  liveAuthorities: number;
  testingAuthorities: number;
  degradedAuthorities: number;
  lastSuccessfulRefresh: string | null;
};

export async function getEnglandCountyOptions(): Promise<CountyOption[]> {
  const admin = createAdminClient();

  const [{ data: counties, error: countyError }, { data: mappings, error: mappingError }] =
    await Promise.all([
      admin
        .from("counties")
        .select("id,slug,name,nation")
        .eq("nation", "England")
        .eq("active", true)
        .order("name"),
      admin
        .from("planning_authority_counties")
        .select("county_id,council:councils(active,coverage_status,last_success_at)")
    ]);

  if (countyError) throw countyError;
  if (mappingError) throw mappingError;

  const authoritiesByCounty = new Map<
    string,
    Array<{ active: boolean; coverageStatus: string; lastSuccessAt: string | null }>
  >();

  for (const mapping of mappings ?? []) {
    const councilValue = (mapping as any).council;
    const council = Array.isArray(councilValue) ? councilValue[0] : councilValue;
    const countyId = (mapping as any).county_id as string;

    if (!council) continue;
    if (!authoritiesByCounty.has(countyId)) authoritiesByCounty.set(countyId, []);
    authoritiesByCounty.get(countyId)!.push({
      active: Boolean(council.active),
      coverageStatus: String(council.coverage_status ?? "discovery"),
      lastSuccessAt: council.last_success_at ? String(council.last_success_at) : null
    });
  }

  return (counties ?? []).map((county: any) => {
    const summary = summariseCountyCoverage(authoritiesByCounty.get(county.id) ?? []);

    return {
      id: county.id,
      slug: county.slug,
      name: county.name,
      nation: county.nation,
      ...summary
    };
  });
}
