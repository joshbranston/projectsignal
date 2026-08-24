export type CountyCoverageStatus = "live" | "partial" | "coming_soon" | "degraded";

export type AuthorityCoverageInput = {
  active: boolean;
  coverageStatus: string;
  lastSuccessAt?: string | null;
};

export type CountyCoverageSummary = {
  coverageStatus: CountyCoverageStatus;
  coveragePercent: number;
  totalAuthorities: number;
  liveAuthorities: number;
  testingAuthorities: number;
  degradedAuthorities: number;
  lastSuccessfulRefresh: string | null;
};

export function summariseCountyCoverage(
  authorities: AuthorityCoverageInput[]
): CountyCoverageSummary {
  const current = authorities.filter((authority) => authority.active);
  const totalAuthorities = current.length;
  const liveAuthorities = current.filter(
    (authority) => authority.coverageStatus === "live"
  ).length;
  const testingAuthorities = current.filter(
    (authority) => authority.coverageStatus === "testing" || authority.coverageStatus === "configured"
  ).length;
  const degradedAuthorities = current.filter(
    (authority) => authority.coverageStatus === "degraded"
  ).length;

  const refreshes = current
    .map((authority) => authority.lastSuccessAt)
    .filter((value): value is string => Boolean(value))
    .sort();

  let coverageStatus: CountyCoverageStatus = "coming_soon";
  if (totalAuthorities > 0 && liveAuthorities === totalAuthorities) {
    coverageStatus = "live";
  } else if (degradedAuthorities > 0) {
    coverageStatus = "degraded";
  } else if (liveAuthorities > 0) {
    coverageStatus = "partial";
  }

  return {
    coverageStatus,
    coveragePercent:
      totalAuthorities > 0 ? Math.round((liveAuthorities / totalAuthorities) * 100) : 0,
    totalAuthorities,
    liveAuthorities,
    testingAuthorities,
    degradedAuthorities,
    lastSuccessfulRefresh: refreshes.length > 0 ? refreshes[refreshes.length - 1] : null
  };
}
