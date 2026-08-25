# Customer Opportunity Manager

ProjectSignal's lightweight CRM turns each customer-specific `customer_leads` row into a manageable opportunity. Planning facts remain shared and immutable; stage, notes, follow-ups, quotes, outcomes, and activities belong to the customer account.

## Stages

The canonical workflow is:

1. New
2. Reviewing
3. Contacted
4. Quoted
5. Follow Up
6. Won
7. Lost
8. Not Relevant

Legacy `interested` and `ignored` enum values remain in Postgres for compatibility and normalize to Reviewing and Not Relevant in the application. New UI writes accept canonical stages only.

## Data model

The local `20260824170000_customer_opportunity_manager.sql` migration extends `customer_leads` with viewed/contacted/quoted/outcome timestamps, `follow_up_at`, customer quote and Won values, and controlled Lost/Not Relevant reasons. Existing planning estimates are reused rather than duplicated.

`opportunity_notes` stores multiple customer notes with a 1–4,000 character bound, creator identity, and timestamps. The detail view loads the newest 200 notes so a long-running account cannot create an unbounded page read. Existing `lead_events` remains the lightweight activity timeline for stage, quote, follow-up, and note mutations.

Indexes cover company/stage/update ordering, active follow-ups, planning-application lookup, notes, and activity history.

## Customer workflow

- `/dashboard` answers “What should I do today?” with new work, due follow-ups, quoted pipeline, Won value, conversion rates, and ROI.
- `/dashboard/opportunities` provides quick views, customer-visible search, stage/priority/date/county/council/application type/value/follow-up filters, active-first ordering, and 20-record pages.
- `/dashboard/opportunities/[id]` shows official planning facts and link, score reasoning, editable CRM state, quick stage actions, notes, and activity.
- Mobile layouts use cards and a horizontally accessible navigation bar; state, notes, quote, follow-up, outcomes, and official links remain usable without a desktop table.

## Follow-ups, quotes and outcomes

Follow-ups can be set, changed, or cleared and are classified in Europe/London as Overdue, Today, or Upcoming. Quote value and Won value are nonnegative customer-entered GBP values. Marking Won timestamps the opportunity and uses explicit Won value, then quote value only as a fallback. Lost and Not Relevant support optional controlled reasons and never delete the planning opportunity.

The dashboard distinguishes:

- Estimated Opportunity Value: ProjectSignal's broad fenestration estimate;
- Customer Quote Value: the customer's current pipeline value;
- Won Value: confirmed customer-entered revenue.

ROI is `confirmed Won value / subscription cost to date`. A zero or unavailable subscription cost produces no ROI multiple rather than dividing by zero.

## Entitlement and RLS

Browser forms never submit a company/customer identifier. Public mutation RPCs derive `auth.uid()`, then call a private, fixed-search-path security-definer predicate that requires:

- membership of the opportunity's company;
- an active subscription;
- an active, current company county entitlement matching the planning authority.

The same predicate protects customer lead, note, activity, and related planning-application reads. Notes have RLS enabled. Mutation RPCs validate stages, reasons, monetary values, dates, note bounds, and IDs at the application boundary and again where relevant in Postgres. Public/anonymous function execution is revoked; only `authenticated` receives the narrow RPC grants.

No token, cookie, session, service key, or planning debug payload is stored in CRM activities. Unknown persistence failures are not surfaced verbatim to customers, and the UI never redirects with success after a failed RPC.

The migration also revokes authenticated access to the legacy `set_customer_lead_status` RPC, whose membership-only authorization is weaker than the active subscription and county-entitlement checks required by the CRM.

## Internal source health

`/admin/source-health` is a dynamic Node-rendered operations page protected by the existing `CRON_SECRET` bearer header. It uses the service client only after authorization and renders sanitized source status, platform, role, active primary/fallback state, scan times, failure counts, and errors. It does not render source config, endpoints, cookies, or headers.

## Deployment order

1. Validate the CRM migration in a safe PostgreSQL/Supabase environment and test two authenticated companies with disjoint county entitlements.
2. Deploy the compatibility-gated application code. Before the migration, Today retains the legacy read-only feed and CRM list/detail routes show an upgrade-pending state; unrelated database failures still fail normally.
3. Apply the reviewed migration through a controlled Supabase deployment only after the application deployment is healthy.
4. Smoke-test list/detail/mutations, customer isolation, empty/error states, mobile layout, and source-health authorization before declaring the CRM launched.

## Current limits and future backlog

The list reads at most 2,000 entitled opportunities per request, filters in memory, and shows a visible warning when the account exceeds that bound. Detail pages load the newest 200 notes and 100 activities. Database-native filtered archive pagination is a P1 follow-up before very large customer histories.

Deferred features: email/SMS/push reminders, team assignment, contact enrichment, automated outreach, PDF quotes, accounting/job-management integrations, and AI follow-up recommendations.
