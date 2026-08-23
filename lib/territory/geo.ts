export const ENGLAND_MAP_WIDTH = 760;
export const ENGLAND_MAP_HEIGHT = 820;

const ENGLAND_BOUNDS = {
  minLon: -6.2,
  maxLon: 2.1,
  minLat: 49.7,
  maxLat: 56.1
};

const COUNTY_ALIASES: Record<string, string> = {
  "county durham": "durham",
  "tyne & wear": "tyne-and-wear",
  "tyne and wear": "tyne-and-wear"
};

export function countyNameToSlug(name: string) {
  const cleaned = name.trim().toLowerCase();
  if (COUNTY_ALIASES[cleaned]) return COUNTY_ALIASES[cleaned];

  return cleaned
    .replace(/&/g, " and ")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

export function projectLonLat([lon, lat]: [number, number]) {
  const x =
    ((lon - ENGLAND_BOUNDS.minLon) /
      (ENGLAND_BOUNDS.maxLon - ENGLAND_BOUNDS.minLon)) *
    ENGLAND_MAP_WIDTH;

  const y =
    (1 -
      (lat - ENGLAND_BOUNDS.minLat) /
        (ENGLAND_BOUNDS.maxLat - ENGLAND_BOUNDS.minLat)) *
    ENGLAND_MAP_HEIGHT;

  return [x, y] as const;
}

function ringToPath(ring: number[][]) {
  if (!ring.length) return "";

  return ring
    .map((pair, index) => {
      const [x, y] = projectLonLat([Number(pair[0]), Number(pair[1])]);
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ") + " Z";
}

export function geometryToSvgPath(geometry: {
  type: "Polygon" | "MultiPolygon";
  coordinates: number[][][] | number[][][][];
}) {
  if (!geometry) return "";

  if (geometry.type === "Polygon") {
    return (geometry.coordinates as number[][][])
      .map(ringToPath)
      .filter(Boolean)
      .join(" ");
  }

  if (geometry.type === "MultiPolygon") {
    return (geometry.coordinates as number[][][][])
      .flatMap((polygon) => polygon.map(ringToPath))
      .filter(Boolean)
      .join(" ");
  }

  return "";
}
