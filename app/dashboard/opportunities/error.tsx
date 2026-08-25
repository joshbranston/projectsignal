"use client";

export default function OpportunitiesError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="panel" role="alert">
      <h2>We could not load the opportunity manager</h2>
      <p className="muted">No changes were made. Try again, or return to the dashboard.</p>
      <button className="btn" onClick={reset}>Try again</button>
    </div>
  );
}
