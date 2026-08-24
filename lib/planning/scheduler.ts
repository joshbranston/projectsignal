export function normaliseProjectBaseUrl(value: string) {
  const trimmed = String(value ?? "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error("Project base URL must start with http:// or https://");
  }
  return trimmed;
}

export async function bootstrapPlanningScheduler(
  admin: any,
  cronSecret: string,
  baseUrl: string
) {
  if (!cronSecret) throw new Error("CRON_SECRET is not configured");
  const normalisedBaseUrl = normaliseProjectBaseUrl(baseUrl);
  const { data, error } = await admin.rpc("bootstrap_projectsignal_planning_scheduler", {
    p_cron_secret: cronSecret,
    p_base_url: normalisedBaseUrl
  });
  if (error) throw error;
  return data;
}
