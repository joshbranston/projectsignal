export function subscriptionAllowsNewLeads(status?: string | null) {
  return status === "active";
}

export function validateInitialCountySelection(
  selectedCountySlugs: string[],
  countyLimit: number
) {
  const countySlugs = [
    ...new Set(
      selectedCountySlugs
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean)
    )
  ];

  if (countySlugs.length === 0) {
    return {
      ok: false as const,
      error: "Select at least one county."
    };
  }

  if (countySlugs.length > countyLimit) {
    return {
      ok: false as const,
      error: `Your plan includes up to ${countyLimit} counties.`
    };
  }

  return {
    ok: true as const,
    countySlugs
  };
}

export function countySelectionUsage(
  activeCount: number,
  scheduledCount: number,
  countyLimit: number
) {
  const used = Math.max(0, activeCount) + Math.max(0, scheduledCount);

  return {
    used,
    remaining: Math.max(0, countyLimit - used),
    atLimit: used >= countyLimit
  };
}
