import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildSourceHealthRows, hasSourceHealthAccess } from "@/lib/planning/source-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function date(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

export default async function SourceHealthPage() {
  const requestHeaders = await headers();
  const secret = process.env.CRON_SECRET;
  if (!hasSourceHealthAccess(requestHeaders.get("authorization"), secret)) notFound();

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("planning_sources")
    .select(`
      id,adapter,config,source_role,active,last_scanned_at,last_success_at,next_scan_at,
      consecutive_failures,last_error,
      council:councils!inner(
        id,name,
        planning_authority_counties(county:counties(name))
      )
    `)
    .order("source_role", { ascending: true });
  if (error) throw new Error("Could not load source health");
  const rows = buildSourceHealthRows(data ?? []);
  const failing = rows.filter((row) => row.failures > 0).length;
  const stale = rows.filter((row) => row.sourceActive && !row.lastSuccess).length;

  return (
    <main className="source-health-page">
      <div className="topbar">
        <div><div className="eyebrow">Internal operations</div><h2>Planning source health</h2></div>
        <div className="muted">{rows.length} sources · {failing} failing · {stale} never successful</div>
      </div>
      <div className="source-health-table-wrap">
        <table className="source-health-table">
          <thead><tr>
            <th>County</th><th>Authority</th><th>Platform</th><th>Role</th><th>Source</th>
            <th>Official</th><th>Fallback</th><th>Last scan</th><th>Last success</th><th>Next scan</th><th>Failures</th><th>Error</th>
          </tr></thead>
          <tbody>{rows.map((row) => (
            <tr key={row.sourceId}>
              <td>{row.counties.join(", ") || "—"}</td>
              <td>{row.authority}</td>
              <td>{row.platform}</td>
              <td>{row.sourceRole}</td>
              <td>{row.sourceActive ? "Active" : "Disabled"}</td>
              <td>{row.officialActive ? "Active" : "Inactive"}</td>
              <td>{row.fallbackActive ? "Active" : "Inactive"}</td>
              <td>{date(row.lastScan)}</td>
              <td>{date(row.lastSuccess)}</td>
              <td>{date(row.nextScan)}</td>
              <td>{row.failures}</td>
              <td className="health-error">{row.error ?? "—"}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </main>
  );
}
