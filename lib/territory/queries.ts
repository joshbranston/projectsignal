import { createAdminClient } from "@/lib/supabase/admin";

export type CountyOption = {
  id: string;
  slug: string;
  name: string;
  nation: string;
  coverageStatus: "live" | "partial" | "coming_soon" | "degraded";
  coveragePercent: number;
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
        .select("county_id,council:councils(coverage_status)")
    ]);

  if (countyError) throw countyError;
  if (mappingError) throw mappingError;

  const statusesByCounty = new Map<string, string[]>();

  for (const mapping of mappings ?? []) {
    const councilValue = (mapping as any).council;
    const council = Array.isArray(councilValue) ? councilValue[0] : councilValue;
    const status = council?.coverage_status;
    const countyId = (mapping as any).county_id as string;

    if (!statusesByCounty.has(countyId)) statusesByCounty.set(countyId, []);
    if (status) statusesByCounty.get(countyId)!.push(String(status));
  }

  return (counties ?? []).map((county: any) => {
    const statuses = statusesByCounty.get(county.id) ?? [];
    const live = statuses.filter((status) => status === "live").length;
    const degraded = statuses.filter((status) => status === "degraded").length;
    const total = statuses.length;

    let coverageStatus: CountyOption["coverageStatus"] = "coming_soon";
    if (total > 0 && live === total) coverageStatus = "live";
    else if (live > 0 && degraded > 0) coverageStatus = "degraded";
    else if (live > 0) coverageStatus = "partial";
    else if (degraded > 0) coverageStatus = "degraded";

    return {
      id: county.id,
      slug: county.slug,
      name: county.name,
      nation: county.nation,
      coverageStatus,
      coveragePercent: total > 0 ? Math.round((live / total) * 100) : 0
    };
  });
}
