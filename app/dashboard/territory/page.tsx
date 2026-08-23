import Link from "next/link";
import { redirect } from "next/navigation";
import { getCompanyContext } from "@/lib/auth";
import { getEnglandCountyOptions } from "@/lib/territory/queries";
import { CountySelector } from "@/app/components/county-selector";
import { CountyMap } from "@/app/components/county-map";
import { claimInitialCountyTerritory } from "./actions";

function countyFromEntitlement(entitlement: any) {
  const value = entitlement?.county;
  return Array.isArray(value) ? value[0] : value;
}

function businessLocation(company: any, territory: any) {
  const latitude = company?.latitude ?? territory?.centre_latitude;
  const longitude = company?.longitude ?? territory?.centre_longitude;

  if (latitude == null || longitude == null) return null;

  return {
    latitude: Number(latitude),
    longitude: Number(longitude)
  };
}

export default async function TerritoryPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { company, subscription, companyCounties, billingPlan, territory } = await getCompanyContext();
  if (!company) redirect("/onboarding");

  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : null;
  const success = typeof params.success === "string" ? params.success : null;
  const countyLimit = Number(billingPlan?.county_limit ?? 3);
  const counties = await getEnglandCountyOptions();
  const location = businessLocation(company, territory);
  const existing = (companyCounties ?? []).map((entry: any) => ({
    ...entry,
    county: countyFromEntitlement(entry)
  }));

  if (existing.length > 0) {
    const selectedSlugs = existing
      .map((entry: any) => entry.county?.slug)
      .filter(Boolean) as string[];

    return (
      <>
        <div className="topbar">
          <div>
            <div className="eyebrow">Territory</div>
            <h2 style={{ marginTop: 5 }}>Your subscribed counties</h2>
            <div className="muted">{existing.length} of {countyLimit} included counties</div>
          </div>
          <Link href="/dashboard/settings" className="btn secondary">Billing settings</Link>
        </div>

        {success && <div className="notice" style={{ marginBottom: 16 }}>{success}</div>}

        <div className="panel" style={{ display: "grid", gap: 18 }}>
          <CountyMap
            counties={counties}
            selectedCountySlugs={selectedSlugs}
            businessLocation={location}
            mode="view"
          />

          <div className="territory-chips">
            {existing.map((entry: any) => (
              <span className="territory-chip" key={entry.id}>
                {entry.county?.name ?? "County"} · {entry.status}
              </span>
            ))}
          </div>

          <div className="notice">
            These counties are locked into your current subscription period. Adding more territory requires a paid subscription change; replacements/removals take effect at renewal.
          </div>
        </div>
      </>
    );
  }

  if (subscription?.status !== "active") {
    return (
      <div className="panel">
        <h2>Activate ProjectSignal first</h2>
        <p className="muted">Your county territory can be locked once your ProjectSignal Pro subscription is active.</p>
        <form action="/api/checkout" method="post">
          <button className="btn">Activate subscription</button>
        </form>
      </div>
    );
  }

  return (
    <>
      <div className="topbar">
        <div>
          <div className="eyebrow">One-time migration</div>
          <h2 style={{ marginTop: 5 }}>Choose your ProjectSignal counties</h2>
          <div className="muted">Your existing account can choose up to {countyLimit} counties once.</div>
        </div>
      </div>

      {error && <div className="notice error" style={{ marginBottom: 16 }}>{error}</div>}

      <form action={claimInitialCountyTerritory} className="panel form">
        <CountySelector
          counties={counties}
          countyLimit={countyLimit}
          postcodeInputId={null}
          initialBusinessLocation={location}
        />
        <div className="notice">
          When you save this selection it becomes your subscribed territory. You will not be able to cycle through different counties for free during the billing period.
        </div>
        <button className="btn">Lock these counties into my subscription</button>
      </form>
    </>
  );
}
