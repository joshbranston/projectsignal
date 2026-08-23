function normalise(values: string[]) {
  return [
    ...new Set(
      values
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean)
    )
  ];
}

export function toggleCountySelection(
  current: string[],
  countySlug: string,
  countyLimit: number
) {
  const selected = normalise(current);
  const slug = countySlug.trim().toLowerCase();

  if (!slug) return selected;

  if (selected.includes(slug)) {
    return selected.filter((value) => value !== slug);
  }

  if (selected.length >= Math.max(0, countyLimit)) {
    return selected;
  }

  return [...selected, slug];
}
