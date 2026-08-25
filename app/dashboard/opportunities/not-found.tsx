import Link from "next/link";

export default function OpportunityNotFound() {
  return (
    <div className="panel">
      <h2>Opportunity not found</h2>
      <p className="muted">It may be outside your account or current entitlement.</p>
      <Link className="btn" href="/dashboard/opportunities">Back to opportunities</Link>
    </div>
  );
}
