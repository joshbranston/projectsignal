export type Coordinates = { latitude: number; longitude: number };

export function normalizePostcode(postcode: string) {
  return postcode.trim().toUpperCase().replace(/\s+/g, " ");
}

export async function geocodePostcode(postcode: string): Promise<Coordinates | null> {
  const normalized = normalizePostcode(postcode);
  const res = await fetch(
    `https://api.postcodes.io/postcodes/${encodeURIComponent(normalized)}`,
    { cache: "no-store" }
  );

  if (!res.ok) return null;
  const json = await res.json();
  const result = json?.result;
  if (!result?.latitude || !result?.longitude) return null;

  return { latitude: result.latitude, longitude: result.longitude };
}

export async function bulkGeocode(postcodes: string[]) {
  const unique = Array.from(new Set(postcodes.map(normalizePostcode).filter(Boolean)));
  const result = new Map<string, Coordinates>();

  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    const res = await fetch("https://api.postcodes.io/postcodes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ postcodes: chunk }),
      cache: "no-store"
    });

    if (!res.ok) continue;
    const json = await res.json();

    for (const item of json?.result ?? []) {
      const query = normalizePostcode(item.query ?? "");
      const value = item.result;
      if (query && value?.latitude && value?.longitude) {
        result.set(query, {
          latitude: value.latitude,
          longitude: value.longitude
        });
      }
    }
  }

  return result;
}

export function milesBetween(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
) {
  const R = 3958.7613;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) *
      Math.cos(toRad(bLat)) *
      Math.sin(dLng / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(h));
}
