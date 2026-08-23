import { redirect } from "next/navigation";
import {
  getCompanyContext,
  subscriptionAllowsLeads
} from "@/lib/auth";
import { updateLeadStatus } from "./actions";

function money(
  min?: number | null,
  max?: number | null
) {
  if (!min && !max) {
    return "Value not estimated";
  }

  const fmt = (n: number) =>
    n >= 1000
      ? `£${Math.round(n / 1000)}k`
      : `£${n.toLocaleString("en-GB")}`;

  if (min && max) {
    return `${fmt(min)}–${fmt(max)}`;
  }

  return fmt((min || max)!);
}

export default async function DashboardPage({
  searchParams
}: {
  searchParams: Promise<
    Record<
      string,
      string | string[] | undefined
    >
  >;
}) {
  const {
    supabase,
    company,
    subscription,
    territory
  } = await getCompanyContext();

  if (!company) {
    redirect("/onboarding");
  }

  const active = subscriptionAllowsLeads(
    subscription?.status
  );

  /*
   * Always initialise leads as an array.
   * Supabase can return null for data, so
   * explicitly convert null to [].
   */
  let leads: any[] = [];

  if (active) {
    const {
      data: leadsData,
      error: leadsError
    } = await supabase
      .from("customer_leads")
      .select("*")
      .eq("company_id", company.id)
      .order("matched_at", {
        ascending: false
      })
      .limit(30);

    if (leadsError) {
      throw leadsError;
    }

    leads = leadsData ?? [];
  }

  const newCount = leads.filter(
    (lead: any) =>
      lead.status === "new"
  ).length;

  const contacted = leads.filter(
    (lead: any) =>
      [
        "contacted",
        "quoted",
        "won"
      ].includes(lead.status)
  ).length;

  const won = leads.filter(
    (lead: any) =>
      lead.status === "won"
  ).length;

  const params = await searchParams;

  return (
    <>
      <div className="topbar">
        <div>
          <div className="eyebrow">
            {company.name}
          </div>

          <h2
            style={{
              marginTop: 5
            }}
          >
            Opportunity feed
          </h2>

          <div className="muted">
            {territory
              ? `${territory.centre_postcode} · ${territory.radius_miles} mile radius`
              : "Territory not configured"}
          </div>
        </div>

        <span
          className={`pill ${
            active
              ? "medium"
              : "hot"
          }`}
        >
          {active
            ? "PRO ACTIVE"
            : "SUBSCRIPTION REQUIRED"}
        </span>
      </div>

      {params.checkout ===
        "success" && (
        <div
          className="notice"
          style={{
            marginBottom: 16
          }}
        >
          Payment received. Stripe is
          confirming the subscription;
          your access will update
          automatically.
        </div>
      )}

      {!active ? (
        <div className="panel locked">
          <div className="eyebrow">
            ProjectSignal Pro
          </div>

          <h2
            style={{
              marginTop: 8
            }}
          >
            Turn on your daily
            opportunity feed.
          </h2>

          <p
            className="muted"
            style={{
              maxWidth: 560,
              margin: "0 auto 22px"
            }}
          >
            Your territory is ready.
            Activate ProjectSignal Pro
            for £79/month to unlock
            matched opportunities and
            daily lead delivery.
          </p>

          <form
            action="/api/checkout"
            method="post"
          >
            <button className="btn accent">
              Subscribe for £79/month
            </button>
          </form>
        </div>
      ) : (
        <>
          <div className="stats">
            <div className="stat">
              <span className="muted">
                New
              </span>

              <strong>
                {newCount}
              </strong>
            </div>

            <div className="stat">
              <span className="muted">
                In pipeline
              </span>

              <strong>
                {contacted}
              </strong>
            </div>

            <div className="stat">
              <span className="muted">
                Won
              </span>

              <strong>
                {won}
              </strong>
            </div>

            <div className="stat">
              <span className="muted">
                Minimum score
              </span>

              <strong>
                {territory?.minimum_score ??
                  7}
                +
              </strong>
            </div>
          </div>

          <div className="leads">
            {leads.length === 0 && (
              <div className="panel">
                <h3>
                  No matched
                  opportunities yet
                </h3>

                <p className="muted">
                  Your account is
                  active. The daily
                  scanner will add
                  projects here when
                  they meet your
                  territory and score
                  settings.
                </p>
              </div>
            )}

            {leads.map(
              (lead: any) => (
                <article
                  key={lead.id}
                  className="dashboard-lead"
                >
                  <div>
                    <span
                      className={`pill ${String(
                        lead.priority
                      ).toLowerCase()}`}
                    >
                      {lead.score}/10 ·{" "}
                      {lead.priority}
                    </span>

                    <h3
                      style={{
                        marginTop: 9
                      }}
                    >
                      {lead.title}
                    </h3>

                    <div
                      className="muted"
                      style={{
                        fontSize: 13
                      }}
                    >
                      {lead.address ||
                        lead.postcode}{" "}
                      ·{" "}
                      {lead.stage ||
                        "Planning application"}
                    </div>

                    <p>
                      {lead.proposal}
                    </p>

                    <strong>
                      {money(
                        lead.estimated_value_min_gbp,
                        lead.estimated_value_max_gbp
                      )}{" "}
                      opportunity
                    </strong>

                    {lead.why_it_matches && (
                      <p
                        className="muted"
                        style={{
                          fontSize: 13
                        }}
                      >
                        <strong>
                          Why:
                        </strong>{" "}
                        {
                          lead.why_it_matches
                        }
                      </p>
                    )}

                    {lead.recommended_approach && (
                      <p
                        style={{
                          fontSize: 13
                        }}
                      >
                        <strong>
                          Next move:
                        </strong>{" "}
                        {
                          lead.recommended_approach
                        }
                      </p>
                    )}
                  </div>

                  <div>
                    <div
                      className="muted"
                      style={{
                        fontSize: 12,
                        marginBottom: 7
                      }}
                    >
                      Status:{" "}
                      {lead.status}
                    </div>

                    <div className="actions">
                      {[
                        "interested",
                        "contacted",
                        "quoted",
                        "won",
                        "ignored"
                      ].map(
                        (
                          status
                        ) => (
                          <form
                            action={
                              updateLeadStatus
                            }
                            key={
                              status
                            }
                          >
                            <input
                              type="hidden"
                              name="lead_id"
                              value={
                                lead.id
                              }
                            />

                            <input
                              type="hidden"
                              name="status"
                              value={
                                status
                              }
                            />

                            <button>
                              {status[0].toUpperCase() +
                                status.slice(
                                  1
                                )}
                            </button>
                          </form>
                        )
                      )}
                    </div>
                  </div>
                </article>
              )
            )}
          </div>
        </>
      )}
    </>
  );
}