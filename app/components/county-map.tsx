"use client";

import { useEffect, useMemo, useState } from "react";
import {
  countyNameToSlug,
  ENGLAND_MAP_HEIGHT,
  ENGLAND_MAP_WIDTH,
  geometryToSvgPath,
  projectLonLat
} from "@/lib/territory/geo";
import type { CountyOption } from "@/lib/territory/queries";

type BusinessLocation = {
  latitude: number;
  longitude: number;
} | null;

type GeoJsonFeature = {
  type: "Feature";
  properties?: Record<string, unknown>;
  geometry?: {
    type: "Polygon" | "MultiPolygon";
    coordinates: any;
  } | null;
};

type Props = {
  counties: CountyOption[];
  selectedCountySlugs: string[];
  businessLocation?: BusinessLocation;
  mode?: "select" | "view";
  countyLimit?: number;
  onToggle?: (slug: string) => void;
};

export function CountyMap({
  counties,
  selectedCountySlugs,
  businessLocation = null,
  mode = "select",
  countyLimit,
  onToggle
}: Props) {
  const [features, setFeatures] = useState<GeoJsonFeature[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch("/api/territory/county-geometry");
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error || "Unable to load county boundaries");
        if (!cancelled) setFeatures(Array.isArray(body?.features) ? body.features : []);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load county boundaries");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const countyBySlug = useMemo(
    () => new Map(counties.map((county) => [county.slug, county])),
    [counties]
  );

  const visibleFeatures = useMemo(() => {
    return features
      .map((feature) => {
        const name = String(feature.properties?.NAME ?? feature.properties?.County ?? "").trim();
        const slug = countyNameToSlug(name);
        return { feature, name, slug, county: countyBySlug.get(slug) };
      })
      .filter((entry) => entry.county && entry.feature.geometry);
  }, [features, countyBySlug]);

  const pin = businessLocation
    ? projectLonLat([businessLocation.longitude, businessLocation.latitude])
    : null;

  if (loading) {
    return <div className="county-map county-map-loading">Loading England county map…</div>;
  }

  if (error || visibleFeatures.length === 0) {
    return (
      <div className="county-map county-map-loading">
        <strong>County map temporarily unavailable.</strong>
        <span className="muted">You can still select counties from the list below.</span>
      </div>
    );
  }

  return (
    <div className="county-map-wrap">
      <svg
        className="county-map"
        viewBox={`0 0 ${ENGLAND_MAP_WIDTH} ${ENGLAND_MAP_HEIGHT}`}
        role="img"
        aria-label="Interactive map of England ceremonial counties"
      >
        {visibleFeatures.map(({ feature, name, slug, county }) => {
          const selected = selectedCountySlugs.includes(slug);
          const coverage = county?.coverageStatus ?? "coming_soon";
          const atLimit = typeof countyLimit === "number" && selectedCountySlugs.length >= countyLimit;
          const locked = mode === "select" && !selected && atLimit;
          const path = geometryToSvgPath(feature.geometry!);

          return (
            <path
              key={slug}
              d={path}
              className={`county-shape coverage-${coverage} ${selected ? "selected" : ""} ${mode === "select" && !locked ? "clickable" : ""} ${locked ? "locked" : ""}`}
              fillRule="evenodd"
              onClick={() => mode === "select" && !locked && onToggle?.(slug)}
              tabIndex={mode === "select" && !locked ? 0 : undefined}
              aria-disabled={locked || undefined}
              onKeyDown={(event) => {
                if (mode === "select" && !locked && (event.key === "Enter" || event.key === " ")) {
                  event.preventDefault();
                  onToggle?.(slug);
                }
              }}
            >
              <title>{name}{selected ? " — selected" : ""}</title>
            </path>
          );
        })}

        {pin && (
          <g className="business-pin" aria-label="Business location">
            <circle cx={pin[0]} cy={pin[1]} r="13" className="business-pin-halo" />
            <circle cx={pin[0]} cy={pin[1]} r="6" className="business-pin-dot" />
          </g>
        )}
      </svg>

      <div className="county-map-legend">
        <span><i className="legend-dot selected" />Selected</span>
        <span><i className="legend-dot live" />Live</span>
        <span><i className="legend-dot partial" />Partial</span>
        <span><i className="legend-dot soon" />Coming soon</span>
        {businessLocation && <span><i className="legend-pin" />Your business</span>}
      </div>
    </div>
  );
}
