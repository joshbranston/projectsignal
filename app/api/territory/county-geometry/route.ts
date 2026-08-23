import { NextResponse } from "next/server";

export const runtime = "nodejs";

const COUNTY_SOURCE =
  "https://services.arcgis.com/qHLhLQrcvEnxjtPr/arcgis/rest/services/OS_Boundaryline/FeatureServer/12/query?where=1%3D1&outFields=NAME&returnGeometry=true&outSR=4326&geometryPrecision=4&maxAllowableOffset=0.001&f=geojson";

export async function GET() {
  try {
    const response = await fetch(COUNTY_SOURCE, {
      headers: {
        "user-agent": "ProjectSignal/0.1 county territory map"
      },
      next: { revalidate: 60 * 60 * 24 * 7 }
    });

    if (!response.ok) {
      throw new Error(`County boundary source returned ${response.status}`);
    }

    const geojson = await response.json();

    return NextResponse.json(geojson, {
      headers: {
        "cache-control": "public, s-maxage=604800, stale-while-revalidate=86400",
        "x-projectsignal-map-source": "OS Boundary-Line ceremonial counties"
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "County map unavailable";
    return NextResponse.json({ error: message, features: [] }, { status: 502 });
  }
}
