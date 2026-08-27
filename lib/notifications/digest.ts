export type DigestLead = {
  id: string;
  priority?: string | null;
  address?: string | null;
  postcode?: string | null;
  proposal?: string | null;
  estimated_value_min_gbp?: number | null;
  estimated_value_max_gbp?: number | null;
};

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(min?: number | null, max?: number | null) {
  const format = (value: number) => value >= 1000 ? `£${Math.round(value / 1000)}k` : `£${value}`;
  if (min && max) return `${format(min)}–${format(max)}`;
  if (min || max) return format((min || max)!);
  return "Value not estimated";
}

export function buildDailyOpportunityDigest(input: {
  companyName: string;
  leads: DigestLead[];
  siteUrl: string;
}) {
  const leads = input.leads.slice(0, 5);
  if (leads.length === 0) return null;

  const origin = new URL(input.siteUrl).origin;
  const cards = leads.map((lead) => {
    const location = lead.address || lead.postcode || "Planning opportunity";
    const href = `${origin}/dashboard/opportunities/${encodeURIComponent(lead.id)}`;
    return `
      <div style="border:1px solid #e4e7ec;border-radius:12px;padding:16px;margin:0 0 12px">
        <strong>${escapeHtml(lead.priority || "Opportunity")}</strong>
        <h2 style="font-size:18px;margin:7px 0">${escapeHtml(location)}</h2>
        <div><b>${escapeHtml(money(lead.estimated_value_min_gbp, lead.estimated_value_max_gbp))}</b> estimated opportunity value</div>
        <p>${escapeHtml(lead.proposal || "Planning opportunity")}</p>
        <p><a href="${href}">Open opportunity</a></p>
      </div>`;
  }).join("");

  return {
    subject: `${leads.length} new opportunities in your ProjectSignal territories`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:700px;margin:auto;color:#111827">
        <div style="font-weight:800">ProjectSignal</div>
        <h1>${leads.length} new opportunities for ${escapeHtml(input.companyName)}</h1>
        ${cards}
        <p><a href="${origin}/dashboard">Open your ProjectSignal dashboard</a></p>
      </div>`,
    leadIds: leads.map((lead) => lead.id)
  };
}
