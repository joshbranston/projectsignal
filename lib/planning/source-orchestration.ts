import type { PlanningSourceRecord } from "./types.ts";

export function isPlanItSource(source: PlanningSourceRecord) {
  return source.adapter === "custom" && source.config.provider === "planit";
}

export function sourceCanFallback(
  fallback: PlanningSourceRecord,
  primarySources: PlanningSourceRecord[]
) {
  if ((fallback.sourceRole ?? "primary") !== "fallback") return false;
  const threshold = Math.max(1, Number(fallback.fallbackAfterFailures ?? 3));
  return primarySources.every(
    (source) => Number(source.consecutiveFailures ?? 0) >= threshold
  );
}
