import Link from "next/link";
import type { CustomerOpportunityDetail } from "@/lib/crm/data";
import { classifyFollowUp } from "@/lib/crm/opportunities";
import { formatGbp, stageLabel } from "@/lib/crm/presentation";
import { updateOpportunityAction } from "./actions";

function date(value: string | null) {
  if (!value) return "Date unavailable";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(value));
}
function preserveFields(opportunity: CustomerOpportunityDetail) {
  return (
    <>
      <input type="hidden" name="opportunity_id" value={opportunity.id} />
      <input type="hidden" name="follow_up_at" value={opportunity.followUpAt ?? ""} />
      <input type="hidden" name="quote_value_gbp" value={opportunity.quoteValueGbp ?? ""} />
      <input type="hidden" name="won_value_gbp" value={opportunity.wonValueGbp ?? ""} />
      <input type="hidden" name="lost_reason" value={opportunity.lostReason ?? ""} />
      <input type="hidden" name="not_relevant_reason" value={opportunity.notRelevantReason ?? ""} />
    </>
  );
}

export function OpportunityCard({ opportunity }: { opportunity: CustomerOpportunityDetail }) {
  const followUp = classifyFollowUp(opportunity.followUpAt);
  return (
    <article className="opportunity-card">
      <div className="opportunity-card-main">
        <div className="badge-row">
          <span className={`pill ${opportunity.priority.toLowerCase()}`}>
            {opportunity.priority} · {opportunity.score}/10
          </span>
          <span className="stage-badge">{stageLabel(opportunity.status)}</span>
          {followUp !== "none" && <span className={`follow-up-badge ${followUp}`}>Follow-up {followUp}</span>}
        </div>
        <Link href={`/dashboard/opportunities/${opportunity.id}`} className="opportunity-title">
          {opportunity.proposal}
        </Link>
        <div className="opportunity-meta">
          {opportunity.externalReference} · {opportunity.postcode ?? opportunity.address ?? "Address unavailable"}
        </div>
        <div className="opportunity-meta">
          {opportunity.councilName} · {opportunity.countyNames.join(", ") || "County unavailable"} · Validated {date(opportunity.validatedAt)}
        </div>
        <p className="opportunity-reason">{opportunity.whyItMatches ?? "Review the planning proposal and official application details."}</p>
      </div>
      <div className="opportunity-card-side">
        <div className="value-label">Estimated opportunity</div>
        <strong>{formatGbp(opportunity.estimatedValueMinGbp)}–{formatGbp(opportunity.estimatedValueMaxGbp)}</strong>
        {opportunity.quoteValueGbp !== null && <div className="muted">Quote: {formatGbp(opportunity.quoteValueGbp)}</div>}
        <div className="quick-actions" aria-label={`Quick actions for ${opportunity.externalReference}`}>
          {opportunity.status === "new" && (
            <form action={updateOpportunityAction}>
              {preserveFields(opportunity)}
              <button name="stage" value="reviewing">Review</button>
            </form>
          )}
          {!(["contacted", "quoted", "won", "lost", "not_relevant"] as string[]).includes(opportunity.status) && (
            <form action={updateOpportunityAction}>
              {preserveFields(opportunity)}
              <button name="stage" value="contacted">Contacted</button>
            </form>
          )}
          <Link className="button-link" href={`/dashboard/opportunities/${opportunity.id}`}>Open</Link>
        </div>
      </div>
    </article>
  );
}
