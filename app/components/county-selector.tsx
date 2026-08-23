"use client";

import { useEffect, useRef, useState } from "react";
import type { CountyOption } from "@/lib/territory/queries";
import { toggleCountySelection } from "@/lib/territory/selector-state";
import { CountyMap } from "@/app/components/county-map";

type BusinessLocation = {
  latitude: number;
  longitude: number;
} | null;

type Props = {
  counties: CountyOption[];
  countyLimit: number;
  postcodeInputId?: string | null;
  initialBusinessLocation?: BusinessLocation;
};

export function CountySelector({
  counties,
  countyLimit,
  postcodeInputId = "postcode",
  initialBusinessLocation = null
}: Props) {
  const [selected, setSelected] = useState<string[]>([]);
  const [businessLocation, setBusinessLocation] = useState<BusinessLocation>(
    initialBusinessLocation
  );
  const [postcodeStatus, setPostcodeStatus] = useState<string | null>(null);
  const lastLookup = useRef("");

  function toggle(slug: string) {
    setSelected((current) => toggleCountySelection(current, slug, countyLimit));
  }

  useEffect(() => {
    if (!postcodeInputId) return;

    const input = document.getElementById(postcodeInputId) as HTMLInputElement | null;
    if (!input) return;

    const postcodeInput: HTMLInputElement = input;
    let cancelled = false;

    async function updateBusinessPin() {
      const postcode = postcodeInput.value.trim();
      const lookupKey = postcode.replace(/\s+/g, "").toUpperCase();

      if (lookupKey.length < 5 || lookupKey === lastLookup.current) return;
      lastLookup.current = lookupKey;
      setPostcodeStatus("Locating your business…");

      try {
        const response = await fetch(
          `/api/geocode/postcode?postcode=${encodeURIComponent(postcode)}`,
          { cache: "no-store" }
        );
        const body = await response.json();

        if (!response.ok || typeof body?.latitude !== "number" || typeof body?.longitude !== "number") {
          throw new Error(body?.error || "Postcode not found");
        }

        if (!cancelled) {
          setBusinessLocation({
            latitude: body.latitude,
            longitude: body.longitude
          });
          setPostcodeStatus("Business pin located");
        }
      } catch {
        if (!cancelled) {
          setBusinessLocation(null);
          setPostcodeStatus("Enter a valid UK postcode to place your business pin");
          lastLookup.current = "";
        }
      }
    }

    postcodeInput.addEventListener("blur", updateBusinessPin);
    postcodeInput.addEventListener("change", updateBusinessPin);

    if (postcodeInput.value.trim()) void updateBusinessPin();

    return () => {
      cancelled = true;
      postcodeInput.removeEventListener("blur", updateBusinessPin);
      postcodeInput.removeEventListener("change", updateBusinessPin);
    };
  }, [postcodeInputId]);

  return (
    <div className="county-selector">
      <div className="county-selector-head">
        <div>
          <label>Select your counties</label>
          <p className="muted" style={{ margin: "4px 0 0" }}>
            These become your subscription territory after payment. You can choose up to {countyLimit}.
          </p>
          {postcodeStatus && <p className="county-pin-status">{postcodeStatus}</p>}
        </div>
        <strong>{selected.length} of {countyLimit}</strong>
      </div>

      <CountyMap
        counties={counties}
        selectedCountySlugs={selected}
        businessLocation={businessLocation}
        mode="select"
        countyLimit={countyLimit}
        onToggle={toggle}
      />

      <div className="county-grid" aria-label="England counties">
        {counties.map((county) => {
          const isSelected = selected.includes(county.slug);
          const locked = !isSelected && selected.length >= countyLimit;
          const coverageLabel = county.coverageStatus === "coming_soon"
            ? "Coming soon"
            : county.coverageStatus === "partial"
              ? `Partial${county.coveragePercent ? ` · ${county.coveragePercent}%` : ""}`
              : county.coverageStatus === "degraded"
                ? "Degraded"
                : "Live";

          return (
            <button
              key={county.slug}
              type="button"
              className={`county-option ${isSelected ? "selected" : ""} ${locked ? "locked" : ""}`}
              onClick={() => toggle(county.slug)}
              disabled={locked}
              aria-pressed={isSelected}
            >
              <span>{county.name}</span>
              <small>{isSelected ? "Selected" : locked ? "Plan limit" : coverageLabel}</small>
            </button>
          );
        })}
      </div>

      {selected.map((slug) => (
        <input key={slug} type="hidden" name="county_slugs" value={slug} />
      ))}
    </div>
  );
}
