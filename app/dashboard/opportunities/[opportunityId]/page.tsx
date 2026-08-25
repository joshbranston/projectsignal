import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCompanyContext, subscriptionAllowsLeads } from "@/lib/auth";
import {
  CUSTOMER_OPPORTUNITY_SELECT,
  isCrmSchemaUnavailableError,
  normaliseCustomerOpportunityRow
} from "@/lib/crm/data";
import {
  CRM_STAGES,
  LOST_REASONS,
  NOT_RELEVANT_REASONS,
  normaliseOpportunityStage
} from "@/lib/crm/domain";
import { formatGbp, stageLabel } from "@/lib/crm/presentation";
import {
  addOpportunityNoteAction,
  deleteOpportunityNoteAction,
  updateOpportunityAction,
  updateOpportunityNoteAction
} from "../actions";

const NOTE_READ_LIMIT = 200;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function date(value: string | null) {
  if (!value) return "Not available";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: value.includes("T") ? "short" : undefined }).format(parsed);
}

function dateTimeInput(value: string | null) {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(value));
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

function safeHttpUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

function MigrationPending() {
  return (
    <div className="panel locked" role="status">
      <h2>Opportunity manager upgrade pending</h2>
      <p className="muted">This detail view will be available after the CRM database upgrade. Your existing opportunity feed is still available.</p>
      <Link className="btn" href="/dashboard">Return to Today</Link>
    </div>
  );
}

function activityDescription(event: any) {
  const metadata = event?.metadata && typeof event.metadata === "object" ? event.metadata : {};
  if (event.event_type === "stage_changed") {
    const from = normaliseOpportunityStage(event.from_status);
    const to = normaliseOpportunityStage(event.to_status);
    return `Moved ${stageLabel(from)} → ${stageLabel(to)}`;
  }
  if (event.event_type === "follow_up_changed") {
    return metadata.follow_up_at ? `Follow-up set for ${date(String(metadata.follow_up_at))}` : "Follow-up cleared";
  }
  if (event.event_type === "quote_changed") {
    return metadata.quote_value_gbp === null ? "Quote cleared" : `Quote changed to ${formatGbp(Number(metadata.quote_value_gbp))}`;
  }
  if (event.event_type === "opportunity_created") return "Opportunity created";
  if (event.event_type === "note_added") return "Note added";
  if (event.event_type === "note_updated") return "Note updated";
  if (event.event_type === "note_deleted") return "Note deleted";
  return "Opportunity updated";
}

export default async function OpportunityDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ opportunityId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ opportunityId }, query] = await Promise.all([params, searchParams]);
  const { supabase, company, subscription } = await getCompanyContext();
  if (!company) redirect("/onboarding");
  if (!subscriptionAllowsLeads(subscription?.status)) redirect("/dashboard");

  const { data, error } = await supabase
    .from("customer_leads")
    .select(CUSTOMER_OPPORTUNITY_SELECT)
    .eq("id", opportunityId)
    .eq("company_id", company.id)
    .maybeSingle();
  if (error && isCrmSchemaUnavailableError(error)) return <MigrationPending />;
  if (error) throw new Error(`Could not load opportunity: ${error.message}`);
  if (!data) notFound();
  const opportunity = normaliseCustomerOpportunityRow(data);

  const [{ data: notes, error: notesError }, { data: activities, error: activitiesError }] = await Promise.all([
    supabase
      .from("opportunity_notes")
      .select("id,body,created_by,created_at,updated_at")
      .eq("opportunity_id", opportunity.id)
      .order("created_at", { ascending: false })
      .limit(NOTE_READ_LIMIT),
    supabase
      .from("lead_events")
      .select("id,event_type,from_status,to_status,metadata,created_at")
      .eq("customer_lead_id", opportunity.id)
      .order("created_at", { ascending: false })
      .limit(100)
  ]);
  if (notesError && isCrmSchemaUnavailableError(notesError)) return <MigrationPending />;
  if (notesError) throw new Error(`Could not load opportunity notes: ${notesError.message}`);
  if (activitiesError) throw new Error(`Could not load opportunity activity: ${activitiesError.message}`);
  const officialUrl = safeHttpUrl(opportunity.sourceUrl);

  return (
    <>
      <div className="topbar">
        <div>
          <Link href="/dashboard/opportunities" className="back-link">← All opportunities</Link>
          <div className="eyebrow" style={{ marginTop: 10 }}>{opportunity.externalReference}</div>
          <h2>{opportunity.proposal}</h2>
          <div className="muted">{opportunity.address ?? opportunity.postcode ?? "Address unavailable"}</div>
        </div>
        <div className="badge-row">
          <span className={`pill ${opportunity.priority.toLowerCase()}`}>{opportunity.priority} · {opportunity.score}/10</span>
          <span className="stage-badge">{stageLabel(opportunity.status)}</span>
        </div>
      </div>

      {first(query.saved) && <div className="notice success" role="status">{first(query.saved)}</div>}
      {first(query.error) && <div className="notice error" role="alert">{first(query.error)}</div>}

      <div className="opportunity-detail-grid">
        <section className="panel">
          <h3>Planning opportunity</h3>
          <dl className="fact-grid">
            <div><dt>Reference</dt><dd>{opportunity.externalReference}</dd></div>
            <div><dt>Council</dt><dd>{opportunity.councilName}</dd></div>
            <div><dt>County</dt><dd>{opportunity.countyNames.join(", ") || "Not available"}</dd></div>
            <div><dt>Application type</dt><dd>{opportunity.applicationType ?? "Not available"}</dd></div>
            <div><dt>Validated</dt><dd>{date(opportunity.validatedAt)}</dd></div>
            <div><dt>Planning status</dt><dd>{opportunity.planningStage ?? opportunity.decision ?? "Pending"}</dd></div>
            <div><dt>Estimated opportunity value</dt><dd>{formatGbp(opportunity.estimatedValueMinGbp)}–{formatGbp(opportunity.estimatedValueMaxGbp)}</dd></div>
            <div><dt>Applicant</dt><dd>{opportunity.applicantName ?? "Not publicly available"}</dd></div>
            <div><dt>Agent</dt><dd>{opportunity.agentName ?? "Not publicly available"}</dd></div>
          </dl>
          {opportunity.whyItMatches && <p><strong>Why it matches:</strong> {opportunity.whyItMatches}</p>}
          {opportunity.recommendedApproach && <p><strong>Recommended next move:</strong> {opportunity.recommendedApproach}</p>}
          {officialUrl && <a className="btn secondary" href={officialUrl} target="_blank" rel="noreferrer">Open official planning application</a>}
        </section>

        <section className="panel crm-state-panel">
          <h3>CRM state</h3>
          <form action={updateOpportunityAction} className="form compact-form">
            <input type="hidden" name="opportunity_id" value={opportunity.id} />
            <label>Stage<select name="stage" defaultValue={opportunity.status}>
              {CRM_STAGES.map((stage) => <option key={stage} value={stage}>{stageLabel(stage)}</option>)}
            </select></label>
            <label>Follow-up<input type="datetime-local" name="follow_up_at" defaultValue={dateTimeInput(opportunity.followUpAt)} /></label>
            <label>Customer quote value (£)<input type="number" name="quote_value_gbp" min="0" step="0.01" defaultValue={opportunity.quoteValueGbp ?? ""} /></label>
            <label>Won value (£)<input type="number" name="won_value_gbp" min="0" step="0.01" defaultValue={opportunity.wonValueGbp ?? ""} /></label>
            <label>Lost reason<select name="lost_reason" defaultValue={opportunity.lostReason ?? ""}>
              <option value="">No reason</option>{LOST_REASONS.map((reason) => <option key={reason}>{reason}</option>)}
            </select></label>
            <label>Not relevant reason<select name="not_relevant_reason" defaultValue={opportunity.notRelevantReason ?? ""}>
              <option value="">No reason</option>{NOT_RELEVANT_REASONS.map((reason) => <option key={reason}>{reason}</option>)}
            </select></label>
            <button className="btn">Save CRM state</button>
          </form>
          <div className="quick-actions" aria-label="Opportunity stage shortcuts">
            {(["reviewing", "contacted", "quoted", "follow_up", "won", "lost", "not_relevant"] as const).map((stage) => (
              <form action={updateOpportunityAction} key={stage}>
                <input type="hidden" name="opportunity_id" value={opportunity.id} />
                <input type="hidden" name="stage" value={stage} />
                <input type="hidden" name="follow_up_at" value={opportunity.followUpAt ?? ""} />
                <input type="hidden" name="quote_value_gbp" value={opportunity.quoteValueGbp ?? ""} />
                <input type="hidden" name="won_value_gbp" value={opportunity.wonValueGbp ?? ""} />
                <input type="hidden" name="lost_reason" value={stage === "lost" ? opportunity.lostReason ?? "" : ""} />
                <input type="hidden" name="not_relevant_reason" value={stage === "not_relevant" ? opportunity.notRelevantReason ?? "" : ""} />
                <button>{stageLabel(stage)}</button>
              </form>
            ))}
          </div>
        </section>
      </div>

      <div className="opportunity-detail-grid lower-grid">
        <section className="panel">
          <h3>Notes</h3>
          <form action={addOpportunityNoteAction} className="form note-form">
            <input type="hidden" name="opportunity_id" value={opportunity.id} />
            <label htmlFor="new-note">Add a note</label>
            <textarea id="new-note" name="body" maxLength={4000} required rows={4} placeholder="Call outcome, site context or next step" />
            <button className="btn">Add note</button>
          </form>
          <div className="notes-list">
            {!(notes ?? []).length && <p className="muted">No notes yet.</p>}
            {(notes ?? []).length === NOTE_READ_LIMIT && (
              <p className="muted" role="status">Showing the newest {NOTE_READ_LIMIT} notes.</p>
            )}
            {(notes ?? []).map((note: any) => (
              <article className="note" key={note.id}>
                <div className="muted">Updated {date(note.updated_at)}</div>
                <details>
                  <summary>{note.body}</summary>
                  <form action={updateOpportunityNoteAction} className="form compact-form">
                    <input type="hidden" name="opportunity_id" value={opportunity.id} />
                    <input type="hidden" name="note_id" value={note.id} />
                    <label>Edit note<textarea name="body" maxLength={4000} required defaultValue={note.body} rows={3} /></label>
                    <button className="btn secondary">Save note</button>
                  </form>
                  <form action={deleteOpportunityNoteAction}>
                    <input type="hidden" name="opportunity_id" value={opportunity.id} />
                    <input type="hidden" name="note_id" value={note.id} />
                    <button className="danger-button">Delete note</button>
                  </form>
                </details>
              </article>
            ))}
          </div>
        </section>

        <section className="panel">
          <h3>Activity</h3>
          <ol className="activity-list">
            {!(activities ?? []).length && <li className="muted">No CRM activity yet.</li>}
            {(activities ?? []).map((event: any) => (
              <li key={event.id}><strong>{activityDescription(event)}</strong><span>{date(event.created_at)}</span></li>
            ))}
          </ol>
        </section>
      </div>
    </>
  );
}
