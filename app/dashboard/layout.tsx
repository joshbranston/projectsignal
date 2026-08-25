import Link from "next/link";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/dashboard">ProjectSignal</Link>
        <Link className="side-link" href="/dashboard">Today</Link>
        <Link className="side-link" href="/dashboard/opportunities">Opportunities</Link>
        <Link className="side-link" href="/dashboard/territory">Territory map</Link>
        <Link className="side-link" href="/dashboard/settings">Territory & billing</Link>
        <form action="/auth/signout" method="post" style={{ marginTop: 30 }}>
          <button className="side-link" style={{ border: 0, background: "transparent", width: "100%", textAlign: "left" }}>Sign out</button>
        </form>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
